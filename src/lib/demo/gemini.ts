import { GoogleGenAI, Type } from '@google/genai';
import { DEMO_DOCUMENTS, DEMO_DOCUMENT_NAMES } from '@/lib/demo/documents';
import { NO_ANSWER_TEXT } from '@/lib/chat/constants';
import type { ChatResponse, Citation } from '@/types/api';

/**
 * デモモードの回答生成（BYOKデモ・STEP C）
 *
 * 【本番との違い】
 * 本番は「サーバーがベクトル検索で必要なチャンクだけを取り出す」のに対し、
 * デモは**ブラウザから直接 Gemini API を呼び、5文書の全文をプロンプトへ渡す**。
 * サーバーを経由しないため、利用者のAPIキーがこちらへ届くことはない。
 *
 * 収録文書が5件と少ないため全文を渡しても成立するが、
 * 文書が増えるとこの方式は破綻する（トークン上限・コスト）。
 * また、精度検証フェーズで測定した精度（回答精度100%）は
 * ベクトル検索を通した本番経路での数値であり、デモには当てはまらない。
 *
 * 【APIキーの扱い】
 * 引数で受け取ったキーは、この関数の中だけで使う。
 * ログ出力・保存・サーバーへの送信をしてはならない。
 */

/** デモで使うモデル（本番と揃える） */
const DEMO_MODEL = 'gemini-2.5-flash';

/** 利用者へそのまま表示してよいメッセージを持つエラー */
export class DemoChatError extends Error {
  readonly userMessage: string;

  constructor(userMessage: string, options?: { cause?: unknown }) {
    super(userMessage, options);
    this.name = 'DemoChatError';
    this.userMessage = userMessage;
  }
}

/**
 * システムプロンプト。
 *
 * 本番（`@/lib/gemini/answer.ts`）と同じ方針で「文書のみを根拠にする」を徹底させる。
 * デモだからと緩めると、文書に無いことを答えてしまい
 * 「AIが推測で答えない」という製品の一番の価値が伝わらない。
 */
const SYSTEM_INSTRUCTION = `あなたは株式会社テックブリッジの社内文書検索アシスタントです。
社員からの質問に対し、提供された社内文書のみを根拠として回答します。

必ず守るルール:
1. 提供された社内文書に書かれている内容だけを根拠に回答する。文書に無い情報は、一般常識や推測で補わない。
2. 質問に答えられる記述が文書に無い場合は、has_answer を false にし、answer は「${NO_ANSWER_TEXT}」とする。
3. 文書の一部だけで部分的に答えられる場合は、答えられる範囲のみを回答し、記載が無い部分は「文書には記載がありません」と明示する。
4. 回答は日本語で、社内向けの丁寧な文体で簡潔に書く（目安3文以内）。
5. 金額・日数・期限・人数などの数値は、文書の記載をそのまま正確に引用する。言い換えや概算をしない。
6. 文書に、回答内容に関わる条件・上限・例外・期限・申請方法が書かれている場合は、それも回答へ含める。
   社員が条件を知らずに判断を誤らないようにするため、別の文書に書かれていても省略しない。
7. used_documents には、回答に書いた事実の根拠となった文書名を、ひとつ残らず正確に入れる。
   - 使用できる文書名は次のいずれかのみ：${DEMO_DOCUMENT_NAMES.join(' / ')}
   - 回答の根拠として使っていない文書名は入れない。
   - has_answer が false の場合は空配列にする。
8. 回答本文に文書名の番号や記号を書かない（出典は別途システムが表示する）。`;

/** 構造化出力のスキーマ */
const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    answer: {
      type: Type.STRING,
      description: '質問への回答本文（日本語）',
    },
    has_answer: {
      type: Type.BOOLEAN,
      description: '社内文書を根拠に回答できた場合は true、根拠が無い場合は false',
    },
    used_documents: {
      type: Type.ARRAY,
      description: '回答の根拠として使用した文書名',
      items: { type: Type.STRING },
    },
  },
  required: ['answer', 'has_answer', 'used_documents'],
} as const;

/** モデルが返すJSONの形 */
type DemoAnswerPayload = {
  answer: string;
  has_answer: boolean;
  used_documents: string[];
};

/** 全文書をプロンプト用のテキストへ整える */
function buildDocumentsContext(): string {
  return DEMO_DOCUMENTS.map(
    (document) => `# ${document.name}（管轄: ${document.department}）\n${document.content}`
  ).join('\n\n---\n\n');
}

/**
 * エラーから利用者向けメッセージを組み立てる。
 *
 * 【重要】APIキーが誤っている場合が最も多いため、
 * 「失敗しました」で終わらせず何をすればよいかを示す（UI/UX仕様）。
 * 例外の生メッセージにはリクエストURL（キーを含む場合がある）が混ざることがあるため、
 * **そのまま画面へ出さない**。
 */
function toUserMessage(error: unknown): string {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? (error as { status?: unknown }).status
      : undefined;
  const raw = error instanceof Error ? error.message : String(error);

  if (status === 400 || status === 401 || status === 403 || /API[_ ]?key|PERMISSION_DENIED|INVALID_ARGUMENT/i.test(raw)) {
    return 'APIキーが正しくないか、Gemini APIの利用が許可されていません。「APIキーを変更する」から入力し直してください。';
  }

  if (status === 429 || /\b429\b|RESOURCE_EXHAUSTED|quota|rate limit/i.test(raw)) {
    return 'APIの利用制限に達しました。1分ほど待ってから再度お試しください。（無料枠は1日の回数上限もあります）';
  }

  if (/fetch|network|Failed to fetch/i.test(raw)) {
    return 'Gemini APIへ接続できませんでした。ネットワーク接続を確認して、もう一度お試しください。';
  }

  return '回答の取得に失敗しました。もう一度お試しください。';
}

/** モデルの応答を解釈する */
function parsePayload(text: string | undefined): DemoAnswerPayload {
  if (!text || text.trim().length === 0) {
    throw new DemoChatError('回答の取得に失敗しました。もう一度お試しください。');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new DemoChatError('回答の取得に失敗しました。もう一度お試しください。', { cause: error });
  }

  const payload = parsed as Partial<DemoAnswerPayload>;

  if (typeof payload.answer !== 'string' || typeof payload.has_answer !== 'boolean') {
    throw new DemoChatError('回答の取得に失敗しました。もう一度お試しください。');
  }

  return {
    answer: payload.answer.trim(),
    has_answer: payload.has_answer,
    used_documents: Array.isArray(payload.used_documents)
      ? payload.used_documents.filter((value): value is string => typeof value === 'string')
      : [],
  };
}

/**
 * モデルが返した文書名を出典へ変換する。
 *
 * 収録文書に無い名前は、モデルが作り出した出典なので必ず捨てる。
 * ここを緩めると、存在しない文書を根拠として表示してしまう。
 */
function buildCitations(usedDocuments: string[]): Citation[] {
  const citations: Citation[] = [];
  const seen = new Set<string>();

  for (const name of usedDocuments) {
    if (seen.has(name)) continue;

    const document = DEMO_DOCUMENTS.find((item) => item.name === name);
    if (!document) continue;

    seen.add(name);
    citations.push({
      document_name: document.name,
      // デモは文書全文を渡す簡易方式のため、ページ・見出し単位の特定はしない
      page: null,
      section: null,
      // 本番のdocuments.idに相当するものが無いため、文書名を識別子として使う
      document_id: document.name,
      // 出典モーダルで原文を確認できるように全文を持たせる
      content: document.content,
    });
  }

  return citations;
}

/**
 * 質問へ回答する（ブラウザから直接 Gemini API を呼ぶ）。
 *
 * @param question 利用者の質問
 * @param apiKey 利用者本人のGemini APIキー（この関数の外へ出さないこと）
 */
export async function askDemo(question: string, apiKey: string): Promise<ChatResponse> {
  const trimmed = question.trim();

  if (trimmed.length === 0) {
    throw new DemoChatError('質問を入力してください。');
  }

  const ai = new GoogleGenAI({ apiKey: apiKey.trim() });

  let payload: DemoAnswerPayload;

  try {
    const response = await ai.models.generateContent({
      model: DEMO_MODEL,
      contents: `# 社内文書\n${buildDocumentsContext()}\n\n# 質問\n${trimmed}`,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        // 文書の記載をそのまま答えさせたいため、ゆらぎを最小にする
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        // 抜粋からの抽出タスクであり長い思考は不要（待ち時間を短くする）
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    payload = parsePayload(response.text);
  } catch (error) {
    if (error instanceof DemoChatError) throw error;

    // 【重要】APIキーが混ざる可能性があるため、生のエラーはコンソールにも出さない
    throw new DemoChatError(toUserMessage(error));
  }

  // 根拠なしと判断された場合は、文言・出典ともに「該当なし」へ揃える
  if (!payload.has_answer || payload.answer.length === 0) {
    return { answer: NO_ANSWER_TEXT, citations: [], has_answer: false };
  }

  return {
    answer: payload.answer,
    citations: buildCitations(payload.used_documents),
    has_answer: true,
  };
}
