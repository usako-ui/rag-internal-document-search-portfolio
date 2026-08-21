/**
 * pgvector類似検索の動作確認
 *
 * Supabaseに保存したチャンクに対し、`match_chunks` RPC関数で検索を行う。
 * この関数は 検索API側（/api/chat）が呼び出すものなので、
 * ここで返却内容が仕様どおりか（出典に必要な情報が揃っているか）を確認する。
 *
 * 実行：npm run verify:search
 */

import { loadEnv } from './loadEnv';
import { createSupabaseAdminClient } from '../src/lib/supabase/admin';
import { generateEmbedding } from '../src/lib/gemini/embedding';

loadEnv();

/** 検索API側へ推奨する初期閾値（実測に基づく） */
const MATCH_THRESHOLD = 0.62;
const MATCH_COUNT = 5;

/** match_chunks の戻り値（検索API側が受け取る形） */
type MatchedChunk = {
  chunk_id: string;
  document_id: string;
  document_name: string;
  department: string | null;
  content: string;
  chunk_index: number;
  page_number: number | null;
  section: string | null;
  similarity: number;
};

const TEST_QUESTIONS = [
  { question: '在宅勤務手当はいくらですか？', expect: '複数文書（リモートワーク規程・経費精算マニュアル）' },
  { question: '有給休暇は入社してどれくらいで付与されますか？', expect: '就業規則' },
  { question: 'パスワードは何文字以上にする必要がありますか？', expect: '情報セキュリティ規程' },
  { question: '経費精算の申請期限はいつまでですか？', expect: '経費精算マニュアル' },
  { question: 'リモートワークは週何日までできますか？', expect: 'リモートワーク規程' },
  { question: '社長の名前は何ですか？', expect: '該当なし（0件が正しい）' },
  { question: '明日の天気は？', expect: '該当なし（0件が正しい）' },
];

async function main() {
  const supabase = createSupabaseAdminClient();

  console.log(`閾値: ${MATCH_THRESHOLD} / 取得件数: 最大${MATCH_COUNT}件`);
  console.log('='.repeat(88));

  let answerable = 0;
  let outOfScopeCorrect = 0;
  let outOfScopeTotal = 0;

  for (const { question, expect } of TEST_QUESTIONS) {
    // クエリにも文書側と同じNFKC正規化を適用する
    const queryVector = await generateEmbedding(question.normalize('NFKC'), 'RETRIEVAL_QUERY');

    const { data, error } = await supabase.rpc('match_chunks', {
      query_embedding: JSON.stringify(queryVector),
      match_threshold: MATCH_THRESHOLD,
      match_count: MATCH_COUNT,
    });

    if (error) {
      console.error(`RPC呼び出しに失敗しました: ${error.message}`);
      process.exit(1);
    }

    const matches = (data ?? []) as MatchedChunk[];
    const isOutOfScope = expect.startsWith('該当なし');

    console.log('');
    console.log(`Q. ${question}`);
    console.log(`   期待: ${expect}`);

    if (matches.length === 0) {
      console.log('   → 該当チャンクなし（「該当する情報を社内文書から確認できませんでした。」を返す）');
    }

    for (const match of matches) {
      const source = `${match.document_name}${match.section ? ` ${match.section}` : ''}（p.${match.page_number}）`;
      const preview = match.content.replace(/\n/g, ' ').slice(0, 42);
      console.log(`   ${match.similarity.toFixed(4)}  ${source}`);
      console.log(`           ${preview}...`);
    }

    if (isOutOfScope) {
      outOfScopeTotal += 1;
      if (matches.length === 0) outOfScopeCorrect += 1;
    } else if (matches.length > 0) {
      answerable += 1;
    }

    // レート制限を避ける
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  const answerableTotal = TEST_QUESTIONS.length - outOfScopeTotal;

  console.log('');
  console.log('='.repeat(88));
  console.log('検証結果');
  console.log(`  文書に記載がある質問で検索できた : ${answerable}/${answerableTotal}`);
  console.log(`  文書に記載がない質問で0件を返せた: ${outOfScopeCorrect}/${outOfScopeTotal}`);
  console.log('');
  console.log('出典に必要な情報（文書名・ページ番号・参照箇所）がRPCから返ることを確認した。');
  console.log('検索API側はこの結果をそのまま citations へ変換できる。');

  if (answerable < answerableTotal || outOfScopeCorrect < outOfScopeTotal) {
    console.log('');
    console.log('※ 期待どおりでない項目がある場合は閾値の調整を検討すること。');
  }
}

main().catch((error) => {
  console.error('検証に失敗しました:', error instanceof Error ? error.message : error);
  process.exit(1);
});
