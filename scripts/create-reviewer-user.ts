/**
 * レビュー用ログインユーザーの作成（要件F-06）
 *
 * 動作確認をお願いする相手（講師・レビュー担当など）へ渡すアカウントを作る。
 *
 * 【create-test-user.ts との違い】
 * `create:test-user` は `.env.local` の TEST_USER_EMAIL / TEST_USER_PASSWORD を読む。
 * 別アドレスを作るたびに `.env.local` を書き換えて戻す必要があり、
 * 戻し忘れると以降の検証スクリプトが意図しないユーザーで動いてしまう。
 *
 * こちらは**引数でアドレスを受け取り、`.env.local` を一切変更しない**。
 * パスワードは実行時に生成するため、コマンド履歴にも残らない。
 *
 * 【確認メールについて】
 * 確認済みの状態で作成するため、社内ドメインが架空でもそのままログインできる。
 * 「社内メールを受信できること」という本人確認を意図的に飛ばす操作なので、
 * **実運用のユーザー作成には使わないこと**。動作確認用に限る。
 *
 * 実行：npm run create:reviewer -- reviewer@company.co.jp
 */

import { randomInt } from 'node:crypto';
import { loadEnv } from './loadEnv';
import { createSupabaseAdminClient } from '../src/lib/supabase/admin';
import {
  ALLOWED_EMAIL_DOMAIN_ENV,
  getAllowedEmailDomain,
  isAllowedEmailDomain,
} from '../src/lib/auth/emailDomain';

loadEnv();

/** 生成するパスワードの文字数（画面側の最低12文字を余裕をもって上回らせる） */
const PASSWORD_LENGTH = 20;

/**
 * パスワードに使う文字。
 *
 * 口頭・チャットで伝える際の読み違いを防ぐため、
 * 紛らわしい文字（0 O o / 1 l I）を除いている。
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** 記号。パスワードポリシーが記号を要求する場合に備えて必ず1文字含める */
const SYMBOLS = '!@#%+=?';

/**
 * ランダムなパスワードを生成する。
 *
 * Math.random() は暗号用途に使えないため、必ず crypto の randomInt を使う。
 */
function generatePassword(): string {
  const pick = (chars: string) => chars[randomInt(chars.length)];

  const characters = [
    pick('ABCDEFGHJKLMNPQRSTUVWXYZ'), // 大文字を1文字以上
    pick('abcdefghijkmnpqrstuvwxyz'), // 小文字を1文字以上
    pick('23456789'), // 数字を1文字以上
    pick(SYMBOLS), // 記号を1文字以上
  ];

  while (characters.length < PASSWORD_LENGTH) {
    characters.push(pick(ALPHABET));
  }

  // 先頭4文字が「大文字・小文字・数字・記号」の順に固定されないよう並べ替える
  for (let i = characters.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [characters[i], characters[j]] = [characters[j], characters[i]];
  }

  return characters.join('');
}

async function main() {
  // npm run create:reviewer -- <メールアドレス>
  const email = process.argv[2]?.trim();

  if (!email) {
    throw new Error(
      'メールアドレスを指定してください。\n' +
        '  例：npm run create:reviewer -- reviewer@company.co.jp'
    );
  }

  // ------------------------------------------------------------
  // 社内メールドメインの確認（要件F-06）
  //
  // ドメイン外のアドレスで作っても、MiddlewareとRLSに弾かれて
  // ログインも文書閲覧もできない。
  // 「作成は成功したのに何も見えない」という分かりにくい状態を避けるため、
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
      `指定されたアドレスのドメインが ${ALLOWED_EMAIL_DOMAIN_ENV}（${allowedDomain}）と一致しません。\n` +
        `  @${allowedDomain} のアドレスを指定してください。`
    );
  }

  const password = generatePassword();
  const admin = createSupabaseAdminClient();

  const { data: list, error: listError } = await admin.auth.admin.listUsers();
  if (listError) throw new Error(`ユーザー一覧の取得に失敗しました: ${listError.message}`);

  const existing = list.users.find((user) => user.email === email);

  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
    });
    if (error) throw new Error(`ユーザーの更新に失敗しました: ${error.message}`);
  } else {
    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      // 確認メールを省略して即ログインできる状態にする（動作確認用のため）
      email_confirm: true,
    });
    if (error) throw new Error(`ユーザーの作成に失敗しました: ${error.message}`);
  }

  // ------------------------------------------------------------
  // 認証情報の表示
  //
  // 【重要】ここでしか表示されない。パスワードはハッシュ化されて保存されるため、
  // あとから確認する方法は無い（忘れた場合は再実行して作り直す）
  // ------------------------------------------------------------
  const label = existing ? 'パスワードを再発行しました' : 'アカウントを作成しました';

  console.log('');
  console.log(`${label}（確認メール不要でログインできます）`);
  console.log('');
  console.log('  ------------------------------------------------------------');
  console.log(`   メールアドレス : ${email}`);
  console.log(`   パスワード     : ${password}`);
  console.log('  ------------------------------------------------------------');
  console.log('');
  console.log('  この表示は一度きりです。控えてから閉じてください。');
  console.log('  渡した相手以外へ共有しないでください。');
  console.log('  作り直す場合は同じコマンドを再実行してください（パスワードが変わります）。');
  console.log('');
}

main().catch((error) => {
  console.error('処理に失敗しました:', error instanceof Error ? error.message : error);
  process.exit(1);
});
