/**
 * サイドバー構成変更・新規画面（ダッシュボード／文書管理／文書を検索）の動作確認
 *
 * 画面のクリック操作は自動化できないため、
 * 「画面の裏側」と「ナビの定義」が正しいことを確認する。
 *
 *  - 新しい画面（/dashboard・/documents・/search）が未ログインで開けないこと（F-06）
 *  - ログイン済みなら3画面とも表示できること
 *  - ログイン済みで `/`（ランディング）を開くと /dashboard へ送られること（STEP 5）
 *  - 未ログインの `/` は今までどおり開けること（デモ導線を壊していないこと）
 *  - 既存URL（/chat・/histories・/settings）が維持されていること
 *  - DELETE /api/documents が認証必須で、文書とチャンクを一緒に消すこと（F-09）
 *  - ナビ定義から削除済みの項目が残っていないこと
 *
 * Gemini APIは呼ばないため、無料枠（1日20回）を消費しない。
 *
 * 事前に開発サーバーを起動しておくこと：npm run dev -- -p 3002
 * 実行：npm run verify:nav
 */

import { createServerClient } from '@supabase/ssr';
import { loadEnv, requireEnv } from './loadEnv';
import { createSupabaseAdminClient } from '../src/lib/supabase/admin';
import { NAV_ROUTES, NEW_CHAT_PATH, HOME_PATH } from '../src/lib/navigation/routes';
import { DEFAULT_REDIRECT_PATH } from '../src/lib/auth/redirect';

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

/** 指定ユーザーでログインし、ブラウザが持つのと同じ形のCookieを組み立てる */
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

/** 画面・APIへリクエストする（リダイレクトは追わず、行き先まで確認する） */
async function request(
  method: string,
  path: string,
  cookie?: string
): Promise<{ status: number; location: string }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    redirect: 'manual',
    headers: cookie ? { Cookie: cookie } : {},
  });

  return { status: response.status, location: response.headers.get('location') ?? '' };
}

async function main() {
  try {
    await fetch(BASE_URL, { method: 'HEAD' });
  } catch {
    throw new Error(
      `開発サーバーへ接続できません（${BASE_URL}）。別ターミナルで npm run dev -- -p 3002 を実行してください。`
    );
  }

  console.log(`検証対象: ${BASE_URL}`);
  console.log('='.repeat(88));

  // ------------------------------------------------------------
  // 1. ナビ定義（削除した項目が残っていないか）
  // ------------------------------------------------------------
  console.log('');
  console.log('【1】ナビゲーション定義');

  const navIds = Object.keys(NAV_ROUTES).sort();
  check(
    'ナビは6項目（chat・documents・search・history・dashboard・settings）',
    navIds.join(',') === 'chat,dashboard,documents,history,search,settings',
    navIds.join(',')
  );

  check(
    '「新しい質問」は ?new=1 付きでチャットへ送る（会話リセットの合図）',
    NAV_ROUTES.chat === NEW_CHAT_PATH && NEW_CHAT_PATH === '/chat?new=1',
    NAV_ROUTES.chat
  );

  check(
    '既存URLが維持されている（/histories・/settings・/documents）',
    NAV_ROUTES.history === '/histories' &&
      NAV_ROUTES.settings === '/settings' &&
      NAV_ROUTES.documents === '/documents',
    `${NAV_ROUTES.history} / ${NAV_ROUTES.settings} / ${NAV_ROUTES.documents}`
  );

  check(
    'ログイン後の初期画面がダッシュボードにそろっている',
    HOME_PATH === '/dashboard' && DEFAULT_REDIRECT_PATH === '/dashboard',
    `HOME_PATH=${HOME_PATH} / DEFAULT_REDIRECT_PATH=${DEFAULT_REDIRECT_PATH}`
  );

  // ------------------------------------------------------------
  // 2. 未ログインアクセス（最重要：新しい画面から社内文書が漏れないこと）
  // ------------------------------------------------------------
  console.log('');
  console.log('【2】未ログインアクセス');

  for (const path of ['/dashboard', '/documents', '/search', '/chat', '/histories', '/settings']) {
    const response = await request('GET', path);
    check(
      `${path} はログイン画面へ送られる`,
      response.status === 307 && response.location.includes('/login'),
      `status=${response.status}`
    );
  }

  const landing = await request('GET', '/');
  check('未ログインの / は今までどおり開ける', landing.status === 200, `status=${landing.status}`);

  const unauthDelete = await request(
    'DELETE',
    '/api/documents?id=00000000-0000-0000-0000-000000000000'
  );
  check(
    '未ログインの DELETE /api/documents は401',
    unauthDelete.status === 401,
    `status=${unauthDelete.status}`
  );

  // ------------------------------------------------------------
  // 3. ログイン済みアクセス
  // ------------------------------------------------------------
  console.log('');
  console.log('【3】ログイン済みアクセス');

  const cookie = await signInAndBuildCookie(
    requireEnv('TEST_USER_EMAIL'),
    requireEnv('TEST_USER_PASSWORD')
  );

  for (const path of ['/dashboard', '/documents', '/search', '/chat', '/histories', '/settings']) {
    const response = await request('GET', path, cookie);
    check(`${path} が表示できる`, response.status === 200, `status=${response.status}`);
  }

  const newChat = await request('GET', NEW_CHAT_PATH, cookie);
  check(`${NEW_CHAT_PATH} が表示できる`, newChat.status === 200, `status=${newChat.status}`);

  const landingAsUser = await request('GET', '/', cookie);
  check(
    'ログイン済みで / を開くとダッシュボードへ送られる（STEP 5）',
    (landingAsUser.status === 307 || landingAsUser.status === 302) &&
      landingAsUser.location.endsWith('/dashboard'),
    `status=${landingAsUser.status} location=${landingAsUser.location || 'なし'}`
  );

  // ------------------------------------------------------------
  // 4. 文書の削除（F-09）
  // ------------------------------------------------------------
  console.log('');
  console.log('【4】DELETE /api/documents');

  const badId = await request('DELETE', '/api/documents?id=not-a-uuid', cookie);
  check(
    'UUID以外のidは400（原因の分からない500にしない）',
    badId.status === 400,
    `status=${badId.status}`
  );

  const missing = await request(
    'DELETE',
    '/api/documents?id=00000000-0000-0000-0000-000000000000',
    cookie
  );
  check('存在しない文書は404', missing.status === 404, `status=${missing.status}`);

  // 実際に削除できること・チャンクも一緒に消えることを確認する。
  // 既存の文書を消すと検証用データが減るため、検証専用の文書を作って消す
  const admin = createSupabaseAdminClient();

  const { data: created, error: createError } = await admin
    .from('documents')
    .insert({ name: '【検証用】削除テスト.pdf', department: '情報システム部', status: 'ready' })
    .select('id')
    .single();

  if (createError || !created) {
    throw new Error(`検証用文書の作成に失敗しました: ${createError?.message ?? '不明'}`);
  }

  const documentId = created.id as string;
  let isDeleted = false;

  try {
    const { error: chunkError } = await admin.from('document_chunks').insert({
      document_id: documentId,
      content: '検証用のチャンクです。',
      chunk_index: 0,
    });

    check('検証用の文書とチャンクを作成できた', !chunkError, chunkError?.message ?? '');

    const deleted = await request('DELETE', `/api/documents?id=${documentId}`, cookie);
    check('登録済み文書を削除できる', deleted.status === 200, `status=${deleted.status}`);
    isDeleted = deleted.status === 200;

    const { data: remainingDocuments } = await admin
      .from('documents')
      .select('id')
      .eq('id', documentId);

    check(
      '削除後、documents から消えている',
      (remainingDocuments ?? []).length === 0,
      `${(remainingDocuments ?? []).length}件`
    );

    // ここが消えていないと、削除したはずの文書が検索結果に出続ける
    const { data: remainingChunks } = await admin
      .from('document_chunks')
      .select('id')
      .eq('document_id', documentId);

    check(
      '削除後、document_chunks も一緒に消えている（cascade）',
      (remainingChunks ?? []).length === 0,
      `${(remainingChunks ?? []).length}件`
    );
  } finally {
    // 検証用データを残さない（削除に失敗した場合の後始末）
    if (!isDeleted) {
      await admin.from('documents').delete().eq('id', documentId);
    }
  }

  // ------------------------------------------------------------
  // 結果
  // ------------------------------------------------------------
  console.log('');
  console.log('='.repeat(88));
  console.log(`合格 ${passed}件 / 不合格 ${failed}件`);

  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
