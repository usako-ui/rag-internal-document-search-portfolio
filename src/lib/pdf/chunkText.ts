import type { ExtractedDocument } from './extractText';

/**
 * チャンキング処理（TA-03 / 要件F-01・requirements.md セクション4-1）
 *
 * 設計方針：
 *  1. **ページ単位で分割する** — 出典表示（F-04）で正確なページ番号を示すため。
 *     全文をまたいで分割すると、チャンクがどのページ由来か特定できなくなる。
 *  2. **文の途中で切らない** — 「在宅勤務手当は月額5,000円」が
 *     「在宅勤務手当は月額」と「5,000円」に分断されると検索精度が落ちる。
 *  3. **オーバーラップを持たせる** — チャンク境界にまたがる情報を拾えるようにする。
 *
 * チャンクサイズ・オーバーラップの初期値は tasks.md Q-01 の通り暫定値。
 * Phase VAL（12問の精度検証）の結果を見て調整する。
 */

/** チャンキング設定 */
export type ChunkOptions = {
  /** 1チャンクの目標トークン数 */
  targetTokens: number;
  /** 1チャンクの上限トークン数。1文がこれを超える場合のみ文中で分割する */
  maxTokens: number;
  /** 次のチャンクへ引き継ぐオーバーラップのトークン数 */
  overlapTokens: number;
};

/**
 * チャンク設定（requirements.md セクション4-1：300〜500トークン・オーバーラップ50〜100）
 *
 * サンプル5文書で実測して決定した（`npm run tune:chunking`）。
 * 8つの質問に対する検索結果を比較したところ、どの設定でも
 * 答えを含むチャンクは上位3件に入ったが、「正解のスコア」と
 * 「文書に無い質問のスコア」の差（分離度）に違いが出た。
 *
 * | 設定          | チャンク数 | 分離度 |
 * |---------------|-----------|--------|
 * | 400/500/80    | 13        | 0.1068 |
 * | 300/400/60 ←  | 16        | 0.1138 |
 * | 200/300/50    | 22        | 0.1171 |
 * | 100/200/40    | 48        | 0.1328 |
 *
 * 分離度は小さいチャンクほど良くなるが、requirements.md が定める
 * 300〜500トークンの範囲内で最良の 300/400/60 を採用した。
 * 範囲外の設定を使う場合はクライアント確認が必要なため。
 *
 * Phase VAL（12問の精度検証）の結果を見て再調整する。
 */
export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  targetTokens: 300,
  maxTokens: 400,
  overlapTokens: 60,
};

/** 分割後のチャンク1件 */
export type TextChunk = {
  /** 文書内での通し番号（0始まり）。document_chunks.chunk_index に対応する */
  chunkIndex: number;
  content: string;
  /** このチャンクの出典ページ番号 */
  pageNumber: number;
  /**
   * チャンク内の最初の見出し（例：「第3条（在宅勤務手当）」「4.2.3 在宅勤務に係る費用の精算」）。
   * 出典表示（F-04）の「参照箇所」に使う。見出しが無いチャンクでは null。
   */
  heading: string | null;
  charCount: number;
  estimatedTokens: number;
};

/**
 * 条項・節の見出しを表すパターン。
 * 「第3条（在宅勤務手当）」「4.2.3 費用の精算」「1. 精算の基本フロー」に対応する。
 */
const HEADING_PATTERN =
  /^(第[0-9０-９一二三四五六七八九十百]+[章条節項](?:[（(][^）)]*[）)])?|[0-9]+(?:\.[0-9]+)*\.?(?=\s|　))/;

/** 見出しとして扱う行の最大長。これより長い行は本文とみなす */
const MAX_HEADING_LENGTH = 40;

/**
 * 1行が見出しかどうかを判定する。
 */
function isSectionHeading(line: string): boolean {
  const trimmed = line.trim();

  if (trimmed.length === 0 || trimmed.length > MAX_HEADING_LENGTH) return false;
  // 句点で終わる行は本文（番号付きの箇条書きなど）であり見出しではない
  if (/[。．]$/.test(trimmed)) return false;

  return HEADING_PATTERN.test(trimmed);
}

/** 見出しと、その配下の本文をまとめた単位 */
type DocumentSection = {
  heading: string | null;
  text: string;
};

/**
 * ページのテキストを見出し境界でセクションへ分割する。
 *
 * 【なぜ見出しで区切るのか】
 * 文字数だけで機械的に分割すると、1つのチャンクに
 * 「第1章 勤務時間・休憩」と「第2章 休日・休暇」が混在してしまう。
 * その場合、有給休暇について答えたのに出典が「第1章 勤務時間・休憩」と表示され、
 * 利用者が原文を確認しにいっても該当箇所が見つからない（F-04の出典表示が破綻する）。
 *
 * 見出しごとに区切れば「1チャンク＝1セクション」となり、出典の参照箇所が必ず正しくなる。
 * 意味のまとまりが揃うため検索精度にも有利に働く。
 *
 * 見出しより前にある文書タイトル・改定日などの前文は heading: null のセクションとして扱う。
 */
function splitIntoSections(text: string): DocumentSection[] {
  const sections: DocumentSection[] = [];

  let currentHeading: string | null = null;
  let currentLines: string[] = [];

  const flushSection = () => {
    const body = currentLines.join('\n').trim();
    if (body.length > 0) {
      sections.push({ heading: currentHeading, text: body });
    }
  };

  for (const line of text.split('\n')) {
    if (isSectionHeading(line)) {
      // 直前までのセクションを確定し、新しい見出しから次を始める
      flushSection();
      currentHeading = line.trim();
      currentLines = [line.trim()];
      continue;
    }

    currentLines.push(line);
  }

  flushSection();

  return sections;
}

/**
 * トークン数を概算する。
 *
 * 正確なトークン数はGeminiのトークナイザでしか分からないが、
 * チャンク分割のたびにAPIを呼ぶのは非効率なため文字種から見積もる。
 * 日本語（かな・漢字・全角記号）はおよそ1文字1トークン、
 * 英数字はおよそ4文字1トークンとして計算する。
 */
export function estimateTokens(text: string): number {
  const japaneseCharCount = (
    text.match(/[　-ヿ㐀-䶿一-鿿＀-￯]/g) ?? []
  ).length;
  const otherCharCount = text.length - japaneseCharCount;

  return Math.ceil(japaneseCharCount + otherCharCount / 4);
}

/**
 * テキストを文単位へ分割する。
 * 日本語の句点（。！？）と改行を区切りとし、区切り文字は文末に残す。
 *
 * 句点で終わらない行（「第3条（在宅勤務手当）」のような見出しや箇条書き）は、
 * 末尾に改行を残して本文と区別できるようにする。
 * 見出しが本文と一続きになると、回答生成時にどこからが条文か読み取りにくくなるため。
 */
function splitIntoSentences(text: string): string[] {
  const sentences: string[] = [];

  for (const line of text.split('\n')) {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0) continue;

    // 句点・感嘆符・疑問符の直後で区切る（閉じ括弧が続く場合はそこまで含める）
    const parts = trimmedLine.match(/[^。！？!?]*[。！？!?]+[」』）\)]*|[^。！？!?]+$/g);
    if (!parts) continue;

    const cleaned = parts.map((part) => part.trim()).filter((part) => part.length > 0);
    if (cleaned.length === 0) continue;

    // 行が句点で終わっていない＝見出し・箇条書きとみなし、前後に改行を付けて独立させる
    const isHeadingLine = !/[。！？!?][」』）\)]*$/.test(trimmedLine);
    if (isHeadingLine) {
      cleaned[cleaned.length - 1] = `\n${cleaned[cleaned.length - 1]}\n`;
    }

    sentences.push(...cleaned);
  }

  return sentences;
}

/**
 * 上限トークン数を超える長い文を、やむを得ず文字数で分割する。
 * 箇条書きが句点なしで延々と続くPDFなどで発生する。
 */
function splitLongSentence(sentence: string, maxTokens: number): string[] {
  const estimated = estimateTokens(sentence);
  if (estimated <= maxTokens) return [sentence];

  // 1文字あたりの平均トークン数から、上限に収まる文字数を逆算する
  const tokensPerChar = estimated / sentence.length;
  const charsPerChunk = Math.max(1, Math.floor(maxTokens / tokensPerChar));

  const parts: string[] = [];
  for (let i = 0; i < sentence.length; i += charsPerChunk) {
    parts.push(sentence.slice(i, i + charsPerChunk));
  }

  return parts;
}

/**
 * オーバーラップとして引き継ぐ文を、末尾から選び出す。
 * 指定トークン数を超えない範囲で、できるだけ多くの文を残す。
 */
function selectOverlapSentences(sentences: string[], overlapTokens: number): string[] {
  const selected: string[] = [];
  let tokens = 0;

  for (let i = sentences.length - 1; i >= 0; i -= 1) {
    const sentenceTokens = estimateTokens(sentences[i]);
    if (tokens + sentenceTokens > overlapTokens) break;

    selected.unshift(sentences[i]);
    tokens += sentenceTokens;
  }

  return selected;
}

/**
 * 1セクション分のテキストを、目標トークン数に収まるよう分割する。
 * セクションが目標サイズ以下ならそのまま1チャンクになる。
 */
function chunkSectionText(text: string, options: ChunkOptions): string[] {
  const sentences = splitIntoSentences(text).flatMap((sentence) =>
    splitLongSentence(sentence, options.maxTokens)
  );

  if (sentences.length === 0) return [];

  const chunks: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const sentence of sentences) {
    const sentenceTokens = estimateTokens(sentence);

    // 目標サイズを超えるなら、いったんチャンクを確定してオーバーラップを引き継ぐ
    if (current.length > 0 && currentTokens + sentenceTokens > options.targetTokens) {
      chunks.push(current.join(''));

      const overlap = selectOverlapSentences(current, options.overlapTokens);
      current = [...overlap];
      currentTokens = overlap.reduce((sum, item) => sum + estimateTokens(item), 0);
    }

    current.push(sentence);
    currentTokens += sentenceTokens;
  }

  if (current.length > 0) {
    chunks.push(current.join(''));
  }

  return chunks
    // 見出しの前後に付けた改行が重複することがあるため整える
    .map((chunk) => chunk.replace(/\n{2,}/g, '\n').trim())
    .filter((chunk) => chunk.length > 0);
}

/**
 * 抽出済み文書をチャンクへ分割する。
 *
 * ページ単位で分割するため、各チャンクは必ず1つのページに紐づく。
 * これにより出典（F-04）で正確なページ番号を表示できる。
 */
export function chunkDocument(
  document: ExtractedDocument,
  options: ChunkOptions = DEFAULT_CHUNK_OPTIONS
): TextChunk[] {
  const chunks: TextChunk[] = [];
  let chunkIndex = 0;

  // ページをまたいで継続する見出しを保持する。
  // 「第5章 退職」がページ末尾にあり本文が次ページから始まる場合、
  // 引き継がないと次ページのチャンクに出典の参照箇所が付かなくなる。
  let carriedHeading: string | null = null;

  for (const page of document.pages) {
    for (const section of splitIntoSections(page.text)) {
      // 見出しの無いセクション（ページ先頭の継続部分）は前ページの見出しを引き継ぐ
      const heading = section.heading ?? carriedHeading;

      // 見出し行を除いた本文
      const body = section.heading
        ? section.text.slice(section.heading.length).trim()
        : section.text.trim();

      // 見出しだけで本文が無いセクションはチャンクにしない。
      // 情報を持たないチャンクは検索ノイズになるだけなので、見出しだけを次へ引き継ぐ
      if (body.length === 0) {
        if (section.heading) carriedHeading = section.heading;
        continue;
      }

      for (const content of chunkSectionText(section.text, options)) {
        chunks.push({
          chunkIndex,
          content,
          pageNumber: page.pageNumber,
          heading,
          charCount: content.length,
          estimatedTokens: estimateTokens(content),
        });
        chunkIndex += 1;
      }

      carriedHeading = heading;
    }
  }

  return chunks;
}
