/**
 * 複数文書にまたがる質問の出典確認（要件F-04 AC）
 *
 * 「在宅勤務手当はいくら？」は、金額が経費精算マニュアル、支給条件・申請方法が
 * リモートワーク規程に分かれて記載されている。F-04の受け入れ条件は
 * 「複数文書（経費精算マニュアル・リモートワーク規程）が表示されること」であるため、
 * 出典が安定して複数文書になるかを繰り返し確認する。
 *
 * 実行：npm run verify:multi-doc
 */

import { loadEnv } from './loadEnv';
import { createSupabaseAdminClient } from '../src/lib/supabase/admin';
import { generateQueryEmbedding, validateQuestion } from '../src/lib/search/queryEmbedding';
import { searchChunks } from '../src/lib/search/searchChunks';
import { generateAnswer } from '../src/lib/gemini/answer';
import { buildCitations } from '../src/lib/chat/citations';

loadEnv();

const QUESTION = '在宅勤務手当はいくらですか？';
/** 回答生成にはゆらぎがあるため、複数回試して安定性を確認する */
const TRIALS = 3;

async function main() {
  const supabase = createSupabaseAdminClient();

  console.log(`Q. ${QUESTION}（${TRIALS}回試行）`);
  console.log('='.repeat(88));

  let multiDocumentCount = 0;

  for (let trial = 1; trial <= TRIALS; trial += 1) {
    const normalized = validateQuestion(QUESTION);
    const queryEmbedding = await generateQueryEmbedding(normalized);
    const chunks = await searchChunks(supabase, queryEmbedding);
    const { answer, hasAnswer, usedChunks } = await generateAnswer(normalized, chunks);
    const citations = hasAnswer ? buildCitations(usedChunks) : [];

    const documentNames = Array.from(new Set(citations.map((citation) => citation.document_name)));
    if (documentNames.length >= 2) multiDocumentCount += 1;

    console.log('');
    console.log(`[${trial}回目] ${answer}`);
    console.log(`         出典: ${documentNames.join(' / ') || 'なし'}（${documentNames.length}文書）`);

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log('');
  console.log('='.repeat(88));
  console.log(`複数文書の出典が表示された回数: ${multiDocumentCount}/${TRIALS}`);

  if (multiDocumentCount < TRIALS) {
    console.log('※ 出典が単一文書になる試行がある。プロンプトの見直しを検討すること。');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('検証に失敗しました:', error instanceof Error ? error.message : error);
  process.exit(1);
});
