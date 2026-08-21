import { GoogleGenAI, Type } from '@google/genai';
import type { MatchedChunk } from '@/lib/search/searchChunks';
import { NO_ANSWER_TEXT } from '@/lib/chat/constants';

/**
 * Gemini APIによるRAG回答生成（要件F-03）
 *
 * 検索で取得したチャンクだけを根拠に回答を生成する。
 * 文書に根拠がない場合は推測せず「該当なし」を返すことが最重要要件
 * （requirements.md 4-3 ハルシネーション抑制）。
 */

/**
 * 回答生成に使用するモデル。
 *
 * Gemini採用は検証段階のAPIコスト節約が理由であり、本番採用は未確定
 * （技術選定方針）。モデルを変更する場合は必ず確認を取ること。
 */
export const ANSWER_MODEL = 'gemini-2.5-flash';

/**
 * 文書に根拠が無いときに返す定型文（UI・要件で文言が確定している）
 *
 * 実体は `@/lib/chat/constants` に置いている。
 * クライアントコンポーネント（履歴画面など）もこの文言で判定する必要があるが、
 * このファイルは Gemini SDK を読み込むためクライアントから import できないため。
 */
export const NO_ANSWER_MESSAGE = NO_ANSWER_TEXT;

/**
 * Gemini APIの利用制限（429）に達したときの文言。
 *
 * 汎用の「もう一度お試しください」だと、利用者は原因も待つべき時間も分からない。
 * UI/UX仕様「エラー時は原因と次の行動を示す」に対応するため専用文言を用意する。
 */
export const RATE_LIMIT_MESSAGE =
  'APIの利用制限に達しました。1分ほど待ってから再度お試しください。';

/** 回答生成のリトライ設定（レート制限・一時的な障害向け） */
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1500;

/** 回答生成で発生する想定内のエラー */
export class AnswerGenerationError extends Error {
  /** UIへそのまま表示してよいメッセージ */
  readonly userMessage: string;

  /**
   * API利用制限（429）が原因かどうか。
   * API Route側でHTTPステータスを429で返すかどうかの判断に使う。
   */
  readonly isRateLimit: boolean;

  constructor(userMessage: string, options?: { cause?: unknown; isRateLimit?: boolean }) {
    super(userMessage, options);
    this.name = 'AnswerGenerationError';
    this.userMessage = userMessage;
    this.isRateLimit = options?.isRateLimit ?? false;
  }
}

/** 回答生成の結果 */
export type GeneratedAnswer = {
  /** 回答本文（日本語） */
  answer: string;
  /** 文書を根拠に回答できたか。false なら出典を表示しない */
  hasAnswer: boolean;
  /**
   * 回答の根拠として実際に使用したチャンク（`sources` の並び順の部分集合）。
   * 出典（citations）はこの配列から組み立てる。
   */
  usedChunks: MatchedChunk[];
};

/**
 * システムプロンプト。
 *
 * 「提供文書のみを根拠に回答する」「文書外は該当なしを返す」を徹底させる。
 * ここを緩めると、モデルが一般知識で回答してしまい社内文書検索として成立しない。
 */
const SYSTEM_INSTRUCTION = `あなたは株式会社テックブリッジの社内文書検索アシスタントです。
社員からの質問に対し、提供された社内文書の抜粋（参考文書）のみを根拠として回答します。

必ず守るルール:
1. 参考文書に書かれている内容だけを根拠に回答する。参考文書に無い情報は、一般常識や推測で補わない。
2. 質問に答えられる記述が参考文書に無い場合は、has_answer を false にし、answer は「${NO_ANSWER_MESSAGE}」とする。
3. 参考文書の一部だけで部分的に答えられる場合は、答えられる範囲のみを回答し、記載が無い部分は「文書には記載がありません」と明示する。
4. 回答は日本語で、社内向けの丁寧な文体で簡潔に書く（目安3文以内）。
5. 金額・日数・期限・人数などの数値は、参考文書の記載をそのまま正確に引用する。言い換えや概算をしない。
6. 参考文書に、回答内容に関わる条件・上限・例外・期限・申請方法が書かれている場合は、それも回答へ含める。
   社員が条件を知らずに判断を誤らないようにするため、別の参考文書に書かれていても省略しない。
7. used_sources には、回答に書いた事実（金額・日数・期限・条件など）の根拠となった参考文書の番号を、ひとつ残らず入れる。
   - 1つの回答が複数の参考文書の記述にまたがる場合は、その全部の番号を入れる。
   - 例：金額を[1]から、支給条件を[3]から取ったなら used_sources は [1, 3] とする。
   - 回答の根拠として使っていない番号は入れない。
8. 回答本文に「[1]」のような参考文書番号を書かない（出典は別途システムが表示する）。`;

/**
 * 構造化出力のスキーマ。
 *
 * 出典（F-04）は「回答に実際に使用した文書」を表示する必要があるため、
 * 回答本文と一緒に使用した参考文書の番号を返させる。
 * 自由文から番号を推測すると誤った出典を表示してしまう。
 */
const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    answer: {
      type: Type.STRING,
      description: '質問への回答本文（日本語）',
    },
    has_answer: {
      type: Type.BOOLEAN,
      description: '参考文書を根拠に回答できた場合は true、根拠が無い場合は false',
    },
    used_sources: {
      type: Type.ARRAY,
      description: '回答の根拠として使用した参考文書の番号',
      items: { type: Type.INTEGER },
    },
  },
  required: ['answer', 'has_answer', 'used_sources'],
} as const;

/** モデルが返すJSONの形 */
type AnswerPayload = {
  answer: string;
  has_answer: boolean;
  used_sources: number[];
};

let client: GoogleGenAI | null = null;

/**
 * Geminiクライアントを取得する（初回のみ生成）。
 * 環境変数はモジュール読み込み時ではなく呼び出し時に確認する。
 */
function getClient(): GoogleGenAI {
  if (client) return client;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new AnswerGenerationError(
      'GEMINI_API_KEY が設定されていません。.env.local を確認してください。'
    );
  }

  client = new GoogleGenAI({ apiKey: apiKey.trim() });
  return client;
}

/** 指定ミリ秒待つ */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** レート制限・一時的な障害かどうかを判定する */
function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /429|500|503|rate limit|quota|unavailable|timeout/i.test(message);
}

/**
 * API利用制限（429）が原因かどうかを判定する。
 *
 * Gemini SDKは429時に status プロパティを持つエラーを投げるが、
 * ラップされて型が変わる場合に備えてメッセージ側も見る。
 */
function isRateLimitError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    if ((error as { status?: unknown }).status === 429) return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b|RESOURCE_EXHAUSTED|rate limit|quota/i.test(message);
}

/**
 * 検索で取得したチャンクを、モデルへ渡す「参考文書」の形に整える。
 * 番号（1始まり）で出典を特定できるようにする。
 */
function buildContext(chunks: MatchedChunk[]): string {
  return chunks
    .map((chunk, index) => {
      const section = chunk.section ? `／${chunk.section}` : '';
      const page = chunk.page_number ? `／p.${chunk.page_number}` : '';

      return `[${index + 1}] ${chunk.document_name}${section}${page}\n${chunk.content}`;
    })
    .join('\n\n');
}

/**
 * 質問と参考文書からプロンプトを組み立てる。
 */
function buildPrompt(question: string, chunks: MatchedChunk[]): string {
  return `# 参考文書\n${buildContext(chunks)}\n\n# 質問\n${question}`;
}

/**
 * モデルの応答（JSON文字列）を解釈する。
 * 解釈できない場合は例外を投げ、呼び出し側でエラー応答に倒す。
 */
function parsePayload(text: string | undefined): AnswerPayload {
  if (!text || text.trim().length === 0) {
    throw new AnswerGenerationError('回答の取得に失敗しました。もう一度お試しください。');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new AnswerGenerationError('回答の取得に失敗しました。もう一度お試しください。', {
      cause: error,
    });
  }

  const payload = parsed as Partial<AnswerPayload>;

  if (typeof payload.answer !== 'string' || typeof payload.has_answer !== 'boolean') {
    throw new AnswerGenerationError('回答の取得に失敗しました。もう一度お試しください。');
  }

  return {
    answer: payload.answer.trim(),
    has_answer: payload.has_answer,
    used_sources: Array.isArray(payload.used_sources)
      ? payload.used_sources.filter((value): value is number => Number.isInteger(value))
      : [],
  };
}

/**
 * 回答の長さ指示（設定画面「回答の最大文字数」）。
 *
 * 文量の目安だけを変え、「文書のみを根拠にする」ルールには一切触れない。
 * ここでハルシネーション抑制のルールを緩めると最重要要件が崩れるため。
 */
const ANSWER_LENGTH_INSTRUCTION: Record<AnswerLength, string> = {
  short: '回答は結論のみを1〜2文で簡潔に書いてください。',
  standard: '回答は結論と必要な補足を3文程度で書いてください。',
  detailed:
    '回答は結論に加え、関係する条件・上限・例外・申請方法も含めて5文程度で書いてください。',
};

/** 回答の長さの選択肢 */
export type AnswerLength = 'short' | 'standard' | 'detailed';

/** 回答生成のオプション */
export type GenerateAnswerOptions = {
  /** 回答の長さの目安。未指定なら standard */
  answerLength?: AnswerLength;
};

/**
 * 検索で取得したチャンクを根拠に回答を生成する。
 *
 * @param question 正規化済みの質問テキスト
 * @param chunks 類似検索で取得したチャンク（0件の場合は呼び出さないこと）
 * @param options 回答の長さなどの利用者設定
 */
export async function generateAnswer(
  question: string,
  chunks: MatchedChunk[],
  options: GenerateAnswerOptions = {}
): Promise<GeneratedAnswer> {
  // 検索0件は「該当情報なし」が確定しているため、APIを呼ばずに返す（無駄なコスト・待ち時間を避ける）
  if (chunks.length === 0) {
    return { answer: NO_ANSWER_MESSAGE, hasAnswer: false, usedChunks: [] };
  }

  const ai = getClient();
  const lengthInstruction =
    ANSWER_LENGTH_INSTRUCTION[options.answerLength ?? 'standard'] ??
    ANSWER_LENGTH_INSTRUCTION.standard;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await ai.models.generateContent({
        model: ANSWER_MODEL,
        contents: buildPrompt(question, chunks),
        config: {
          // 長さの指示は末尾に足す。先に書くと本文のルールより優先されかねないため
          systemInstruction: [SYSTEM_INSTRUCTION, lengthInstruction].join('\n\n'),
          // 文書の記載をそのまま答えさせたいため、ゆらぎを最小にする
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          // 抜粋からの抽出タスクであり長い思考は不要。
          // 回答表示までの目標10秒以内（非機能要件3-1）を満たすため思考を無効化する
          thinkingConfig: { thinkingBudget: 0 },
        },
      });

      const payload = parsePayload(response.text);

      // モデルが「根拠なし」と判断した場合は、文言・出典ともに該当なしへ揃える
      if (!payload.has_answer) {
        return { answer: NO_ANSWER_MESSAGE, hasAnswer: false, usedChunks: [] };
      }

      // 使用した参考文書の番号（1始まり）を実際のチャンクへ戻す。
      // 範囲外の番号はモデルの誤りとして無視する
      const usedChunks = payload.used_sources
        .filter((sourceNumber) => sourceNumber >= 1 && sourceNumber <= chunks.length)
        .map((sourceNumber) => chunks[sourceNumber - 1]);

      // 回答できたのに出典が特定できない状態は、出典表示（F-04）の要件を満たせない。
      // 検索で取得した全チャンクを根拠として扱い、出典が空にならないようにする
      const resolvedChunks = usedChunks.length > 0 ? usedChunks : chunks;

      return {
        answer: payload.answer.length > 0 ? payload.answer : NO_ANSWER_MESSAGE,
        hasAnswer: payload.answer.length > 0,
        usedChunks: payload.answer.length > 0 ? resolvedChunks : [],
      };
    } catch (error) {
      const isLastAttempt = attempt === MAX_RETRIES;

      if (error instanceof AnswerGenerationError || isLastAttempt || !isRetryableError(error)) {
        if (error instanceof AnswerGenerationError) throw error;

        // 利用制限は待てば復旧するため、原因と待ち時間が分かる文言に切り替える
        if (isRateLimitError(error)) {
          throw new AnswerGenerationError(RATE_LIMIT_MESSAGE, {
            cause: error,
            isRateLimit: true,
          });
        }

        throw new AnswerGenerationError(
          '回答の取得に失敗しました。もう一度お試しください。',
          { cause: error }
        );
      }

      // レート制限・一時的な障害は待ち時間を延ばして再試行する
      await delay(RETRY_BASE_DELAY_MS * 2 ** attempt);
    }
  }

  throw new AnswerGenerationError('回答の取得に失敗しました。もう一度お試しください。');
}
