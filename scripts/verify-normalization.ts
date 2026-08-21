/**
 * テキスト正規化の検証スクリプト
 *
 * PDFの抽出テキストには、そのままでは検索精度を落とす問題が含まれる。
 * この2点が解消できているかを、サンプル5文書すべてで確認する。
 *
 *  1. 康熙部首・CJK部首補助の混入
 *     「改定⽇」の「⽇」は U+2F47 であり通常の「日」ではない。
 *     残っていると「日」を含む語で検索してもヒットしない。
 *  2. 行折り返しによる文の分断
 *     「承認を得」「る。」のように紙面の幅で切れた文が繋がっているか。
 *
 * 実行：npm run verify:normalization
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { PDFParse } from 'pdf-parse';
import { extractTextFromPdf } from '../src/lib/pdf/extractText';

const SAMPLE_DIR = resolve(process.cwd(), 'data/sample-pdfs');

/** 通常の漢字ではない文字（康熙部首・CJK部首補助・CJK互換漢字）を数える */
function findAbnormalChars(text: string): Map<string, number> {
  const found = new Map<string, number>();

  for (const char of text) {
    const code = char.codePointAt(0);
    if (code === undefined) continue;

    const isRadicalSupplement = code >= 0x2e80 && code <= 0x2eff;
    const isKangxiRadical = code >= 0x2f00 && code <= 0x2fdf;
    const isCjkCompatibility = code >= 0xf900 && code <= 0xfaff;

    if (isRadicalSupplement || isKangxiRadical || isCjkCompatibility) {
      found.set(char, (found.get(char) ?? 0) + 1);
    }
  }

  return found;
}

/** 文の途中で切れたまま残っている箇所を探す（日本語の行末が句点等で終わっていない行） */
function findBrokenSentences(text: string): string[] {
  const broken: string[] = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length - 1; i += 1) {
    const line = lines[i];
    const next = lines[i + 1];

    // 見出し・箇条書きは句点で終わらなくてよいので除外する
    const isHeading = /^(\d+[.．)]|第[０-９0-9一二三四五六七八九十]+[章条節]|[・•▪-])/.test(line);
    if (isHeading) continue;

    // 文書タイトル（1行目）と、その次に来る発行情報は独立した行であり分断ではない
    if (i === 0) continue;

    // 「株式会社テックブリッジ/改定日: …/管轄: 人事部」のようなメタ情報行も分断ではない
    if (line.includes('/') || next.includes('/')) continue;

    // 表組みの行（項目がスペースで並ぶ）も分断ではない
    if (line.split(' ').length >= 3) continue;

    // 日本語で終わり、次の行も日本語で始まり、句読点で区切られていない＝分断の疑い
    const looksBroken =
      /[ぁ-んァ-ヶ一-龯]$/.test(line) &&
      /^[ぁ-んァ-ヶ一-龯]/.test(next) &&
      !/[。、！？]$/.test(line);

    if (looksBroken) {
      broken.push(`${line.slice(-15)} ┃ ${next.slice(0, 15)}`);
    }
  }

  return broken;
}

async function main() {
  if (!existsSync(SAMPLE_DIR)) {
    console.error(`サンプルPDFのディレクトリがありません: ${SAMPLE_DIR}`);
    process.exit(1);
  }

  const files = readdirSync(SAMPLE_DIR)
    .filter((name) => extname(name).toLowerCase() === '.pdf')
    .map((name) => join(SAMPLE_DIR, name))
    .sort();

  if (files.length === 0) {
    console.error('サンプルPDFが見つかりません。');
    process.exit(1);
  }

  let abnormalTotal = 0;
  let brokenTotal = 0;

  for (const file of files) {
    const data = readFileSync(file);

    // 正規化前の状態を比較用に取得する
    const parser = new PDFParse({ data });
    const rawResult = await parser.getText();
    await parser.destroy();
    const rawText = rawResult.pages.map((page) => page.text).join('\n');

    // 正規化後
    const document = await extractTextFromPdf(data);

    const rawAbnormal = findAbnormalChars(rawText);
    const normalizedAbnormal = findAbnormalChars(document.fullText);
    const broken = findBrokenSentences(document.fullText);

    const rawAbnormalCount = Array.from(rawAbnormal.values()).reduce((a, b) => a + b, 0);
    const normalizedAbnormalCount = Array.from(normalizedAbnormal.values()).reduce(
      (a, b) => a + b,
      0
    );

    abnormalTotal += normalizedAbnormalCount;
    brokenTotal += broken.length;

    console.log('');
    console.log(`■ ${file.split(/[\\/]/).pop()}`);
    console.log(
      `  異体字   : 正規化前 ${rawAbnormalCount}文字（${rawAbnormal.size}種）→ 正規化後 ${normalizedAbnormalCount}文字`
    );

    if (normalizedAbnormalCount > 0) {
      for (const [char, count] of Array.from(normalizedAbnormal.entries())) {
        const code = char.codePointAt(0)?.toString(16).toUpperCase();
        console.log(`    残存: "${char}" U+${code} x${count} … 補正表への追加が必要`);
      }
    }

    console.log(`  文の分断 : ${broken.length}件`);
    for (const item of broken.slice(0, 3)) {
      console.log(`    ${item}`);
    }

    // 行の長さの分布（折り返し判定の閾値を確認するため）
    const lineLengths = document.pages
      .flatMap((page) => page.text.split('\n'))
      .map((line) => line.length);
    console.log(
      `  行長     : 最大${Math.max(...lineLengths)} / 平均${Math.round(
        lineLengths.reduce((a, b) => a + b, 0) / lineLengths.length
      )}`
    );
  }

  console.log('');
  console.log('='.repeat(70));
  console.log('検証結果');
  console.log(`  異体字の残存 : ${abnormalTotal}文字 ${abnormalTotal === 0 ? '(OK)' : '(NG)'}`);
  console.log(`  文の分断     : ${brokenTotal}件 ${brokenTotal === 0 ? '(OK)' : '(要確認)'}`);

  if (abnormalTotal > 0) {
    console.log('');
    console.log('異体字が残っています。extractText.ts の RADICAL_SUPPLEMENT_MAP へ追加してください。');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
