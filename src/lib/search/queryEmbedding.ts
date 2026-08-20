import { generateEmbedding } from '@/lib/gemini/embedding';

/**
 * 検索クエリのEmbedding生成（TB-01 / 要件F-02）
 *
 * 質問テキストを文書側と同じ前処理・同じモデル・同じ次元数でベクトル化する。
 * ここがずれると検索結果が壊れるため、Worktree A の
 * `src/lib/pdf/extractText.ts` の `normalizeText()` と処理を揃えている。
 */

/**
 * 1件の質問として受け付ける最大文字数。
 *
 * Embedding APIへ過大なテキストを送らないための上限。
 * 社内文書への質問としては十分な長さで、これを超える入力は
 * 誤操作（貼り付けミス等）とみなして早い段階で弾く。
 */
export const MAX_QUESTION_LENGTH = 1000;

/**
 * NFKC正規化で変換されない文字の補正表（Q-18）。
 *
 * 【重要】Worktree A の `RADICAL_SUPPLEMENT_MAP` と必ず同じ内容にすること。
 *
 * PDFのフォント定義の都合で、文書側には通常の漢字ではなく
 * 「CJK部首補助」（U+2E80〜U+2EFF）の文字が含まれることがある。
 * 康熙部首（U+2F00〜）はNFKCで通常の漢字へ直るが、CJK部首補助は直らない。
 * 文書側は保存時に補正済みのため、クエリ側でも同じ補正を行わないと
 * 「見た目は同じなのに一致しない」という原因の分からない検索漏れが起きる。
 */
const RADICAL_SUPPLEMENT_MAP: Record<string, string> = {
  '⻑': '長', // U+2ED1 → 長（「部門長」「上長」で発生）
  '⺠': '民', // U+2EA0 → 民（「国民の祝日」で発生）
};

/** 質問テキストが空・長すぎる等、Embedding以前に弾くべき入力のエラー */
export class InvalidQuestionError extends Error {
  /** UIへそのまま表示してよいメッセージ */
  readonly userMessage: string;

  constructor(userMessage: string) {
    super(userMessage);
    this.name = 'InvalidQuestionError';
    this.userMessage = userMessage;
  }
}

/**
 * 質問テキストを文書側と同じ形へ正規化する（Q-18）。
 *
 * 処理順は文書側（Worktree A）と揃えている。
 *  1. Unicode正規化（NFKC）… 康熙部首・全角英数・半角カナを通常の文字へ統一する
 *  2. CJK部首補助の補正     … NFKCで直らない文字を個別に置換する
 *  3. 空白の整理             … 改行・連続空白を単一スペースへまとめる
 *
 * @param question 入力された質問テキスト
 * @returns 正規化済みの質問テキスト
 */
export function normalizeQuery(question: string): string {
  // 1. Unicode正規化。「改定⽇」の「⽇」（康熙部首 U+2F47）を「日」へ揃える
  let normalized = question.normalize('NFKC');

  // 2. NFKCで変換されない文字を補正する
  for (const [from, to] of Object.entries(RADICAL_SUPPLEMENT_MAP)) {
    normalized = normalized.split(from).join(to);
  }

  // 3. 改行・連続空白は検索の意味を持たないため1つのスペースへまとめる
  return normalized.replace(/[\s　]+/g, ' ').trim();
}

/**
 * 質問テキストを検証し、正規化した文字列を返す。
 *
 * @param question APIリクエストで受け取った質問
 * @throws InvalidQuestionError 空文字・空白のみ・文字数超過の場合
 */
export function validateQuestion(question: unknown): string {
  if (typeof question !== 'string') {
    throw new InvalidQuestionError('質問を入力してください。');
  }

  const normalized = normalizeQuery(question);

  if (normalized.length === 0) {
    throw new InvalidQuestionError('質問を入力してください。');
  }

  if (normalized.length > MAX_QUESTION_LENGTH) {
    throw new InvalidQuestionError(
      `質問が長すぎます（${MAX_QUESTION_LENGTH}文字以内で入力してください）。`
    );
  }

  return normalized;
}

/**
 * 質問テキストのEmbedding（768次元）を生成する。
 *
 * `taskType` は検索クエリ用の `RETRIEVAL_QUERY` を指定する。
 * 文書側の `RETRIEVAL_DOCUMENT` と対で指定して初めて検索精度が上がるため、
 * ここを文書側と同じ値にしてはいけない。
 *
 * @param normalizedQuestion `validateQuestion()` で正規化済みの質問
 * @returns 768次元のベクトル
 */
export async function generateQueryEmbedding(normalizedQuestion: string): Promise<number[]> {
  return generateEmbedding(normalizedQuestion, 'RETRIEVAL_QUERY');
}
