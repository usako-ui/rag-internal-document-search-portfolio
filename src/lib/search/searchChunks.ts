import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * ベクトル類似検索（TB-02・TB-03 / 要件F-02）
 *
 * Worktree A が作成した `match_chunks` RPC関数を呼び出し、
 * 質問ベクトルに近いチャンクを類似度順で取得する。
 * 出典表示（F-04）に必要な文書名・ページ番号・参照箇所も同時に返るため、
 * documents テーブルを別途参照する必要はない。
 */

/**
 * 類似度の閾値（Q-02）。
 *
 * requirements.md の初期値は0.7だが、Worktree A のサンプル5文書での実測により
 * 0.62を採用する。根拠は以下の2点。
 *  - 正解チャンクの類似度（上位1件の平均）は 0.68。0.7では正解が弾かれてしまう
 *  - 文書に記載がない質問での最高スコアは 0.57。0.62なら文書外は0件のままにできる
 *
 * これより下げるとハルシネーション（文書にない情報での回答）のリスクが上がるため、
 * 変更する場合はPhase VAL（12問の精度検証）の結果を根拠にすること。
 */
export const SIMILARITY_THRESHOLD = 0.62;

/**
 * 取得するチャンク数の上限（requirements.md 4-2：上位3〜5件）。
 * 多くするほど回答の材料は増えるが、無関係な文脈が混ざり回答精度が落ちる。
 */
export const MATCH_COUNT = 5;

/** `match_chunks` RPC の戻り値1件分 */
export type MatchedChunk = {
  chunk_id: string;
  document_id: string;
  document_name: string;
  department: string | null;
  content: string;
  chunk_index: number;
  page_number: number | null;
  section: string | null;
  /** 類似度。1に近いほど質問に近い */
  similarity: number;
};

/** 検索処理で発生する想定内のエラー */
export class SearchError extends Error {
  /** UIへそのまま表示してよいメッセージ */
  readonly userMessage: string;

  constructor(userMessage: string, options?: { cause?: unknown }) {
    super(userMessage, options);
    this.name = 'SearchError';
    this.userMessage = userMessage;
  }
}

/** 検索オプション（精度検証で閾値・件数を振るために外から差し替えられるようにする） */
export type SearchChunksOptions = {
  threshold?: number;
  matchCount?: number;
};

/**
 * 質問ベクトルに近いチャンクを取得する。
 *
 * @param supabase 認証済みユーザーのSupabaseクライアント（RLSが適用される）
 * @param queryEmbedding 768次元のクエリベクトル
 * @returns 類似度順のチャンク配列。**0件は「該当情報なし」を意味する**（has_answer: false）
 */
export async function searchChunks(
  supabase: SupabaseClient,
  queryEmbedding: number[],
  options: SearchChunksOptions = {}
): Promise<MatchedChunk[]> {
  const threshold = options.threshold ?? SIMILARITY_THRESHOLD;
  const matchCount = options.matchCount ?? MATCH_COUNT;

  const { data, error } = await supabase.rpc('match_chunks', {
    // pgvectorのvector型へは配列ではなく文字列（'[0.1,0.2,...]'）として渡す
    query_embedding: JSON.stringify(queryEmbedding),
    match_threshold: threshold,
    match_count: matchCount,
  });

  if (error) {
    throw new SearchError('社内文書の検索に失敗しました。もう一度お試しください。', {
      cause: error,
    });
  }

  const matches = (data ?? []) as MatchedChunk[];

  // RPC側でも閾値で除外しているが、呼び出し時の引数指定漏れや
  // 関数の既定値変更で閾値が緩むと、無関係なチャンクが回答の根拠になってしまう。
  // ハルシネーション抑制は最重要要件のため、ここでも必ず確認する。
  return matches.filter((match) => match.similarity >= threshold);
}
