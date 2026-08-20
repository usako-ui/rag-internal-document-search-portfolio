import type { ExtractedDocument } from './extractText';

/**
 * PDFから文書メタデータ（文書名・管轄部署）を推定する
 *
 * 出典表示（F-04）では「参照文書：リモートワーク規程」のように文書名を出すため、
 * ファイル名（case3-doc4-remote-work.pdf）をそのまま使うと利用者に伝わらない。
 * 社内規程はたいてい1行目が文書タイトル、2行目に管轄部署が書かれているため、そこから読み取る。
 *
 * 推定できない場合はファイル名へフォールバックする。
 * 取り込み時に明示指定があれば、そちらを常に優先する。
 */

/** 文書名として採用しない行のパターン（社名・日付だけの行など） */
const NON_TITLE_PATTERN = /^(株式会社|有限会社|\d|改定|作成|発行|管轄|本書)/;

/** 文書名の妥当な長さ（極端に長い行は本文とみなす） */
const MAX_TITLE_LENGTH = 40;

/**
 * 1ページ目の先頭から文書タイトルを推定する。
 * 例：「就業規則（抜粋）」「リモートワーク規程」
 */
export function extractDocumentTitle(document: ExtractedDocument): string | null {
  const firstPage = document.pages[0];
  if (!firstPage) return null;

  // 先頭5行までを候補とする（それ以降は本文の可能性が高い）
  for (const line of firstPage.text.split('\n').slice(0, 5)) {
    const candidate = line.trim();

    if (candidate.length === 0 || candidate.length > MAX_TITLE_LENGTH) continue;
    if (NON_TITLE_PATTERN.test(candidate)) continue;

    return candidate;
  }

  return null;
}

/**
 * 「管轄: 人事部・情報システム部」のような行から管轄部署を読み取る。
 *
 * MVPでは絞り込みに使わないが、Phase 2の部署別アクセス制御に備えて保持する
 * （project-overview.md セクション8）。
 */
export function extractDepartment(document: ExtractedDocument): string | null {
  const firstPage = document.pages[0];
  if (!firstPage) return null;

  for (const line of firstPage.text.split('\n').slice(0, 5)) {
    // 「／管轄: 人事部・情報システム部」「管轄：経理部」などに対応する
    const matched = line.match(/管轄\s*[:：]\s*([^/／\n]+)/);
    if (matched) {
      return matched[1].trim();
    }
  }

  return null;
}
