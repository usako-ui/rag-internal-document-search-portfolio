/**
 * サンプルPDFをSupabaseへ取り込む
 *
 * PDF → テキスト抽出 → チャンキング → Embedding生成 → Supabase保存
 *
 * 実行：
 *   npm run ingest                      … data/sample-pdfs/ 配下をすべて取り込む
 *   npm run ingest -- path/to/file.pdf  … 個別のPDFを取り込む
 *
 * 同じ文書名が既に登録されている場合は置き換える（再インデックス）。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { loadEnv } from './loadEnv';
import { ingestPdf } from '../src/lib/ingest/ingestDocument';
import { PdfProcessingError } from '../src/lib/pdf/errors';
import { EmbeddingError } from '../src/lib/gemini/embedding';

loadEnv();

const SAMPLE_DIR = resolve(process.cwd(), 'data/sample-pdfs');

function listPdfFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];

  return readdirSync(directory)
    .filter((name) => extname(name).toLowerCase() === '.pdf')
    .map((name) => join(directory, name))
    .sort();
}

function resolveTargets(): string[] {
  const argPath = process.argv[2];

  if (argPath) {
    const target = resolve(process.cwd(), argPath);
    if (!existsSync(target)) {
      throw new Error(`指定されたパスが見つかりません: ${target}`);
    }
    return statSync(target).isDirectory() ? listPdfFiles(target) : [target];
  }

  return listPdfFiles(SAMPLE_DIR);
}

async function main() {
  const targets = resolveTargets();

  if (targets.length === 0) {
    console.error('取り込み対象のPDFが見つかりません。');
    console.error(`data/sample-pdfs/ にPDFを配置してください（${SAMPLE_DIR}）。`);
    process.exit(1);
  }

  console.log(`取り込み対象: ${targets.length}件`);
  console.log('');

  let successCount = 0;

  for (const filePath of targets) {
    const fileName = basename(filePath);
    process.stdout.write(`  ${fileName} ... `);

    try {
      const result = await ingestPdf({
        fileName,
        data: readFileSync(filePath),
      });

      console.log(
        `OK（${result.replaced ? '更新' : '新規'}）\n` +
          `      文書名: ${result.name}\n` +
          `      管轄  : ${result.department ?? '（未設定）'}\n` +
          `      ${result.pageCount}ページ / ${result.chunkCount}チャンク`
      );
      successCount += 1;
    } catch (error) {
      // 想定内のエラーは利用者向けメッセージを表示する（F-07）
      if (error instanceof PdfProcessingError || error instanceof EmbeddingError) {
        console.log('失敗');
        console.error(`      ${error.userMessage}`);
      } else {
        console.log('失敗');
        console.error('      想定外のエラー:', error);
      }
    }
  }

  console.log('');
  console.log(`完了: ${successCount}/${targets.length} 件を取り込みました`);

  if (successCount < targets.length) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('取り込みに失敗しました:', error instanceof Error ? error.message : error);
  process.exit(1);
});
