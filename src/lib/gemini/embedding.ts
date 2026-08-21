import { GoogleGenAI } from '@google/genai';

/**
 * Gemini Embedding生成（要件F-01）
 *
 * 【重要】文書側（文書取り込み側）とクエリ側（検索API側）で、
 * 必ず同じモデル・同じ次元数を使うこと。
 * 異なるとベクトル空間がずれ、検索が機能しなくなる。
 */

/**
 * 使用するEmbeddingモデル。
 *
 * `gemini-embedding-2` を採用した理由：
 * 768次元へ切り詰めた場合でも自動でL2正規化される（実測でノルム1.0000）。
 * 旧 `gemini-embedding-001` は同条件でノルム0.6007となり手動正規化が必要で、
 * 実装ミスの余地が残るため避けた。
 */
export const EMBEDDING_MODEL = 'gemini-embedding-2';

/**
 * 出力次元数。DBスキーマ `document_chunks.embedding vector(768)` と一致させること。
 *
 * 768を選んだ理由：pgvectorのインデックス（HNSW）は最大2000次元までのため、
 * デフォルトの3072次元ではインデックスを作成できない。
 */
export const EMBEDDING_DIMENSIONS = 768;

/**
 * Embeddingの用途。対になる指定をして初めて検索精度が上がるため、
 * 文書取り込みとクエリで必ず使い分けること。
 */
export type EmbeddingTaskType =
  /** 文書の取り込み時（文書取り込み側） */
  | 'RETRIEVAL_DOCUMENT'
  /** 検索クエリ時（検索API側） */
  | 'RETRIEVAL_QUERY';

/**
 * 1リクエストで送るテキスト数。
 * 大きくしすぎるとリクエストが重くなり、失敗時の再実行コストも上がるため控えめにする。
 */
const BATCH_SIZE = 20;

/** レート制限時のリトライ設定 */
const MAX_RETRIES = 4;
const RETRY_BASE_DELAY_MS = 2000;

/**
 * バッチ間に空ける待ち時間（ミリ秒）。
 * 連続でリクエストするとレート制限（429）に当たるため、意図的に間隔を空ける。
 * 文書数が増えるほど効いてくる。
 */
const BATCH_INTERVAL_MS = 500;

/** Embedding生成で発生する想定内のエラー */
export class EmbeddingError extends Error {
  readonly userMessage: string;

  constructor(userMessage: string, options?: { cause?: unknown }) {
    super(userMessage, options);
    this.name = 'EmbeddingError';
    this.userMessage = userMessage;
  }
}

let client: GoogleGenAI | null = null;

/**
 * Geminiクライアントを取得する（初回のみ生成）。
 *
 * モジュール読み込み時ではなく呼び出し時に環境変数を確認する。
 * 読み込んだだけでエラーになると、UIのビルド時などに巻き込みで失敗するため。
 */
function getClient(): GoogleGenAI {
  if (client) return client;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new EmbeddingError(
      'GEMINI_API_KEY が設定されていません。.env.local を確認してください。'
    );
  }

  client = new GoogleGenAI({ apiKey: apiKey.trim() });
  return client;
}

/** ベクトルをL2正規化する（長さを1にする） */
function normalizeVector(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return values;

  return values.map((value) => value / norm);
}

/** 指定ミリ秒待つ */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** レート制限・一時的な障害かどうかを判定する */
function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /429|503|rate limit|quota|unavailable|timeout/i.test(message);
}

/**
 * テキスト1バッチ分のEmbeddingを生成する。
 * レート制限に当たった場合は待ち時間を延ばしながら再試行する。
 */
async function embedBatch(texts: string[], taskType: EmbeddingTaskType): Promise<number[][]> {
  const ai = getClient();

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await ai.models.embedContent({
        model: EMBEDDING_MODEL,
        // 文字列の配列をそのまま渡すと「1件の複数パート」として扱われ、
        // 結果が1件にまとめられてしまう。Contentオブジェクトの配列で渡すこと
        contents: texts.map((text) => ({ parts: [{ text }] })),
        config: {
          taskType,
          // 指定しないと3072次元が返り、DBスキーマ vector(768) と不一致になる
          outputDimensionality: EMBEDDING_DIMENSIONS,
        },
      });

      const embeddings = response.embeddings;
      if (!embeddings || embeddings.length !== texts.length) {
        throw new EmbeddingError(
          `Embeddingの生成結果が不正です（要求${texts.length}件 / 取得${embeddings?.length ?? 0}件）。`
        );
      }

      return embeddings.map((embedding, index) => {
        const values = embedding.values;

        if (!values || values.length !== EMBEDDING_DIMENSIONS) {
          throw new EmbeddingError(
            `Embeddingの次元数が想定と異なります（期待${EMBEDDING_DIMENSIONS} / 実際${values?.length ?? 0}）。` +
              `${index + 1}件目のテキストで発生しました。`
          );
        }

        // gemini-embedding-2 は自動正規化されるが、モデルを変更した場合に
        // 正規化漏れが起きないよう、念のためここでも長さを1に揃える
        return normalizeVector(values);
      });
    } catch (error) {
      const isLastAttempt = attempt === MAX_RETRIES;

      if (error instanceof EmbeddingError || isLastAttempt || !isRetryableError(error)) {
        if (error instanceof EmbeddingError) throw error;

        throw new EmbeddingError(
          'Embeddingの生成に失敗しました。しばらく待ってから再度お試しください。',
          { cause: error }
        );
      }

      // レート制限に当たった場合は待ち時間を倍にしながら再試行する
      await delay(RETRY_BASE_DELAY_MS * 2 ** attempt);
    }
  }

  throw new EmbeddingError('Embeddingの生成に失敗しました。しばらく待ってから再度お試しください。');
}

/**
 * 複数テキストのEmbeddingを生成する。
 *
 * @param texts 対象テキスト（チャンク本文など）
 * @param taskType 文書取り込みなら RETRIEVAL_DOCUMENT、検索クエリなら RETRIEVAL_QUERY
 * @returns 入力と同じ順序のベクトル配列
 */
export async function generateEmbeddings(
  texts: string[],
  taskType: EmbeddingTaskType
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const empty = texts.findIndex((text) => text.trim().length === 0);
  if (empty >= 0) {
    throw new EmbeddingError(`空のテキストはEmbeddingできません（${empty + 1}件目）。`);
  }

  const results: number[][] = [];

  // 一度に大量送信せず、バッチへ分けて順に処理する
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    // 2バッチ目以降は間隔を空けてレート制限を避ける
    if (i > 0) await delay(BATCH_INTERVAL_MS);

    const batch = texts.slice(i, i + BATCH_SIZE);
    results.push(...(await embedBatch(batch, taskType)));
  }

  return results;
}

/**
 * テキスト1件のEmbeddingを生成する。
 * 検索クエリのように単発で使う場合に利用する。
 */
export async function generateEmbedding(
  text: string,
  taskType: EmbeddingTaskType
): Promise<number[]> {
  const [embedding] = await generateEmbeddings([text], taskType);
  return embedding;
}
