/**
 * 検証用ログインユーザーの作成（要件F-06）
 *
 * Supabase Auth にログイン可能なユーザーが1件も無いと、
 * ログイン画面・統合テスト・APIの認証確認ができない。
 * ダッシュボードの Authentication > Users から追加するのと同じ処理を行う。
 *
 * 認証情報は `.env.local` の TEST_USER_EMAIL / TEST_USER_PASSWORD から読む。
 * 【重要】パスワードを画面・ログへ出力しないこと。`.env.local` はGit管理外。
 *
 * 【重要】TEST_USER_EMAIL は ALLOWED_EMAIL_DOMAIN（社内メールドメイン）と
 *         一致している必要がある。一致しない場合は作成せずエラーで止める。
 *
 * 実行：npm run create:test-user
 */

import { loadEnv, requireEnv } from './loadEnv';
import { createSupabaseAdminClient } from '../src/lib/supabase/admin';
import {
  ALLOWED_EMAIL_DOMAIN_ENV,
  getAllowedEmailDomain,
  isAllowedEmailDomain,
} from '../src/lib/auth/emailDomain';

loadEnv();

async function main() {
  const email = requireEnv('TEST_USER_EMAIL');
  const password = requireEnv('TEST_USER_PASSWORD');

  // ------------------------------------------------------------
  // 社内メールドメインの確認（要件F-06）
  //
  // ドメイン外のアドレスで作成しても、Middlewareに弾かれて
  // ログインも各verifyスクリプトも通らない。
  // 「作成は成功したのにログインできない」という分かりにくい状態を避けるため、
  // ここで理由を明示して止める
  // ------------------------------------------------------------
  const allowedDomain = getAllowedEmailDomain();

  if (!allowedDomain) {
    throw new Error(
      `環境変数 ${ALLOWED_EMAIL_DOMAIN_ENV} が設定されていません。` +
        '.env.local に社内メールドメイン（例：company.co.jp）を設定してください。'
    );
  }

  if (!isAllowedEmailDomain(email, allowedDomain)) {
    throw new Error(
      `TEST_USER_EMAIL のドメインが ${ALLOWED_EMAIL_DOMAIN_ENV}（${allowedDomain}）と一致しません。
` +
        `.env.local の TEST_USER_EMAIL を @${allowedDomain} のアドレスへ変更してから、もう一度実行してください。`
    );
  }

  const admin = createSupabaseAdminClient();

  // 既に同じメールアドレスのユーザーが居る場合は作成せずパスワードだけ揃える
  const { data: list, error: listError } = await admin.auth.admin.listUsers();
  if (listError) throw new Error(`ユーザー一覧の取得に失敗しました: ${listError.message}`);

  const existing = list.users.find((user) => user.email === email);

  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
    });
    if (error) throw new Error(`ユーザーの更新に失敗しました: ${error.message}`);

    console.log(`既存の検証用ユーザーのパスワードを更新しました（${email}）。`);
    return;
  }

  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    // メール確認を省略して即ログインできる状態にする（開発環境のため）
    email_confirm: true,
  });
  if (error) throw new Error(`ユーザーの作成に失敗しました: ${error.message}`);

  console.log(`検証用ユーザーを作成しました（${email}）。`);
}

main().catch((error) => {
  console.error('処理に失敗しました:', error instanceof Error ? error.message : error);
  process.exit(1);
});
