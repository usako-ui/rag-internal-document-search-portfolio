/**
 * Gemini APIの疎通確認（T-00-03・TA-04の前提確認）
 *
 * 確認する内容：
 *  1. APIキーが有効か
 *  2. 利用可能なEmbeddingモデル
 *  3. output_dimensionality: 768 の指定が効いているか（DBスキーマ vector(768) と一致するか）
 *
 * 実行：npm run check:gemini
 */

import { GoogleGenAI } from '@google/genai';
import { loadEnv, requireEnv } from './loadEnv';

loadEnv();

/** DBスキーマ（document_chunks.embedding）に合わせた次元数 */
const OUTPUT_DIMENSIONALITY = 768;

async function main() {
  const ai = new GoogleGenAI({ apiKey: requireEnv('GEMINI_API_KEY') });

  console.log('--- 利用可能なEmbeddingモデル ---');
  const embeddingModels: string[] = [];

  for await (const model of await ai.models.list()) {
    const actions = model.supportedActions ?? [];
    if (actions.includes('embedContent')) {
      embeddingModels.push(model.name ?? '');
      console.log(`  ${model.name}（${model.displayName ?? ''}）`);
    }
  }

  if (embeddingModels.length === 0) {
    console.log('  （embedContent対応モデルが見つかりませんでした）');
  }

  console.log('');
  console.log('--- Embedding生成テスト（768次元・正規化の有無を比較）---');

  // 768次元へ切り詰めたとき、モデルが自動で正規化してくれるかを確認する。
  // L2ノルムが1でない場合はこちらで正規化する必要がある。
  const candidates = ['gemini-embedding-001', 'gemini-embedding-2'];

  for (const model of candidates) {
    try {
      const response = await ai.models.embedContent({
        model,
        contents: '在宅勤務手当はいくらですか？',
        config: {
          taskType: 'RETRIEVAL_QUERY',
          outputDimensionality: OUTPUT_DIMENSIONALITY,
        },
      });

      const values = response.embeddings?.[0]?.values;
      if (!values) {
        console.log(`  ${model}: Embeddingを取得できませんでした`);
        continue;
      }

      const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
      const isNormalized = Math.abs(norm - 1) < 0.01;

      console.log(
        `  ${model.padEnd(22)} 次元:${values.length} / L2ノルム:${norm.toFixed(4)} ` +
          `${isNormalized ? '→ 自動正規化あり' : '→ 手動正規化が必要'}`
      );
    } catch (error) {
      console.log(
        `  ${model.padEnd(22)} 利用不可: ${error instanceof Error ? error.message.slice(0, 80) : error}`
      );
    }
  }
}

main().catch((error) => {
  console.error('Gemini APIの確認に失敗しました:', error instanceof Error ? error.message : error);
  process.exit(1);
});
