/**
 * 自己登録機能の動作確認（要件F-06）
 *
 * 確認する内容：
 *  - 登録画面 `/register` が未ログインで開けること
 *  - 社内ドメイン以外のアドレスが登録前に拒否されること（403）
 *  - パスワード12文字未満・未入力が拒否されること
 *  - 登録してもすぐにはログインできないこと（**Confirm email が有効**の確認）
 *  - ログイン画面に登録画面への導線があること
 *
 * 【メール送信の回数制限に注意】
 * Supabaseの標準SMTPは送信回数が厳しく制限されている（無料枠は1時間あたり数通）。
 * そのため実際に登録を行う検証は**1回だけ**にしている。
 * `SKIP_REGISTER_SIGNUP=1` を付けると実登録をスキップできる。
 *
 * 事前に開発サーバーを起動しておくこと：npm run dev -- -p 3002
 * 実行：npm run verify:register
 */

import { randomUUID } from 'node:crypto';
import { loadEnv } from './loadEnv';
import { createSupabaseAdminClient } from '../src/lib/supabase/admin';
import { requireAllowedDomain } from './testEmailDomain';
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_TOO_SHORT_MESSAGE,
  REGISTER_DOMAIN_MESSAGE,
} from '../src/lib/auth/registerRules';

loadEnv();

const BASE_URL = process.env.VERIFY_BASE_URL ?? 'http://localhost:3002';
const SKIP_SIGNUP = process.env.SKIP_REGISTER_SIGNUP === '1';

let passed = 0;
let failed = 0;

/** 検証結果を1件記録する */
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed += 1;
    console.log(`  OK   ${label}${detail ? ` … ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`  NG   ${label}${detail ? ` … ${detail}` : ''}`);
  }
}

/** APIへリクエストする */
async function callApi(path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const json = await response.json().catch(() => null);
  return { status: response.status, json };
}

/** レスポンスのエラーメッセージを取り出す */
function errorMessageOf(json: unknown): string {
  return (json as { error?: string } | null)?.error ?? '';
}

/**
 * 絵文字が含まれているかどうかを判定する（コーディング規約：絵文字禁止）。
 *
 * Unicodeプロパティ（\p{...}）は tsconfig の target の都合で使えないため、
 * 文字コードで判定する。日本語はこの範囲に入らないため誤検出しない。
 */
function containsEmoji(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);

    // サロゲートペアの上位（絵文字の大半）／記号・装飾記号／異体字セレクタ
    if (code >= 0xd800 && code <= 0xdbff) return true;
    if (code >= 0x2600 && code <= 0x27bf) return true;
    if (code === 0xfe0f) return true;
  }

  return false;
}

async function main() {
  const allowedDomain = requireAllowedDomain();

  try {
    await fetch(BASE_URL, { method: 'HEAD' });
  } catch {
    throw new Error(
      `開発サーバーへ接続できません（${BASE_URL}）。別ターミナルで npm run dev -- -p 3002 を実行してください。`
    );
  }

  console.log('');
  console.log(`検証対象: ${BASE_URL}（許可ドメイン: ${allowedDomain}）`);

  // ------------------------------------------------------------
  // 1. 画面が開けること・導線があること
  // ------------------------------------------------------------
  console.log('');
  console.log('【1】登録画面と導線');

  const registerPage = await fetch(`${BASE_URL}/register`, { redirect: 'manual' });
  const registerHtml = await registerPage.text();
  check(
    '/register が未ログインで開ける',
    registerPage.status === 200,
    `status=${registerPage.status}`
  );
  check('タイトル「アカウント登録」が表示される', registerHtml.includes('アカウント登録'));
  check(
    '説明文が表示される',
    registerHtml.includes('社内メールアドレスで登録してください。') &&
      registerHtml.includes('確認メールをお送りします。')
  );
  check('パスワードの条件が事前に示される', registerHtml.includes(`${MIN_PASSWORD_LENGTH}文字以上`));
  check('「登録する」ボタンがある', registerHtml.includes('登録する'));
  check('ログイン画面へのリンクがある', registerHtml.includes('ログインはこちら'));
  check('絵文字を使っていない', !containsEmoji(registerHtml));

  const loginPage = await fetch(`${BASE_URL}/login`, { redirect: 'manual' });
  const loginHtml = await loginPage.text();
  check(
    'ログイン画面に登録への案内文がある',
    loginHtml.includes('アカウントをお持ちでない方は登録してください')
  );
  check('ログイン画面に /register へのリンクがある', loginHtml.includes('href="/register"'));

  // ------------------------------------------------------------
  // 2. 登録APIの入力検証（メールを送らない範囲）
  // ------------------------------------------------------------
  console.log('');
  console.log('【2】登録APIの入力検証（メール送信なし）');

  const outsider = await callApi('/api/auth/register', {
    email: 'outsider@example.com',
    password: 'a'.repeat(MIN_PASSWORD_LENGTH),
  });
  check('社外ドメインは403で拒否される', outsider.status === 403, `status=${outsider.status}`);
  check(
    '拒否メッセージが指定文言と一致する',
    errorMessageOf(outsider.json) === REGISTER_DOMAIN_MESSAGE,
    errorMessageOf(outsider.json)
  );

  const shortPassword = await callApi('/api/auth/register', {
    email: `short-${randomUUID()}@${allowedDomain}`,
    password: 'a'.repeat(MIN_PASSWORD_LENGTH - 1),
  });
  check(
    `${MIN_PASSWORD_LENGTH - 1}文字のパスワードは400で拒否される`,
    shortPassword.status === 400,
    `status=${shortPassword.status}`
  );
  check(
    'パスワード文字数のメッセージが指定文言と一致する',
    errorMessageOf(shortPassword.json) === PASSWORD_TOO_SHORT_MESSAGE,
    errorMessageOf(shortPassword.json)
  );

  const emptyInput = await callApi('/api/auth/register', {});
  check('未入力は400で拒否される', emptyInput.status === 400, `status=${emptyInput.status}`);

  // ドメイン判定は文字数判定より先に行う（社外の相手にパスワード規則を教えない）
  const outsiderShort = await callApi('/api/auth/register', {
    email: 'outsider@example.com',
    password: 'short',
  });
  check(
    '社外ドメインならパスワード規則を伝えず403にする',
    outsiderShort.status === 403 && errorMessageOf(outsiderShort.json) === REGISTER_DOMAIN_MESSAGE,
    `status=${outsiderShort.status} / ${errorMessageOf(outsiderShort.json)}`
  );

  // 部分一致による偽ドメインを登録経路でも拒否できること
  const lookalike = await callApi('/api/auth/register', {
    email: `attacker@evil${allowedDomain}`,
    password: 'a'.repeat(MIN_PASSWORD_LENGTH),
  });
  check('前方に文字を足した偽ドメインも403', lookalike.status === 403, `status=${lookalike.status}`);

  const subdomain = await callApi('/api/auth/register', {
    email: `attacker@mail.${allowedDomain}`,
    password: 'a'.repeat(MIN_PASSWORD_LENGTH),
  });
  check('サブドメインも403', subdomain.status === 403, `status=${subdomain.status}`);

  // ------------------------------------------------------------
  // 3. 実際の登録（メールを1通送る）
  //
  //    Confirm email が有効なため、登録してもログインできないことを確認する。
  //    ここが「社内メールを受信できる人だけが使える」ことの担保になっている
  // ------------------------------------------------------------
  console.log('');
  console.log('【3】実際の登録とConfirm emailの確認');

  if (SKIP_SIGNUP) {
    console.log('  -- SKIP_REGISTER_SIGNUP=1 のため実登録をスキップしました');
  } else {
    const admin = createSupabaseAdminClient();
    const newEmail = `register-check-${randomUUID()}@${allowedDomain}`;
    const newPassword = `Register-${randomUUID()}`;

    const registered = await callApi('/api/auth/register', {
      email: newEmail,
      password: newPassword,
    });

    if (registered.status !== 200 && /上限|rate|email/i.test(errorMessageOf(registered.json))) {
      // Supabaseの標準SMTPは送信回数制限が厳しい。制限は実装の不具合ではない
      console.log('  -- Supabaseのメール送信上限に達しているため実登録をスキップします');
      console.log(`     メッセージ: ${errorMessageOf(registered.json)}`);
    } else {
      check('社内アドレスで登録できる', registered.status === 200, `status=${registered.status}`);
      check(
        '「確認メールを送信しました。」が返る',
        (registered.json as { message?: string } | null)?.message === '確認メールを送信しました。',
        String((registered.json as { message?: string } | null)?.message)
      );

      // 作成されたユーザーの状態を管理APIで確認する
      const { data: list, error: listError } = await admin.auth.admin.listUsers();
      if (listError) throw new Error(`ユーザー一覧の取得に失敗しました: ${listError.message}`);

      const created = list.users.find((user) => user.email === newEmail);
      check('ユーザーが作成されている', Boolean(created));
      check(
        'メール未確認の状態で作成される（Confirm emailが有効）',
        Boolean(created) && !created?.email_confirmed_at,
        `email_confirmed_at=${created?.email_confirmed_at ?? 'null'}`
      );

      // 未確認のままログインできないこと（ここが破れると登録＝即利用になってしまう）
      const login = await callApi('/api/auth/login', { email: newEmail, password: newPassword });
      check('メール確認前はログインできない', login.status === 401, `status=${login.status}`);
      check(
        'ログインできない理由が利用者に伝わる',
        errorMessageOf(login.json).includes('確認'),
        errorMessageOf(login.json)
      );

      // 検証用ユーザーを残さない
      if (created) {
        await admin.auth.admin.deleteUser(created.id);
        console.log('  （検証用に作成したユーザーを削除しました）');
      }
    }
  }

  // ------------------------------------------------------------
  // 4. 既存の保護が壊れていないこと（回帰）
  // ------------------------------------------------------------
  console.log('');
  console.log('【4】既存の保護への影響');

  for (const path of ['/chat', '/histories', '/settings']) {
    const response = await fetch(`${BASE_URL}${path}`, { redirect: 'manual' });
    check(
      `${path} は未ログインでログイン画面へ送られる`,
      response.status === 307 || response.status === 302,
      `status=${response.status}`
    );
  }

  const documents = await fetch(`${BASE_URL}/api/documents`, { redirect: 'manual' });
  check(
    'GET /api/documents は未ログインで401',
    documents.status === 401,
    `status=${documents.status}`
  );

  // ------------------------------------------------------------
  // 結果
  // ------------------------------------------------------------
  console.log('');
  console.log('='.repeat(88));
  console.log(`合格 ${passed} 件 / 不合格 ${failed} 件`);

  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error('処理に失敗しました:', error instanceof Error ? error.message : error);
  process.exit(1);
});
