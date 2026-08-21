/**
 * 納品前改善フェーズ STEP 1（バックエンド追加）の動作確認
 *
 * 確認する内容：
 *  - GET/POST /api/histories が未ログインで401を返すこと
 *  - 履歴の保存・取得が本人分だけ成立すること
 *  - **他人の履歴が絶対に見えないこと**（RLSの実効確認・最重要）
 *  - GET /api/documents の department / keyword フィルターが効くこと
 *
 * Gemini APIは呼ばないため、無料枠（1日20回）を消費しない。
 *
 * 事前に開発サーバーを起動しておくこと：npm run dev -- -p 3002
 * 実行：npm run verify:step1
 */

import { randomUUID } from 'node:crypto';
import { createServerClient } from '@supabase/ssr';
import { loadEnv, requireEnv } from './loadEnv';
import { createSupabaseAdminClient } from '../src/lib/supabase/admin';
import { requireAllowedDomain } from './testEmailDomain';

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

/** 履歴1件（検証用の緩い型） */
type HistoryRow = {
  id: string;
  question: string;
  answer: string;
  citations: unknown[];
  created_at: string;
};

/** 文書1件（検証用の緩い型） */
type DocumentRow = {
  id: string;
  name: string;
  department: string | null;
};

/**
 * 指定ユーザーでログインし、ブラウザが持つのと同じ形のCookieを組み立てる。
 * Cookieの分割・エンコードは @supabase/ssr に任せる（自前で作ると形式ズレで動かない）。
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

/** APIへリクエストする */
async function callApi(
  method: string,
  path: string,
  options: { cookie?: string; body?: unknown } = {}
): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  const json = await response.json().catch(() => null);
  return { status: response.status, json };
}

/** レスポンスを配列として扱う（想定外の形でも落とさない） */
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

async function main() {
  try {
    await fetch(BASE_URL, { method: 'HEAD' });
  } catch {
    throw new Error(
      `開発サーバーへ接続できません（${BASE_URL}）。別ターミナルで npm run dev -- -p 3002 を実行してください。`
    );
  }

  const admin = createSupabaseAdminClient();
  const mainEmail = requireEnv('TEST_USER_EMAIL');
  const mainPassword = requireEnv('TEST_USER_PASSWORD');

  console.log(`検証対象: ${BASE_URL}`);
  console.log('='.repeat(88));

  // ------------------------------------------------------------
  // 1. 未ログインアクセスの拒否
  // ------------------------------------------------------------
  console.log('');
  console.log('【1】未ログインアクセス（履歴は個人データのため必ず401）');
  const getUnauth = await callApi('GET', '/api/histories');
  check('GET /api/histories が401', getUnauth.status === 401, `status=${getUnauth.status}`);

  const postUnauth = await callApi('POST', '/api/histories', {
    body: { question: 'テスト', answer: 'テスト回答', citations: [] },
  });
  check('POST /api/histories が401', postUnauth.status === 401, `status=${postUnauth.status}`);

  // ------------------------------------------------------------
  // 2. 履歴の保存と取得（本人）
  // ------------------------------------------------------------
  console.log('');
  console.log('【2】履歴の保存・取得');
  const cookie = await signInAndBuildCookie(mainEmail, mainPassword);
  const marker = `検証用の質問 ${randomUUID()}`;

  const created = await callApi('POST', '/api/histories', {
    cookie,
    body: {
      question: marker,
      answer: 'これは検証用の回答です。',
      citations: [
        {
          document_name: '就業規則(抜粋)',
          page: 'p.1',
          section: '第1章',
          document_id: randomUUID(),
        },
      ],
    },
  });
  const createdRow = created.json as HistoryRow | null;
  check('POST /api/histories が201', created.status === 201, `status=${created.status}`);
  check('保存した質問が返る', createdRow?.question === marker);
  check('出典が保存される', asArray(createdRow?.citations).length === 1);

  const listed = await callApi('GET', '/api/histories', { cookie });
  const listedRows = asArray<HistoryRow>(listed.json);
  check('GET /api/histories が200', listed.status === 200, `status=${listed.status}`);
  check('配列が返る', Array.isArray(listed.json), `${listedRows.length}件`);
  check('保存した履歴が含まれる', listedRows.some((item) => item.question === marker));

  // 作成日時の降順になっているか（最新が先頭）
  const timestamps = listedRows.map((item) => new Date(item.created_at).getTime());
  const isDescending = timestamps.every(
    (value, index) => index === 0 || timestamps[index - 1] >= value
  );
  check('作成日時の降順で返る', isDescending);

  // limit パラメータ（設定画面の「履歴表示件数」で使用する）
  const limited = await callApi('GET', '/api/histories?limit=1', { cookie });
  const limitedRows = asArray<HistoryRow>(limited.json);
  check('limit=1 で1件に絞られる', limitedRows.length <= 1, `${limitedRows.length}件`);

  // ------------------------------------------------------------
  // 3. 他人の履歴が見えないこと（RLSの実効確認）
  // ------------------------------------------------------------
  console.log('');
  console.log('【3】他人の履歴が見えないこと（RLS）');
  // RLS検証用の別ユーザーも社内メールドメインで作る。
  // ドメイン外だとMiddlewareに403で弾かれ、RLSの検証にならない
  const otherEmail = `rls-check-${randomUUID()}@${requireAllowedDomain()}`;
  const otherPassword = `Verify-${randomUUID()}`;

  const { data: otherUser, error: createError } = await admin.auth.admin.createUser({
    email: otherEmail,
    password: otherPassword,
    email_confirm: true,
  });

  if (createError || !otherUser.user) {
    throw new Error(`検証用ユーザーの作成に失敗しました: ${createError?.message ?? '不明'}`);
  }

  try {
    const otherCookie = await signInAndBuildCookie(otherEmail, otherPassword);
    const otherListed = await callApi('GET', '/api/histories', { cookie: otherCookie });
    const otherRows = asArray<HistoryRow>(otherListed.json);

    check('別ユーザーでも200が返る', otherListed.status === 200, `status=${otherListed.status}`);
    check(
      '別ユーザーには本人の履歴が見えない',
      !otherRows.some((item) => item.question === marker),
      `取得件数 ${otherRows.length}件`
    );
  } finally {
    // 検証用に作ったユーザーは必ず消す（認証情報を残さない）
    await admin.auth.admin.deleteUser(otherUser.user.id);
    console.log('  （検証用ユーザーを削除しました）');
  }

  // ------------------------------------------------------------
  // 4. 文書一覧のフィルター
  // ------------------------------------------------------------
  console.log('');
  console.log('【4】GET /api/documents のフィルター');
  const all = await callApi('GET', '/api/documents', { cookie });
  const allRows = asArray<DocumentRow>(all.json);
  check('フィルターなしで全件返る', Array.isArray(all.json), `${allRows.length}件`);

  const byDepartment = await callApi('GET', '/api/documents?department=人事部', { cookie });
  const departmentRows = asArray<DocumentRow>(byDepartment.json);
  check('department で絞り込める', Array.isArray(byDepartment.json), `${departmentRows.length}件`);
  check(
    'department の結果がすべて人事部を含む',
    departmentRows.length > 0 &&
      departmentRows.every((item) => (item.department ?? '').includes('人事部'))
  );
  // 「人事部・情報システム部」のような複数部署の文書も拾えること。
  // 完全一致で実装するとここが漏れる（実データで発見した不具合）
  check(
    '複数部署が設定された文書も拾える',
    departmentRows.some((item) => item.name.includes('リモートワーク')),
    departmentRows.map((item) => item.name).join(' / ')
  );

  const byKeyword = await callApi('GET', '/api/documents?keyword=規程', { cookie });
  const keywordRows = asArray<DocumentRow>(byKeyword.json);
  check('keyword で絞り込める', Array.isArray(byKeyword.json), `${keywordRows.length}件`);
  check(
    'keyword の結果がすべて文書名に「規程」を含む',
    keywordRows.length > 0 && keywordRows.every((item) => item.name.includes('規程'))
  );

  const byBoth = await callApi('GET', '/api/documents?department=人事部&keyword=規程', { cookie });
  const bothRows = asArray<DocumentRow>(byBoth.json);
  check('department と keyword のAND条件が効く', Array.isArray(byBoth.json), `${bothRows.length}件`);
  check(
    'AND条件の結果が両方の条件を満たす',
    bothRows.length > 0 &&
      bothRows.every(
        (item) => (item.department ?? '').includes('人事部') && item.name.includes('規程')
      ),
    bothRows.map((item) => item.name).join(' / ')
  );
  check('AND条件が単独条件より絞り込まれる', bothRows.length <= keywordRows.length);

  // ワイルドカードのエスケープ（% を入れても全件返らないこと）
  const byWildcard = await callApi('GET', '/api/documents?keyword=%25', { cookie });
  const wildcardRows = asArray<DocumentRow>(byWildcard.json);
  check(
    'キーワード「%」で全件ヒットしない（エスケープ確認）',
    wildcardRows.length < allRows.length,
    `${wildcardRows.length}件 / 全${allRows.length}件`
  );

  console.log('');
  console.log('='.repeat(88));
  console.log(`検証結果: OK ${passed}件 / NG ${failed}件`);

  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error('検証に失敗しました:', error instanceof Error ? error.message : error);
  process.exit(1);
});
