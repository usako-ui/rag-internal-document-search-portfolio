/**
 * レート制限の動作確認
 *
 * 実行：npx tsx scripts/verify-rate-limit.ts
 */
import { checkRateLimit, resetRateLimit, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS } from '../src/lib/rateLimit';

let failed = 0;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? 'OK  ' : 'NG  '} ${label}`);
  if (!ok) failed += 1;
};

resetRateLimit();
const t0 = 1_000_000;

// 1. 上限までは通る
let allAllowed = true;
for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i += 1) {
  if (!checkRateLimit('user-a', t0 + i * 100).allowed) allAllowed = false;
}
check(`上限（${RATE_LIMIT_MAX_REQUESTS}回）までは通る`, allAllowed);

// 2. 上限を超えたら拒否され、Retry-After が返る
const over = checkRateLimit('user-a', t0 + 500);
check('上限を超えると拒否される', !over.allowed);
check('Retry-After が1秒以上', over.retryAfterSeconds >= 1);

// 3. 拒否は記録されない（連打しても待ち時間が延びない）
const over2 = checkRateLimit('user-a', t0 + 600);
check('連打しても解除時刻が後ろへずれない', over2.retryAfterSeconds <= over.retryAfterSeconds);

// 4. 他ユーザーは影響を受けない
check('別ユーザーは制限されない', checkRateLimit('user-b', t0 + 700).allowed);

// 5. 時間幅を過ぎれば解除される
check('1分経過後は再び通る', checkRateLimit('user-a', t0 + RATE_LIMIT_WINDOW_MS + 1).allowed);

console.log(failed === 0 ? '\nすべて期待どおりです。' : `\n${failed}件が期待と異なります。`);
process.exit(failed === 0 ? 0 : 1);
