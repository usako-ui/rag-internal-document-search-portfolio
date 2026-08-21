/**
 * チャンクサイズの調整（確定作業）
 *
 * 複数のチャンクサイズで実際に検索を行い、正解文書が上位に来る割合を比較する。
 * requirements.md セクション4-1は「300〜500トークン」を目安としているが、
 * 同項に「最適値は精度検証結果をもとに調整する」とあるため、実データで確かめる。
 *
 * 実行：npm run tune:chunking
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { loadEnv } from './loadEnv';
import { extractTextFromPdf, type ExtractedDocument } from '../src/lib/pdf/extractText';
import { chunkDocument, type ChunkOptions } from '../src/lib/pdf/chunkText';
import { generateEmbedding, generateEmbeddings } from '../src/lib/gemini/embedding';

loadEnv();

const SAMPLE_DIR = resolve(process.cwd(), 'data/sample-pdfs');

/** 比較するチャンク設定 */
const CANDIDATES: Array<{ label: string; options: ChunkOptions }> = [
  { label: '400/500/80（現行）', options: { targetTokens: 400, maxTokens: 500, overlapTokens: 80 } },
  { label: '300/400/60', options: { targetTokens: 300, maxTokens: 400, overlapTokens: 60 } },
  { label: '200/300/50', options: { targetTokens: 200, maxTokens: 300, overlapTokens: 50 } },
  { label: '150/250/50', options: { targetTokens: 150, maxTokens: 250, overlapTokens: 50 } },
  { label: '100/200/40', options: { targetTokens: 100, maxTokens: 200, overlapTokens: 40 } },
];

/**
 * 評価用の質問と、根拠が載っている文書。
 * 「社長の名前」は文書に存在しないため、スコアが低く出ることが正しい。
 */
const EVALUATION_SET = [
  { question: '在宅勤務手当はいくらですか？', expectedDocs: ['doc2', 'doc4'], keyword: '3,000' },
  { question: '有給休暇は入社してどれくらいで付与されますか？', expectedDocs: ['doc1'], keyword: '6ヶ月' },
  { question: 'パスワードは何文字以上にする必要がありますか？', expectedDocs: ['doc3'], keyword: '12文字' },
  { question: '経費精算の申請期限はいつまでですか？', expectedDocs: ['doc2'], keyword: '10日' },
  { question: '新しいツールのアカウントはどこに申請しますか？', expectedDocs: ['doc5'], keyword: 'helpdesk' },
  { question: 'リモートワークは週何日までできますか？', expectedDocs: ['doc4'], keyword: '週3日' },
  { question: '時間外労働の上限は月何時間ですか？', expectedDocs: ['doc1'], keyword: '45時間' },
  { question: '接待交際費の上限はいくらですか？', expectedDocs: ['doc2'], keyword: '5,000円' },
];

/** 文書に記載がない質問（ハルシネーション確認用） */
const OUT_OF_SCOPE_QUESTIONS = ['社長の名前は何ですか？', '来期の売上目標はいくらですか？'];

type IndexedChunk = { content: string; documentName: string; pageNumber: number };

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
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

  // PDFの抽出は設定によらず同じなので、最初に1度だけ行う
  const documents: Array<{ name: string; document: ExtractedDocument }> = [];
  for (const file of files) {
    documents.push({
      name: basename(file, '.pdf'),
      document: await extractTextFromPdf(readFileSync(file)),
    });
  }

  // 質問のEmbeddingも設定によらず同じなので先に作る
  console.log('質問のEmbeddingを生成しています...');
  const allQuestions = [...EVALUATION_SET.map((item) => item.question), ...OUT_OF_SCOPE_QUESTIONS];
  const questionVectors = new Map<string, number[]>();

  for (const question of allQuestions) {
    questionVectors.set(question, await generateEmbedding(question.normalize('NFKC'), 'RETRIEVAL_QUERY'));
    // レート制限を避けるため間隔を空ける
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  console.log('');
  console.log(
    '設定'.padEnd(20) +
      'チャンク数  正解1位  正解3位内  該当文の取得  平均スコア  文書外の最高'
  );
  console.log('-'.repeat(88));

  for (const { label, options } of CANDIDATES) {
    // 1. その設定でチャンク化する
    const chunks: IndexedChunk[] = [];
    for (const { name, document } of documents) {
      for (const chunk of chunkDocument(document, options)) {
        chunks.push({ content: chunk.content, documentName: name, pageNumber: chunk.pageNumber });
      }
    }

    // 2. Embeddingを生成する（設定を切り替える前に間隔を空ける）
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const vectors = await generateEmbeddings(
      chunks.map((chunk) => chunk.content),
      'RETRIEVAL_DOCUMENT'
    );

    // 3. 各質問で検索して評価する
    let top1Correct = 0;
    let top3Correct = 0;
    let keywordFound = 0;
    let scoreSum = 0;

    for (const { question, expectedDocs, keyword } of EVALUATION_SET) {
      const queryVector = questionVectors.get(question);
      if (!queryVector) continue;

      const ranked = chunks
        .map((chunk, index) => ({ chunk, score: cosineSimilarity(queryVector, vectors[index]) }))
        .sort((a, b) => b.score - a.score);

      const top3 = ranked.slice(0, 3);
      const matchesExpected = (name: string) => expectedDocs.some((doc) => name.includes(doc));

      if (matchesExpected(top3[0].chunk.documentName)) top1Correct += 1;
      if (top3.some((item) => matchesExpected(item.chunk.documentName))) top3Correct += 1;

      // 答えそのもの（金額・日数など）が上位3件に含まれているか。
      // 文書が合っていても該当箇所が取れていなければ正しく回答できない
      if (top3.some((item) => item.chunk.content.includes(keyword))) keywordFound += 1;

      scoreSum += top3[0].score;
    }

    // 4. 文書に記載がない質問での最高スコア（閾値を決める根拠）
    let outOfScopeMax = 0;
    for (const question of OUT_OF_SCOPE_QUESTIONS) {
      const queryVector = questionVectors.get(question);
      if (!queryVector) continue;

      const best = Math.max(...vectors.map((vector) => cosineSimilarity(queryVector, vector)));
      outOfScopeMax = Math.max(outOfScopeMax, best);
    }

    const total = EVALUATION_SET.length;
    console.log(
      label.padEnd(20) +
        String(chunks.length).padStart(6) +
        `      ${top1Correct}/${total}`.padEnd(9) +
        `  ${top3Correct}/${total}`.padEnd(11) +
        `  ${keywordFound}/${total}`.padEnd(14) +
        `  ${(scoreSum / total).toFixed(4)}`.padEnd(12) +
        `  ${outOfScopeMax.toFixed(4)}`
    );
  }

  console.log('');
  console.log('凡例:');
  console.log('  正解1位     … 根拠文書のチャンクが1位に来た質問数');
  console.log('  正解3位内   … 根拠文書のチャンクが上位3件に入った質問数');
  console.log('  該当文の取得… 答えそのもの（金額・日数など）を含むチャンクが上位3件に入った質問数');
  console.log('  文書外の最高… 記載のない質問での最高スコア。この値より高い閾値にすれば誤回答を防げる');
}

main().catch((error) => {
  console.error('検証に失敗しました:', error instanceof Error ? error.message : error);
  process.exit(1);
});
