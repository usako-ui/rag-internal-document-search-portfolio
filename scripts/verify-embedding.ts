/**
 * Embedding生成と検索品質の確認（TA-04）
 *
 * サンプル5文書を実際にチャンク化してEmbeddingを生成し、
 * 質問に対して意味的に正しいチャンクが上位に来るかを確認する。
 *
 * DBへ保存する前にここで品質を確かめておくことで、
 * 「保存したが検索できない」という手戻りを防ぐ。
 *
 * 実行：npm run verify:embedding
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { loadEnv } from './loadEnv';
import { extractTextFromPdf } from '../src/lib/pdf/extractText';
import { chunkDocument, type TextChunk } from '../src/lib/pdf/chunkText';
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  generateEmbedding,
  generateEmbeddings,
} from '../src/lib/gemini/embedding';

loadEnv();

const SAMPLE_DIR = resolve(process.cwd(), 'data/sample-pdfs');

/** 確認用の質問。case3-test-questions.csv の想定に近いものを選んでいる */
const TEST_QUERIES = [
  { question: '在宅勤務手当はいくらですか？', expect: 'リモートワーク規程 / 経費精算マニュアル' },
  { question: '有給休暇は入社してどれくらいで付与されますか？', expect: '就業規則' },
  { question: 'パスワードは何文字以上にする必要がありますか？', expect: '情報セキュリティ規程' },
  { question: '経費精算の申請期限はいつまでですか？', expect: '経費精算マニュアル' },
  { question: '新しいツールのアカウントはどこに申請しますか？', expect: '社内ITツール申請ガイド' },
  { question: '社長の名前は何ですか？', expect: '（文書に記載なし・低スコアが正しい）' },
];

/** チャンクとその出典情報 */
type IndexedChunk = TextChunk & { documentName: string };

/** コサイン類似度（両ベクトルが正規化済みなら内積と一致する） */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
  }
  return dot;
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

  // 1. 全文書をチャンク化する
  const chunks: IndexedChunk[] = [];

  for (const file of files) {
    const document = await extractTextFromPdf(readFileSync(file));
    const documentName = basename(file, '.pdf');

    for (const chunk of chunkDocument(document)) {
      chunks.push({ ...chunk, documentName });
    }
  }

  console.log(`モデル      : ${EMBEDDING_MODEL}`);
  console.log(`次元数      : ${EMBEDDING_DIMENSIONS}`);
  console.log(`対象文書    : ${files.length}件`);
  console.log(`チャンク総数: ${chunks.length}件`);
  console.log('');

  // 2. チャンクのEmbeddingを生成する（文書側は RETRIEVAL_DOCUMENT）
  console.log('チャンクのEmbeddingを生成しています...');
  const startedAt = Date.now();
  const chunkVectors = await generateEmbeddings(
    chunks.map((chunk) => chunk.content),
    'RETRIEVAL_DOCUMENT'
  );
  console.log(`完了（${((Date.now() - startedAt) / 1000).toFixed(1)}秒）`);

  // 次元数とベクトルの長さを検証する
  const dimensionsOk = chunkVectors.every((vector) => vector.length === EMBEDDING_DIMENSIONS);
  const normalizedOk = chunkVectors.every((vector) => {
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    return Math.abs(norm - 1) < 0.01;
  });

  console.log(`  次元数が${EMBEDDING_DIMENSIONS}で揃っている: ${dimensionsOk ? 'OK' : 'NG'}`);
  console.log(`  L2正規化されている              : ${normalizedOk ? 'OK' : 'NG'}`);
  console.log('');
  console.log('='.repeat(78));

  // 3. 質問ごとに類似チャンクを検索する（クエリ側は RETRIEVAL_QUERY）
  for (const { question, expect } of TEST_QUERIES) {
    // クエリにも文書側と同じNFKC正規化を適用する（Q-18）
    const queryVector = await generateEmbedding(question.normalize('NFKC'), 'RETRIEVAL_QUERY');

    const ranked = chunks
      .map((chunk, index) => ({ chunk, score: cosineSimilarity(queryVector, chunkVectors[index]) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    console.log('');
    console.log(`Q. ${question}`);
    console.log(`   期待する出典: ${expect}`);

    for (const { chunk, score } of ranked) {
      const preview = chunk.content.replace(/\n/g, ' ').slice(0, 46);
      console.log(
        `   ${score.toFixed(4)}  ${chunk.documentName} p.${chunk.pageNumber} | ${preview}...`
      );
    }
  }

  console.log('');
  console.log('='.repeat(78));
  console.log('補足: スコアはコサイン類似度（1に近いほど類似）。');
  console.log('      文書に記載のない質問で最高スコアが低くなることが、');
  console.log('      ハルシネーション抑制の閾値（Q-02・初期値0.7）を決める根拠になる。');

  if (!dimensionsOk || !normalizedOk) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('検証に失敗しました:', error instanceof Error ? error.message : error);
  process.exit(1);
});
