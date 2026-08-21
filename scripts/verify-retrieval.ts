/**
 * 検索API側の検索処理の動作確認
 *
 * 確認する内容：
 *  - クエリのNFKC正規化が効いていること
 *  - `match_chunks` RPCで上位チャンクが取得できること
 *  - 閾値0.62で文書外の質問が0件になること
 *  - 「在宅勤務手当」で複数文書（リモートワーク規程・経費精算マニュアル）が取得できること
 *
 * 実行：npm run verify:retrieval
 */

import { loadEnv } from './loadEnv';
import { createSupabaseAdminClient } from '../src/lib/supabase/admin';
import {
  generateQueryEmbedding,
  normalizeQuery,
  validateQuestion,
} from '../src/lib/search/queryEmbedding';
import { MATCH_COUNT, SIMILARITY_THRESHOLD, searchChunks } from '../src/lib/search/searchChunks';

// 環境変数の読み込みはクライアント生成より前に行う（各クライアントは呼び出し時に環境変数を読む）
loadEnv();

/** 検証用の質問（文書に記載あり / 複数文書 / 記載なし） */
const TEST_QUESTIONS: { question: string; expect: string; outOfScope?: boolean }[] = [
  {
    question: '在宅勤務手当はいくらですか？',
    expect: '複数文書（リモートワーク規程・経費精算マニュアル）',
  },
  { question: '有給休暇は入社してどれくらいで付与されますか？', expect: '就業規則' },
  { question: 'パスワードは何文字以上にする必要がありますか？', expect: '情報セキュリティ規程' },
  { question: '経費精算の申請期限はいつまでですか？', expect: '経費精算マニュアル' },
  { question: '社長の名前は何ですか？', expect: '該当なし（0件が正しい）', outOfScope: true },
  { question: '明日の天気は？', expect: '該当なし（0件が正しい）', outOfScope: true },
];

/** NFKC正規化の確認用（康熙部首・CJK部首補助・全角英数を含む質問） */
const NORMALIZATION_SAMPLES = [
  '改定⽇はいつですか？', // ⽇ = U+2F47（康熙部首）
  '部⾨⻑の承認は必要ですか？', // ⻑ = U+2ED1（CJK部首補助）
  'ＰＣの持ち出しは可能ですか？', // 全角英字
];

async function main() {
  const supabase = createSupabaseAdminClient();

  console.log('クエリのNFKC正規化');
  console.log('='.repeat(88));
  for (const sample of NORMALIZATION_SAMPLES) {
    const normalized = normalizeQuery(sample);
    const changed = sample !== normalized ? '変換あり' : '変換なし';
    console.log(`  ${sample}  →  ${normalized}   [${changed}]`);
  }

  console.log('');
  console.log(`【〜】類似検索（閾値 ${SIMILARITY_THRESHOLD} / 最大${MATCH_COUNT}件）`);
  console.log('='.repeat(88));

  let answerableOk = 0;
  let answerableTotal = 0;
  let outOfScopeOk = 0;
  let outOfScopeTotal = 0;
  let multiDocumentOk = false;

  for (const { question, expect, outOfScope } of TEST_QUESTIONS) {
    const normalized = validateQuestion(question);
    const queryEmbedding = await generateQueryEmbedding(normalized);
    const matches = await searchChunks(supabase, queryEmbedding);

    console.log('');
    console.log(`Q. ${question}`);
    console.log(`   期待: ${expect}`);

    if (matches.length === 0) {
      console.log('   → 0件（has_answer: false として扱う）');
    }

    for (const match of matches) {
      const section = match.section ? ` ${match.section}` : '';
      const preview = match.content.replace(/\n/g, ' ').slice(0, 40);
      console.log(
        `   ${match.similarity.toFixed(4)}  ${match.document_name}${section}（p.${match.page_number}）`
      );
      console.log(`           ${preview}...`);
    }

    if (outOfScope) {
      outOfScopeTotal += 1;
      if (matches.length === 0) outOfScopeOk += 1;
    } else {
      answerableTotal += 1;
      if (matches.length > 0) answerableOk += 1;
    }

    // 「在宅勤務手当」は複数文書から取得できることが完了条件
    if (question.includes('在宅勤務手当')) {
      const documentNames = Array.from(new Set(matches.map((match) => match.document_name)));
      multiDocumentOk = documentNames.length >= 2;
      console.log(`   → 参照文書数: ${documentNames.length}（${documentNames.join(' / ')}）`);
    }

    // Embedding APIのレート制限を避ける
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  console.log('');
  console.log('='.repeat(88));
  console.log('検証結果');
  console.log(`  記載あり質問で検索できた   : ${answerableOk}/${answerableTotal}`);
  console.log(`  記載なし質問で0件を返せた  : ${outOfScopeOk}/${outOfScopeTotal}`);
  console.log(` 複数文書からの取得 : ${multiDocumentOk ? 'OK' : 'NG'}`);

  if (answerableOk < answerableTotal || outOfScopeOk < outOfScopeTotal || !multiDocumentOk) {
    console.log('');
    console.log('※ 期待どおりでない項目がある。閾値の再調整を検討すること。');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('検証に失敗しました:', error instanceof Error ? error.message : error);
  process.exit(1);
});
