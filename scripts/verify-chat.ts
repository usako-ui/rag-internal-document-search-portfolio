/**
 * 回答生成・出典組み立ての動作確認（TB-05〜TB-08・TB-10）
 *
 * `/api/chat` と同じ処理（検索 → 回答生成 → 出典組み立て）をHTTPを介さずに実行し、
 * 以下を確認する。
 *  - 文書に記載がある質問へ、文書を根拠に日本語で回答できること（F-03）
 *  - 出典（文書名・ページ・参照箇所）が返ること（F-04）
 *  - 文書に記載がない質問で「該当する情報を社内文書から確認できませんでした。」
 *    ＋ citations:[] ＋ has_answer:false になること（F-03 AC・TB-10）
 *
 * 実行：npm run verify:chat
 */

import { loadEnv } from './loadEnv';
import { createSupabaseAdminClient } from '../src/lib/supabase/admin';
import { generateQueryEmbedding, validateQuestion } from '../src/lib/search/queryEmbedding';
import { searchChunks } from '../src/lib/search/searchChunks';
import { NO_ANSWER_MESSAGE, generateAnswer } from '../src/lib/gemini/answer';
import { buildCitations } from '../src/lib/chat/citations';

loadEnv();

/** 検証用の質問。outOfScope は「該当なし」が正解の質問 */
const TEST_QUESTIONS: { question: string; expect: string; outOfScope?: boolean }[] = [
  { question: '在宅勤務手当はいくらですか？', expect: '複数文書を根拠に金額を回答' },
  { question: '有給休暇は入社してどれくらいで付与されますか？', expect: '就業規則を根拠に回答' },
  { question: 'パスワードは何文字以上にする必要がありますか？', expect: '情報セキュリティ規程を根拠に回答' },
  { question: '社長の名前は何ですか？', expect: '該当なし', outOfScope: true },
  { question: '明日の天気は？', expect: '該当なし', outOfScope: true },
  { question: '当社の2026年の売上目標はいくらですか？', expect: '該当なし', outOfScope: true },
];

async function main() {
  const supabase = createSupabaseAdminClient();

  console.log('【TB-05〜TB-08・TB-10】回答生成・出典・ハルシネーション抑制');
  console.log('='.repeat(88));

  let answeredOk = 0;
  let answeredTotal = 0;
  let citationOk = 0;
  let hallucinationOk = 0;
  let hallucinationTotal = 0;

  for (const { question, expect, outOfScope } of TEST_QUESTIONS) {
    const startedAt = Date.now();

    const normalized = validateQuestion(question);
    const queryEmbedding = await generateQueryEmbedding(normalized);
    const chunks = await searchChunks(supabase, queryEmbedding);
    const { answer, hasAnswer, usedChunks } = await generateAnswer(normalized, chunks);
    const citations = hasAnswer ? buildCitations(usedChunks) : [];

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

    console.log('');
    console.log(`Q. ${question}`);
    console.log(`   期待: ${expect}`);
    console.log(`   A. ${answer}`);
    console.log(`   has_answer: ${hasAnswer} / citations: ${citations.length}件 / ${elapsed}秒`);

    for (const citation of citations) {
      const page = citation.page ?? 'ページ不明';
      const section = citation.section ?? '見出しなし';
      console.log(`     - ${citation.document_name}（${page} / ${section}）`);
    }

    if (outOfScope) {
      hallucinationTotal += 1;
      // 該当なしの正解条件：定型文・出典0件・has_answer:false の3点がすべて揃うこと
      const correct = !hasAnswer && citations.length === 0 && answer === NO_ANSWER_MESSAGE;
      if (correct) hallucinationOk += 1;
      else console.log('     → NG: 文書外の質問に回答している可能性がある');
    } else {
      answeredTotal += 1;
      if (hasAnswer && answer !== NO_ANSWER_MESSAGE) answeredOk += 1;
      if (citations.length > 0) citationOk += 1;
      else console.log('     → NG: 出典が表示されない');
    }

    // レート制限を避ける
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log('');
  console.log('='.repeat(88));
  console.log('検証結果');
  console.log(`  文書を根拠に回答できた       : ${answeredOk}/${answeredTotal}`);
  console.log(`  出典を表示できた             : ${citationOk}/${answeredTotal}`);
  console.log(`  文書外で該当なしを返せた     : ${hallucinationOk}/${hallucinationTotal}`);

  if (answeredOk < answeredTotal || citationOk < answeredTotal || hallucinationOk < hallucinationTotal) {
    console.log('');
    console.log('※ 期待どおりでない項目がある。プロンプト（TB-06）または閾値（Q-02）を見直すこと。');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('検証に失敗しました:', error instanceof Error ? error.message : error);
  process.exit(1);
});
