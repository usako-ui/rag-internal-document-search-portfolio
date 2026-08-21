/**
 * 社内メールドメイン制限の動作確認（要件F-06）
 *
 * 確認する内容：
 *  - ドメイン判定ロジックが迂回されないこと（部分一致・サブドメイン・大文字小文字）
 *  - ログインAPIがドメイン外のアドレスを403で拒否すること
 *  - **ログイン画面を経由せずSupabaseから直接取得したセッションでも
 *    社内文書へ到達できないこと**（最重要。ここが実効的な防御線の確認）
 *  - `/` `/demo` は意図どおり認証をスキップすること
 *
 * Gemini APIは呼ばないため、無料枠（1日20回）を消費しない。
 *
 * 事前に開発サーバーを起動しておくこと：npm run dev -- -p 3002
 * 実行：npm run verify:domain
 */

import { randomUUID } from 'node:crypto';
import { createServerClient } from '@supabase/ssr';
import { loadEnv, requireEnv } from './loadEnv';
import { createSupabaseAdminClient } from '../src/lib/supabase/admin';
import { requireAllowedDomain } from './testEmailDomain';
import { DOMAIN_RESTRICTION_MESSAGE, isAllowedEmailDomain } from '../src/lib/auth/emailDomain';

loadEnv();

const BASE_URL = process.env.VERIFY_BASE_URL ?? 'http://localhost:3002';

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

/**
 * 指定ユーザーでSupabaseへ直接ログインし、ブラウザが持つのと同じ形のCookieを組み立てる。
 *
 * 【この関数が再現しているもの】
 * anonキーは NEXT_PUBLIC_ で公開されるため、攻撃者はログイン画面を使わずに
 * これと同じことができる。つまり「ログイン前のドメインチェック」は迂回できる。
 * ここで作ったCookieでアプリのAPIを叩き、Middlewareが弾くことを確認する。
 */
async function signInAndBuildCookie(email: string, password: string): Promise<string> {
  const jar: Record<string, string> = {};

  const supabase = createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll: () => Object.entries(jar).map(([name, value]) => ({ name, value })),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => {
            jar[name] = value;
          });
        },
      },
    }
  );

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`ログインに失敗しました（${email}）: ${error.message}`);

  return Object.entries(jar)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
}

/** APIへリクエストする（リダイレクトは追わず、そのまま観測する） */
async function callApi(
  method: string,
  path: string,
  options: { cookie?: string; body?: unknown } = {}
): Promise<{ status: number; json: unknown; location: string | null }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/json',
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  const json = await response.json().catch(() => null);
  return { status: response.status, json, location: response.headers.get('location') };
}

/** レスポンスのエラーメッセージを取り出す */
function errorMessageOf(json: unknown): string {
  return (json as { error?: string } | null)?.error ?? '';
}

async function main() {
  const allowedDomain = requireAllowedDomain();

  // ------------------------------------------------------------
  // 1. ドメイン判定ロジック（開発サーバー不要）
  // ------------------------------------------------------------
  console.log('');
  console.log(`【1】ドメイン判定ロジック（許可ドメイン: ${allowedDomain}）`);

  const logicCases: { label: string; email: string | null | undefined; expected: boolean }[] = [
    { label: '許可ドメインは通す', email: `user@${allowedDomain}`, expected: true },
    { label: '大文字でも通す', email: `User@${allowedDomain.toUpperCase()}`, expected: true },
    { label: '前後に空白があっても通す', email: `  user@${allowedDomain}  `, expected: true },
    { label: '別ドメインは拒否', email: 'qa-tester@example.com', expected: false },
    { label: '前方に文字を足した偽ドメインを拒否', email: `user@evil${allowedDomain}`, expected: false },
    {
      label: '後方に文字を足した偽ドメインを拒否',
      email: `user@${allowedDomain}.example.com`,
      expected: false,
    },
    { label: 'サブドメインを拒否', email: `user@mail.${allowedDomain}`, expected: false },
    { label: '@ が無い文字列を拒否', email: allowedDomain, expected: false },
    { label: 'ローカル部が空を拒否', email: `@${allowedDomain}`, expected: false },
    { label: 'ドメインが空を拒否', email: 'user@', expected: false },
    { label: '空文字を拒否', email: '', expected: false },
    { label: 'null を拒否', email: null, expected: false },
    { label: 'undefined を拒否', email: undefined, expected: false },
  ];

  for (const testCase of logicCases) {
    const actual = isAllowedEmailDomain(testCase.email, allowedDomain);
    check(testCase.label, actual === testCase.expected, `expected=${testCase.expected}`);
  }

  // 許可ドメイン未設定なら誰も通さない（fail-closed）
  check(
    '許可ドメイン未設定なら許可アドレスも拒否（fail-closed）',
    isAllowedEmailDomain(`user@${allowedDomain}`, null) === false
  );

  // ------------------------------------------------------------
  // 2. 開発サーバーの起動確認
  // ------------------------------------------------------------
  try {
    await fetch(BASE_URL, { method: 'HEAD' });
  } catch {
    throw new Error(
      `開発サーバーへ接続できません（${BASE_URL}）。別ターミナルで npm run dev -- -p 3002 を実行してください。`
    );
  }

  console.log('');
  console.log(`検証対象: ${BASE_URL}`);

  // ------------------------------------------------------------
  // 3. ログインAPI（/api/auth/login）
  // ------------------------------------------------------------
  console.log('');
  console.log('【2】ログインAPIのドメイン拒否');

  // 指示された確認項目：qa-tester@example.com でログインできないこと。
  // ドメイン判定はSupabaseへ問い合わせる前に行うため、
  // アカウントの有無・パスワードの正誤に関わらず403になる
  const rejected = await callApi('POST', '/api/auth/login', {
    body: { email: 'qa-tester@example.com', password: 'dummy-password-not-used' },
  });
  check(
    'qa-tester@example.com が403で拒否される',
    rejected.status === 403,
    `status=${rejected.status}`
  );
  check(
    '拒否メッセージが指定文言と一致する',
    errorMessageOf(rejected.json) === DOMAIN_RESTRICTION_MESSAGE,
    errorMessageOf(rejected.json)
  );

  const emptyBody = await callApi('POST', '/api/auth/login', { body: {} });
  check('メール・パスワード未入力は400', emptyBody.status === 400, `status=${emptyBody.status}`);

  // 社内ドメインだがパスワードが違う場合は401（ドメイン拒否と区別できること）
  const wrongPassword = await callApi('POST', '/api/auth/login', {
    body: { email: `no-such-user-${randomUUID()}@${allowedDomain}`, password: 'wrong-password' },
  });
  check(
    '社内ドメイン＋誤ったパスワードは401（403と区別できる）',
    wrongPassword.status === 401,
    `status=${wrongPassword.status}`
  );

  // 正規ユーザーはログインできる
  const mainEmail = requireEnv('TEST_USER_EMAIL');
  const mainPassword = requireEnv('TEST_USER_PASSWORD');
  check(
    'TEST_USER_EMAIL が許可ドメインである',
    isAllowedEmailDomain(mainEmail, allowedDomain),
    'ドメイン外の場合は .env.local を修正し npm run create:test-user を実行すること'
  );

  const loggedIn = await callApi('POST', '/api/auth/login', {
    body: { email: mainEmail, password: mainPassword },
  });
  check('社内アドレスでログインAPIが200を返す', loggedIn.status === 200, `status=${loggedIn.status}`);

  // ------------------------------------------------------------
  // 4. 迂回経路の確認（最重要）
  //
  //    ログイン画面を使わずSupabaseから直接セッションを取得しても
  //    社内文書へ到達できないことを確認する
  // ------------------------------------------------------------
  console.log('');
  console.log('【3】ログイン画面を迂回したセッションの遮断（最重要）');

  const admin = createSupabaseAdminClient();
  const outsiderEmail = `domain-check-${randomUUID()}@example.com`;
  const outsiderPassword = `Verify-${randomUUID()}`;

  const { data: outsider, error: createError } = await admin.auth.admin.createUser({
    email: outsiderEmail,
    password: outsiderPassword,
    email_confirm: true,
  });

  if (createError || !outsider.user) {
    throw new Error(`検証用ユーザーの作成に失敗しました: ${createError?.message ?? '不明'}`);
  }

  try {
    // ログイン画面・ログインAPIを一切使わずにセッションを取得する
    const outsiderCookie = await signInAndBuildCookie(outsiderEmail, outsiderPassword);
    check('ドメイン外でもSupabaseから直接セッションは取得できる（前提の確認）', true);

    const documents = await callApi('GET', '/api/documents', { cookie: outsiderCookie });
    check(
      'そのセッションで GET /api/documents が403',
      documents.status === 403,
      `status=${documents.status}`
    );
    check(
      '403のメッセージが指定文言と一致する',
      errorMessageOf(documents.json) === DOMAIN_RESTRICTION_MESSAGE,
      errorMessageOf(documents.json)
    );

    const chat = await callApi('POST', '/api/chat', {
      cookie: outsiderCookie,
      body: { question: '就業規則について教えてください' },
    });
    check('そのセッションで POST /api/chat が403', chat.status === 403, `status=${chat.status}`);

    const histories = await callApi('GET', '/api/histories', { cookie: outsiderCookie });
    check(
      'そのセッションで GET /api/histories が403',
      histories.status === 403,
      `status=${histories.status}`
    );

    const settings = await callApi('GET', '/api/settings', { cookie: outsiderCookie });
    check(
      'そのセッションで GET /api/settings が403',
      settings.status === 403,
      `status=${settings.status}`
    );

    // 削除は取り消せない操作なので、ドメイン外セッションで届かないことを必ず確認する
    const deleteDocument = await callApi('DELETE', '/api/documents?id=00000000-0000-0000-0000-000000000000', {
      cookie: outsiderCookie,
    });
    check(
      'そのセッションで DELETE /api/documents が403',
      deleteDocument.status === 403,
      `status=${deleteDocument.status}`
    );

    const chatPage = await callApi('GET', '/chat', { cookie: outsiderCookie });
    check(
      'そのセッションで /chat がログイン画面へリダイレクト',
      (chatPage.status === 307 || chatPage.status === 302) &&
        (chatPage.location ?? '').includes('/login'),
      `status=${chatPage.status} location=${chatPage.location ?? 'なし'}`
    );
    check(
      'リダイレクト先に理由（error=domain）が付く',
      (chatPage.location ?? '').includes('error=domain'),
      chatPage.location ?? 'なし'
    );
  } finally {
    // 検証用ユーザーを残さない（残すとドメイン外アカウントが増え続ける）
    await admin.auth.admin.deleteUser(outsider.user.id);
  }

  // ------------------------------------------------------------
  // 5. 未ログイン・公開パスの確認（回帰チェック）
  // ------------------------------------------------------------
  console.log('');
  console.log('【4】未ログインアクセスと公開パス');

  const unauthDocuments = await callApi('GET', '/api/documents');
  check(
    '未ログインの GET /api/documents は401',
    unauthDocuments.status === 401,
    `status=${unauthDocuments.status}`
  );

  const unauthChat = await callApi('POST', '/api/chat', { body: { question: 'テスト' } });
  check('未ログインの POST /api/chat は401', unauthChat.status === 401, `status=${unauthChat.status}`);

  for (const path of ['/', '/demo', '/demo/chat', '/login']) {
    const response = await fetch(`${BASE_URL}${path}`, { redirect: 'manual' });
    check(
      `${path} は未ログインで表示できる（意図的な公開パス）`,
      response.status === 200,
      `status=${response.status}`
    );
  }

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
