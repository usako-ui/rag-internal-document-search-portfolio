/**
 * 開発用：pdf-parse の動作確認に使うテストPDFを生成する
 *
 * 実際の社内文書PDF（サンプル5文書）がまだ配置されていないため、
 * テキスト抽出とページ分割の動作を確認するための代替PDFをここで作る。
 * 実PDFが届いたらこのスクリプトは不要になる。
 *
 * 実行：node scripts/generate-test-pdf.mjs
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(scriptDir, '../data/test/sample-test.pdf');

/** 日本語フォントの候補（Windows標準）。先頭から順に試す */
const JAPANESE_FONT_CANDIDATES = [
  'C:/Windows/Fonts/BIZ-UDGothicR.ttc',
  'C:/Windows/Fonts/msgothic.ttc',
  'C:/Windows/Fonts/meiryo.ttc',
];

/** ページに書き込む内容（実際の社内文書を模した構成） */
const PAGES = [
  {
    title: '第1章 総則',
    lines: [
      '第1条（目的）',
      'この規程は、株式会社テックブリッジの社員の就業に関する事項を定めるものである。',
      '',
      '第2条（適用範囲）',
      'この規程は、当社に在籍するすべての社員に適用する。',
    ],
  },
  {
    title: '第2章 勤務',
    lines: [
      '第3条（在宅勤務手当）',
      '在宅勤務を行う社員に対し、在宅勤務手当として月額5,000円を支給する。',
      '支給対象は、週2日以上の在宅勤務を行う社員とする。',
      '',
      '第4条（勤務時間）',
      '所定労働時間は1日8時間、始業9時00分、終業18時00分とする。',
    ],
  },
  {
    title: '第3章 休暇',
    lines: [
      '第5条（年次有給休暇）',
      '入社後6か月を経過し、全労働日の8割以上出勤した社員に年次有給休暇を付与する。',
      '',
      '第6条（特別休暇）',
      '慶弔等の事由により、別途定める日数の特別休暇を付与する。',
    ],
  },
];

/** 日本語フォントを読み込む。使えるフォントがなければ null を返す */
function loadJapaneseFont() {
  for (const fontPath of JAPANESE_FONT_CANDIDATES) {
    try {
      return { bytes: readFileSync(fontPath), path: fontPath };
    } catch {
      // 次の候補を試す
    }
  }
  return null;
}

/**
 * 埋め込んだフォントで実際に日本語を描画できるかを検証する。
 *
 * Windows標準の日本語フォントはTTC（複数フォントの集合）形式で、
 * pdf-lib は埋め込み自体は通っても描画時に失敗する。
 * 本番のPDFを生成する用途ではないため、ここでは判定してフォールバックする。
 */
async function canRenderJapanese(fontBytes) {
  const probe = await PDFDocument.create();
  probe.registerFontkit(fontkit);

  try {
    const font = await probe.embedFont(fontBytes, { subset: false });
    font.widthOfTextAtSize('あ', 12);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  // 日本語フォントの埋め込みを試みる。
  // WindowsのフォントはTTC（複数フォントの集合）が多く、埋め込めない場合がある。
  // その場合は英字フォントへ切り替えて、抽出とページ分割の確認だけは行えるようにする。
  let font;
  let isJapanese = false;

  const japaneseFont = loadJapaneseFont();
  if (japaneseFont && (await canRenderJapanese(japaneseFont.bytes))) {
    font = await pdfDoc.embedFont(japaneseFont.bytes, { subset: false });
    isJapanese = true;
    console.log(`日本語フォントを埋め込みました: ${japaneseFont.path}`);
  } else {
    font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    console.warn(
      '日本語フォントを埋め込めないため英字フォントで生成します（WindowsのTTC形式は pdf-lib 非対応）。'
    );
    console.warn('日本語PDFからの抽出確認は、サンプルPDF到着後に行ってください。');
  }

  PAGES.forEach((pageContent, index) => {
    const page = pdfDoc.addPage([595, 842]); // A4
    let y = 780;

    const title = isJapanese ? pageContent.title : `Chapter ${index + 1}`;
    page.drawText(title, { x: 60, y, size: 18, font, color: rgb(0.06, 0.12, 0.23) });
    y -= 40;

    for (const line of pageContent.lines) {
      const text = isJapanese ? line : `Sample line ${index + 1} - ${line.length} chars`;
      page.drawText(text, { x: 60, y, size: 11, font, color: rgb(0.12, 0.16, 0.22) });
      y -= 22;
    }

    // ページ番号の抽出が確認できるようフッターを入れる
    page.drawText(`- ${index + 1} -`, { x: 290, y: 40, size: 10, font });
  });

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, await pdfDoc.save());

  console.log(`テストPDFを生成しました: ${outputPath}`);
  console.log(`ページ数: ${PAGES.length} / 日本語: ${isJapanese ? 'あり' : 'なし'}`);
}

main().catch((error) => {
  console.error('テストPDFの生成に失敗しました:', error);
  process.exit(1);
});
