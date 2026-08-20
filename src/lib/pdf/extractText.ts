import { PDFParse } from 'pdf-parse';
import {
  MAX_PDF_SIZE_BYTES,
  createNoTextError,
  createSizeExceededError,
  createUnreadableError,
} from './errors';

/**
 * PDFテキスト抽出（TA-01・TA-02 / 要件F-01）
 *
 * ページ単位でテキストを取り出すのが重要な点。
 * 出典表示（F-04）で「文書名＋ページ番号」を示す必要があるため、
 * 全文を1本の文字列にまとめてしまうとページを特定できなくなる。
 */

/** 1ページ分の抽出結果 */
export type ExtractedPage = {
  /** 1始まりのページ番号 */
  pageNumber: number;
  text: string;
};

/** 1文書分の抽出結果 */
export type ExtractedDocument = {
  pageCount: number;
  pages: ExtractedPage[];
  /** 全ページを結合したテキスト（件数確認・デバッグ用） */
  fullText: string;
};

/**
 * NFKC正規化で変換されない文字の補正表。
 *
 * PDFのフォント定義によっては、通常の漢字ではなく「CJK部首補助」
 * （U+2E80〜U+2EFF）の文字が返ってくることがある。
 * 康熙部首（U+2F00〜）はNFKCで通常の漢字へ直るが、CJK部首補助は直らないため個別に対応する。
 *
 * 例：「部⾨⻑」の「⻑」は U+2ED1 であり、通常の「長」U+9577 とは別の文字。
 * 放置すると「部門長」で検索してもヒットしなくなる。
 */
const RADICAL_SUPPLEMENT_MAP: Record<string, string> = {
  '⻑': '長', // U+2ED1 → 長（「部門長」「上長」で発生）
  '⺠': '民', // U+2EA0 → 民（「国民の祝日」で発生）
};

/**
 * 行が見出し・箇条書きかどうかを判定する。
 * 見出しは紙面の折り返しではないため、次の行と連結してはいけない。
 */
function isHeadingLine(line: string): boolean {
  return /^(\d+[.．)]|第[０-９0-9一二三四五六七八九十]+[章条節]|[・•▪-])/.test(line.trim());
}

/**
 * PDFの行折り返しによる改行を取り除き、1つの文へ戻す。
 *
 * PDFは紙面の幅で機械的に改行されるため、「…承認を得」「る。」のように
 * 文の途中で行が分かれる。そのままチャンク化すると文が分断され、検索精度が落ちる。
 *
 * 見出しも折り返し行もどちらも句点で終わらないため、
 * 「その行がページ内で十分に長いか」で折り返しかどうかを判定する。
 * 紙面の幅いっぱいまで文字が入っている行は折り返しとみなす。
 */
function joinWrappedLines(lines: string[]): string[] {
  if (lines.length === 0) return [];

  const maxLength = Math.max(...lines.map((line) => line.length));
  // 最長行の85%以上を「紙面の幅いっぱい」とみなす
  const wrapThreshold = maxLength * 0.85;

  const joined: string[] = [];
  let buffer = '';

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const next = lines[i + 1];

    buffer += line;

    const isWrapped =
      next !== undefined &&
      line.length >= wrapThreshold &&
      // 句読点・閉じ括弧で終わる行は文が完結しているため連結しない
      !/[。、．，!?！？：:；;)）」』】\]]$/.test(line) &&
      // 次の行が見出し・箇条書きなら連結しない
      !isHeadingLine(next) &&
      // 「株式会社テックブリッジ/改定日: 2025年7月1日/管轄: 人事部」のような
      // 区切り記号を含むメタ情報行は、長くても折り返しではないため連結しない
      !line.includes('/') &&
      // 日本語同士のときだけ連結する（英文は単語の区切りにスペースが必要なため）
      /[ぁ-んァ-ヶ一-龯]$/.test(line) &&
      /^[ぁ-んァ-ヶ一-龯]/.test(next);

    if (!isWrapped) {
      joined.push(buffer);
      buffer = '';
    }
  }

  if (buffer.length > 0) joined.push(buffer);

  return joined;
}

/**
 * 抽出テキストを検索に適した形へ整える。
 *
 * PDFの抽出結果はそのままでは検索精度を落とす要因を多く含むため、以下の順で正規化する。
 * ここでの処理はRAGの精度に直結する。
 *
 *  1. Unicode正規化（NFKC）… 康熙部首・全角英数・半角カナを通常の文字へ統一する
 *  2. CJK部首補助の補正     … NFKCで直らない文字を個別に置換する
 *  3. 行折り返しの結合       … 紙面の幅で切れた文を1つへ戻す
 *  4. 空白の整理             … 連続空白・余分な空行をまとめる
 */
function normalizeText(text: string): string {
  // 1. Unicode正規化。「改定⽇」の「⽇」（康熙部首 U+2F47）を「日」へ揃える
  let normalized = text.normalize('NFKC');

  // 2. NFKCで変換されない文字を補正する
  for (const [from, to] of Object.entries(RADICAL_SUPPLEMENT_MAP)) {
    normalized = normalized.split(from).join(to);
  }

  // 3. 行ごとに空白を整えてから、紙面の折り返しを結合する
  const lines = normalized
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t　]+/g, ' ').trim())
    .filter((line) => line.length > 0);

  // 4. 折り返しを結合し、余分な空行をまとめる
  return joinWrappedLines(lines).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * PDFのバイナリからページ単位でテキストを抽出する。
 *
 * @param data PDFのバイナリ
 * @throws PdfProcessingError サイズ超過・解析失敗・テキストなしの場合
 */
export async function extractTextFromPdf(data: Buffer | Uint8Array): Promise<ExtractedDocument> {
  // サイズ確認は解析前に行う（大きなファイルの解析で時間を浪費しないため）
  if (data.byteLength > MAX_PDF_SIZE_BYTES) {
    throw createSizeExceededError(data.byteLength);
  }

  const parser = new PDFParse({ data });

  let result;
  try {
    result = await parser.getText();
  } catch (error) {
    // 破損・暗号化・PDF以外のファイルなどはここに来る
    throw createUnreadableError(error);
  } finally {
    // 解析用のリソースを必ず解放する
    await parser.destroy();
  }

  const pages: ExtractedPage[] = result.pages
    .map((page) => ({
      pageNumber: page.num,
      text: normalizeText(page.text ?? ''),
    }))
    // 空白ページはチャンク化しても意味がないため除外する
    .filter((page) => page.text.length > 0);

  if (pages.length === 0) {
    throw createNoTextError();
  }

  return {
    pageCount: result.total,
    pages,
    fullText: pages.map((page) => page.text).join('\n\n'),
  };
}
