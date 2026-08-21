/**
 * 精度検証レポート用のSVG画像を生成する（納品フェーズ）
 *
 * `docs/validation/rag-accuracy-report.md` へ埋め込む図版を、
 * 検証結果の数値からコードで生成する。
 *
 * 【なぜ画像を手で作らないか】
 * 精度の数値は検証をやり直すたびに変わりうる。
 * 図版を手作業で作ると、本文だけ更新されて画像が古いまま残る。
 * 実際に「本文は90%のまま、実測は100%」という食い違いが発生したため、
 * 数値を1か所（下記 RESULTS）に集約し、そこから生成する形にした。
 *
 * 【なぜPNGではなくSVGか】
 *  - 文字が画像化されないため、拡大しても潰れない（資料へ貼っても読める）
 *  - テキストとして検索・コピーできる
 *  - ファイルサイズが小さく、差分もGitで追える
 *
 * 【アイコンについて】
 * UI/UX仕様のルールに従い、Lucide Icons のパスのみを使う。
 * 絵文字・イラストは使用しない。
 *
 * 実行：npm run generate:report-images
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** 出力先。rag-accuracy-report.md から相対パス `images/` で参照する */
const OUTPUT_DIR = resolve(process.cwd(), 'docs/validation/images');

/**
 * デザイントークン（UI/UX仕様のカラートークンと一致させること）。
 * 画面と資料で色が食い違うと、同じ製品に見えなくなる。
 */
const COLOR = {
  navy: '#0F1E3A',
  green: '#1DBA8C',
  greenBg: '#F0FDF9',
  border: '#E2E8F0',
  textSub: '#6B7280',
  textBody: '#1F2937',
  bgPage: '#F8FAFC',
  white: '#FFFFFF',
} as const;

/** 画面と揃えた日本語フォントスタック */
const FONT = "'Hiragino Kaku Gothic ProN', 'Noto Sans JP', system-ui, sans-serif";

/**
 * 検証結果。**ここだけを更新すれば両方の画像へ反映される。**
 *
 * 出典：docs/validation/rag-evaluation-sheet.md（`npm run validate:rag` の自動出力）
 * 最終検証日：2026年8月20日
 */
const RESULTS = {
  cards: [
    { label: '検索精度', value: '100%', sub: '10問中10問', icon: 'search', badge: null },
    { label: '回答精度', value: '100%', sub: '10問中10問', icon: 'check', badge: '目標80%達成' },
    { label: '出典表示', value: '100%', sub: '12問中12問', icon: 'document', badge: null },
    { label: 'ハルシネーション', value: '0件', sub: '12問すべて抑制', icon: 'shield', badge: null },
  ],
  /** 12問の内訳。1〜10は文書あり、11〜12はハルシネーション確認 */
  questionCount: 12,
  withDocument: 10,
} as const;

/** 注意書き。数値の限界を必ず併記する（レポート本文と同じ趣旨） */
const DISCLAIMER = [
  '※ この結果は5文書・12問での検証値です。',
  '　 全社内文書・全質問への精度を保証するものではありません。',
];

/**
 * Lucide Icons のパス定義（24×24のビューポート前提）。
 *
 * 元データのまま保持し、描画時に translate で位置を合わせる。
 * 別のアイコンへ差し替える場合も、必ずLucideのパスを使うこと。
 */
const ICONS: Record<string, string> = {
  // search（虫眼鏡）
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
  // check-circle（チェック）
  check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
  // file-text（ドキュメント）
  document:
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
    '<path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  // shield（シールド）
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
};

/**
 * SVGのテキストへ入れてよい形へ変換する。
 * `&` `<` `>` をそのまま書くとSVGが壊れるため必ず通す。
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** アイコンを指定位置へ描く（Lucideの既定に合わせて線幅2・角丸） */
function icon(name: string, x: number, y: number, color: string): string {
  return `  <g transform="translate(${x} ${y})" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</g>`;
}

// ============================================================
// 1. accuracy-summary.svg（精度検証サマリー）
// ============================================================

function buildAccuracySummary(): string {
  const W = 800;
  const H = 320;
  const PAD = 24;
  const GAP = 16;
  const CARD_Y = 62;
  const CARD_H = 172;
  const cardW = (W - PAD * 2 - GAP * 3) / 4;

  const parts: string[] = [];

  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="RAG精度検証結果サマリー">`);
  parts.push(`  <rect width="${W}" height="${H}" fill="${COLOR.white}"/>`);

  // タイトル
  parts.push(
    `  <text x="${PAD}" y="36" font-family="${FONT}" font-size="16" font-weight="700" fill="${COLOR.textBody}">RAG精度検証結果サマリー</text>`
  );

  RESULTS.cards.forEach((card, index) => {
    const x = PAD + index * (cardW + GAP);
    const cx = x + cardW / 2;

    // カード枠
    parts.push(
      `  <rect x="${x}" y="${CARD_Y}" width="${cardW}" height="${CARD_H}" rx="8" fill="${COLOR.greenBg}" stroke="${COLOR.green}" stroke-width="1"/>`
    );

    // アイコン（24×24を中央へ配置）
    parts.push(icon(card.icon, cx - 12, CARD_Y + 18, COLOR.green));

    // 見出し
    parts.push(
      `  <text x="${cx}" y="${CARD_Y + 66}" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="700" fill="${COLOR.textBody}">${escapeXml(card.label)}</text>`
    );

    // 数値
    parts.push(
      `  <text x="${cx}" y="${CARD_Y + 108}" text-anchor="middle" font-family="${FONT}" font-size="36" font-weight="700" fill="${COLOR.navy}">${escapeXml(card.value)}</text>`
    );

    // サブテキスト
    parts.push(
      `  <text x="${cx}" y="${CARD_Y + 130}" text-anchor="middle" font-family="${FONT}" font-size="12" fill="${COLOR.textSub}">${escapeXml(card.sub)}</text>`
    );

    // バッジ（回答精度のみ）
    if (card.badge) {
      const badgeW = 88;
      const badgeH = 22;
      const badgeY = CARD_Y + 140;
      parts.push(
        `  <rect x="${cx - badgeW / 2}" y="${badgeY}" width="${badgeW}" height="${badgeH}" rx="11" fill="${COLOR.green}"/>`
      );
      parts.push(
        `  <text x="${cx}" y="${badgeY + 15}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="700" fill="${COLOR.white}">${escapeXml(card.badge)}</text>`
      );
    }
  });

  // 注意書き
  DISCLAIMER.forEach((line, i) => {
    parts.push(
      `  <text x="${PAD}" y="${266 + i * 18}" font-family="${FONT}" font-size="11" font-style="italic" fill="${COLOR.textSub}">${escapeXml(line)}</text>`
    );
  });

  parts.push('</svg>');
  return parts.join('\n');
}

// ============================================================
// 2. question-results.svg（12問の結果一覧）
// ============================================================

/** 表の1行分 */
type Row = { no: string; category: string; verdict: string; verdictColor: string };

function buildRows(): Row[] {
  const rows: Row[] = [];

  for (let n = 1; n <= RESULTS.withDocument; n += 1) {
    rows.push({
      no: `問${n}`,
      category: '文書あり',
      verdict: '達成',
      verdictColor: COLOR.green,
    });
  }

  for (let n = RESULTS.withDocument + 1; n <= RESULTS.questionCount; n += 1) {
    rows.push({
      no: `問${n}`,
      category: 'ハルシネーション確認',
      verdict: '正常（回答しなかった）',
      verdictColor: COLOR.textSub,
    });
  }

  return rows;
}

function buildQuestionResults(): string {
  const W = 800;
  const PAD = 24;
  const ROW_H = 32;
  const TABLE_Y = 48;
  const tableW = W - PAD * 2;

  /*
   * 高さは内容から計算する。
   * 固定値にすると、問数や注意書きが増えたときに下端が切れる
   * （実際に注意書きの2行目がはみ出したため、この方式へ変更した）。
   */
  const rowCount = RESULTS.questionCount + 1; // ヘッダー行を含む
  const tableBottom = TABLE_Y + ROW_H * rowCount;
  const noteBaseY = tableBottom + 26;
  const H = Math.max(520, noteBaseY + 24 + (DISCLAIMER.length - 1) * 18 + 16);

  // 列の幅（合計が tableW になるようにする）
  const COL = [
    { key: 'no', label: '問番号', w: 100 },
    { key: 'category', label: '分類', w: 380 },
    { key: 'verdict', label: '判定', w: tableW - 100 - 380 },
  ];

  const rows = buildRows();
  const parts: string[] = [];

  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="12問の検証結果一覧">`);
  parts.push(`  <rect width="${W}" height="${H}" fill="${COLOR.white}"/>`);

  // タイトル
  parts.push(
    `  <text x="${PAD}" y="30" font-family="${FONT}" font-size="14" font-weight="700" fill="${COLOR.textBody}">12問の検証結果一覧</text>`
  );

  // ヘッダー行
  parts.push(
    `  <rect x="${PAD}" y="${TABLE_Y}" width="${tableW}" height="${ROW_H}" fill="${COLOR.navy}"/>`
  );

  let headX = PAD;
  COL.forEach((col) => {
    parts.push(
      `  <text x="${headX + 12}" y="${TABLE_Y + 21}" font-family="${FONT}" font-size="12" font-weight="700" fill="${COLOR.white}">${escapeXml(col.label)}</text>`
    );
    headX += col.w;
  });

  // データ行
  rows.forEach((row, index) => {
    const y = TABLE_Y + ROW_H + index * ROW_H;
    // 奇数行（1行目・3行目…）へ薄い背景を敷く
    const bg = index % 2 === 0 ? COLOR.bgPage : COLOR.white;

    parts.push(`  <rect x="${PAD}" y="${y}" width="${tableW}" height="${ROW_H}" fill="${bg}"/>`);
    parts.push(
      `  <line x1="${PAD}" y1="${y + ROW_H}" x2="${PAD + tableW}" y2="${y + ROW_H}" stroke="${COLOR.border}" stroke-width="1"/>`
    );

    const textY = y + 21;
    parts.push(
      `  <text x="${PAD + 12}" y="${textY}" font-family="${FONT}" font-size="12" font-weight="700" fill="${COLOR.textBody}">${escapeXml(row.no)}</text>`
    );
    parts.push(
      `  <text x="${PAD + COL[0].w + 12}" y="${textY}" font-family="${FONT}" font-size="12" fill="${COLOR.textBody}">${escapeXml(row.category)}</text>`
    );

    // 判定バッジ
    const badgeX = PAD + COL[0].w + COL[1].w + 12;
    const badgeW = row.verdict.length > 4 ? 152 : 52;
    parts.push(
      `  <rect x="${badgeX}" y="${y + 6}" width="${badgeW}" height="20" rx="10" fill="${row.verdictColor}"/>`
    );
    parts.push(
      `  <text x="${badgeX + badgeW / 2}" y="${y + 20}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="700" fill="${COLOR.white}">${escapeXml(row.verdict)}</text>`
    );
  });

  // 表の外枠
  const tableH = ROW_H * (rows.length + 1);
  parts.push(
    `  <rect x="${PAD}" y="${TABLE_Y}" width="${tableW}" height="${tableH}" fill="none" stroke="${COLOR.border}" stroke-width="1" rx="4"/>`
  );

  // 補足と注意書き（高さ計算と同じ位置を使う）
  const noteY = noteBaseY;
  parts.push(
    `  <text x="${PAD}" y="${noteY}" font-family="${FONT}" font-size="11" fill="${COLOR.textSub}">問11・問12は「答えないこと」が正解です。文書に記載のない質問へ推測で答えないかを確認しています。</text>`
  );
  DISCLAIMER.forEach((line, i) => {
    parts.push(
      `  <text x="${PAD}" y="${noteY + 24 + i * 18}" font-family="${FONT}" font-size="11" font-style="italic" fill="${COLOR.textSub}">${escapeXml(line)}</text>`
    );
  });

  parts.push('</svg>');
  return parts.join('\n');
}

// ============================================================

function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const files: { name: string; content: string }[] = [
    { name: 'accuracy-summary.svg', content: buildAccuracySummary() },
    { name: 'question-results.svg', content: buildQuestionResults() },
  ];

  for (const file of files) {
    const path = resolve(OUTPUT_DIR, file.name);
    writeFileSync(path, `${file.content}\n`, 'utf8');
    console.log(`生成: docs/validation/images/${file.name}`);
  }

  console.log('\n検証結果の数値を変更する場合は、このファイルの RESULTS を更新して再実行してください。');
}

main();
