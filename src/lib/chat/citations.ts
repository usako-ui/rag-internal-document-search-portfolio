import type { MatchedChunk } from '@/lib/search/searchChunks';

/**
 * 出典（citations）の組み立て（TB-08 / 要件F-04）
 *
 * 回答の根拠として使用したチャンクから、UIへ表示する出典情報を作る。
 * 複数文書を参照した場合はすべての文書を返す（F-04 AC）。
 */

/**
 * APIレスポンスの出典1件分（requirements.md セクション7の仕様）。
 *
 * `page` と `section` は文書側に情報が無い場合があるため null を許容する。
 * 空文字を返すとUIで「p.」だけのラベルが出てしまうため、
 * 「情報が無い」ことが分かる null にしている。
 */
export type Citation = {
  document_name: string;
  /** 例：p.3。ページ番号が無い場合は null */
  page: string | null;
  /** 例：第3条。見出しが取れなかった場合は null */
  section: string | null;
  document_id: string;
  /**
   * 根拠になった該当箇所の本文（Phase ENH TE-06で追加）。
   * 出典クリック時のモーダルで原文を示すために使う。
   */
  content: string;
};

/**
 * チャンク配列から出典を組み立てる。
 *
 * 同じ文書の同じページ・同じ見出しのチャンクが複数返ることがあるため、
 * 重複を除いて表示件数を絞る（同じ出典が並ぶと根拠が確認しづらくなる）。
 *
 * @param chunks 回答の根拠として使用したチャンク
 * @returns 類似度の高い順に並べた出典配列
 */
export function buildCitations(chunks: MatchedChunk[]): Citation[] {
  const citations: Citation[] = [];
  const seen = new Set<string>();

  // 根拠として近いものから表示する
  const sorted = [...chunks].sort((a, b) => b.similarity - a.similarity);

  for (const chunk of sorted) {
    const key = `${chunk.document_id}|${chunk.page_number ?? ''}|${chunk.section ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    citations.push({
      document_name: chunk.document_name,
      page: chunk.page_number !== null ? `p.${chunk.page_number}` : null,
      section: chunk.section,
      document_id: chunk.document_id,
      content: chunk.content,
    });
  }

  return citations;
}
