/**
 * 許可メールドメインをDBへ同期する（納品フェーズ・QAレビュー HIGH-1）
 *
 * 社内メールドメイン制限は2か所で効いている。
 *   1. アプリ側 … Middleware・各API Route（環境変数 ALLOWED_EMAIL_DOMAIN を読む）
 *   2. DB側     … documents / document_chunks のRLS
 *                 （public.app_config.allowed_email_domain を読む）
 *
 * 2はSupabaseを直接叩かれる経路を塞ぐために必要だが、
 * 環境変数はDBから読めないため、値が2か所に分かれてしまう。
 * このスクリプトが「環境変数 → DB」の一方向同期を行い、ずれを防ぐ。
 *
 * 【いつ実行するか】
 *  - 初回セットアップ時（migration適用後）
 *  - ALLOWED_EMAIL_DOMAIN を変更したとき（変更後は必ず実行する）
 *
 * 【実行しないとどうなるか】
 *  - ドメインを変更したのにDB側が古いままだと、
 *    アプリは通すのにDBが弾き、「ログインできるのに文書が0件」になる。
 *
 * 実行：npm run sync:allowed-domain
 */

import { loadEnv } from './loadEnv';
import { createSupabaseAdminClient } from '../src/lib/supabase/admin';
import { ALLOWED_EMAIL_DOMAIN_ENV, getAllowedEmailDomain } from '../src/lib/auth/emailDomain';

loadEnv();

/** app_config 内のキー名（migration 20260820100000 と一致させること） */
const CONFIG_KEY = 'allowed_email_domain';

async function main() {
  // 正規化（`@` 除去・小文字化）はアプリ側と同じ関数に任せる。
  // ここで独自に整形すると、アプリとDBで判定がずれる
  const allowedDomain = getAllowedEmailDomain();

  if (!allowedDomain) {
    throw new Error(
      `環境変数 ${ALLOWED_EMAIL_DOMAIN_ENV} が設定されていません。` +
        '.env.local に社内メールドメイン（例：techbridge.co.jp）を設定してから実行してください。'
    );
  }

  // app_config はRLSで全拒否しているため、service_role（管理クライアント）で書き込む
  const admin = createSupabaseAdminClient();

  const { error } = await admin
    .from('app_config')
    .upsert({ key: CONFIG_KEY, value: allowedDomain, updated_at: new Date().toISOString() }, {
      onConflict: 'key',
    });

  if (error) {
    throw new Error(`許可ドメインの同期に失敗しました: ${error.message}`);
  }

  // ドメイン名はシークレットではないため表示してよい（APIキーとは扱いが異なる）
  console.log(`許可メールドメインをDBへ同期しました（${allowedDomain}）。`);
  console.log('このドメイン以外のアカウントは、Supabaseを直接叩いても文書を取得できません。');
}

main().catch((error) => {
  console.error('処理に失敗しました:', error instanceof Error ? error.message : error);
  process.exit(1);
});
