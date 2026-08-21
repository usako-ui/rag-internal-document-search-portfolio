/**
 * PDFテキスト抽出・チャンキングの動作確認スクリプト
 *
 * 実行：
 *   npm run extract                      … data/sample-pdfs/ 配下のPDFをすべて処理
 *   npm run extract -- path/to/file.pdf  … 個別のPDFを処理
 *
 * このスクリプトは取り込み結果を目視確認するためのもので、DBへの保存は行わない
 * （保存はで実装する）。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { extractTextFromPdf } from '../src/lib/pdf/extractText';
import { DEFAULT_CHUNK_OPTIONS, chunkDocument } from '../src/lib/pdf/chunkText';
import { PdfProcessingError } from '../src/lib/pdf/errors';

/** 実サンプルPDFの配置先 */
const SAMPLE_DIR = resolve(process.cwd(), 'data/sample-pdfs');
/** 動作確認用のテストPDF（scripts/generate-test-pdf.mjs で生成） */
const TEST_DIR = resolve(process.cwd(), 'data/test');

/** 処理対象のPDFファイル一覧を決める */
function resolveTargets(): string[] {
  const argPath = process.argv[2];

  if (argPath) {
    const target = resolve(process.cwd(), argPath);
    if (!existsSync(target)) {
      throw new Error(`指定されたパスが見つかりません: ${target}`);
    }
    return statSync(target).isDirectory() ? listPdfFiles(target) : [target];
  }

  // 実サンプルPDFがあればそちらを優先し、なければテストPDFで動作確認する
  if (existsSync(SAMPLE_DIR) && listPdfFiles(SAMPLE_DIR).length > 0) {
    return listPdfFiles(SAMPLE_DIR);
  }

  console.warn('data/sample-pdfs/ にPDFがないため、テストPDFで動作確認します。');
  return listPdfFiles(TEST_DIR);
}

function listPdfFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];

  return readdirSync(directory)
    .filter((name) => extname(name).toLowerCase() === '.pdf')
    .map((name) => join(directory, name))
    .sort();
}

async function processPdf(filePath: string): Promise<void> {
  console.log('');
  console.log('='.repeat(70));
  console.log(`ファイル: ${filePath}`);

  const data = readFileSync(filePath);
  console.log(`サイズ  : ${(data.byteLength / 1024).toFixed(1)} KB`);

  const document = await extractTextFromPdf(data);
  console.log(`ページ数: ${document.pageCount}（テキストあり: ${document.pages.length}）`);
  console.log(`総文字数: ${document.fullText.length}`);

  const chunks = chunkDocument(document);
  console.log(
    `チャンク: ${chunks.length}件（目標${DEFAULT_CHUNK_OPTIONS.targetTokens}トークン / ` +
      `オーバーラップ${DEFAULT_CHUNK_OPTIONS.overlapTokens}トークン）`
  );

  if (chunks.length > 0) {
    const tokens = chunks.map((chunk) => chunk.estimatedTokens);
    const average = Math.round(tokens.reduce((sum, value) => sum + value, 0) / tokens.length);
    console.log(
      `トークン: 平均${average} / 最小${Math.min(...tokens)} / 最大${Math.max(...tokens)}（概算）`
    );
  }

  console.log('-'.repeat(70));
  for (const chunk of chunks.slice(0, 5)) {
    const preview = chunk.content.replace(/\n/g, ' ').slice(0, 80);
    console.log(
      `  [${String(chunk.chunkIndex).padStart(3, '0')}] p.${chunk.pageNumber} ` +
        `${chunk.estimatedTokens}tok ${chunk.charCount}字 | ${preview}${chunk.content.length > 80 ? '...' : ''}`
    );
  }
  if (chunks.length > 5) {
    console.log(`  ... 他 ${chunks.length - 5} 件`);
  }
}

async function main() {
  const targets = resolveTargets();

  if (targets.length === 0) {
    console.error('処理対象のPDFが見つかりません。');
    console.error('サンプルPDFを data/sample-pdfs/ に配置するか、');
    console.error('node scripts/generate-test-pdf.mjs でテストPDFを生成してください。');
    process.exit(1);
  }

  console.log(`対象: ${targets.length}件のPDF`);

  let successCount = 0;
  for (const filePath of targets) {
    try {
      await processPdf(filePath);
      successCount += 1;
    } catch (error) {
      // 想定内のエラーは利用者向けメッセージを出す（F-07：原因が分かる表示）
      if (error instanceof PdfProcessingError) {
        console.error(`\n  取り込み失敗: ${filePath}`);
        console.error(`  ${error.userMessage}`);
      } else {
        console.error(`\n  想定外のエラー: ${filePath}`);
        console.error(error);
      }
    }
  }

  console.log('');
  console.log('='.repeat(70));
  console.log(`完了: ${successCount}/${targets.length} 件のPDFを処理しました`);

  if (successCount < targets.length) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
