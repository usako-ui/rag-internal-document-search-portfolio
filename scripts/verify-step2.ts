/**
 * 納品前改善フェーズ STEP 2（フロントエンド追加）の動作確認
 *
 * 画面のクリック操作は自動化できないため、STEP 2が依存する
 * 「画面の裏側」が正しく動くことを確認する。
 *
 *  - /histories・/settings が未ログインでログイン画面へ送られること（F-06）
 *  - GET/PUT /api/settings が本人の設定のみ読み書きできること
 *  - **他人の設定が見えない・書き換えられないこと**（RLSの実効確認）
 *  - 不正な設定値が拒否されること（閾値は設定項目に無いことも確認）
 *  - 出典に該当箇所の本文（content）が含まれること（TE-06の前提）
 *  - 履歴に保存した出典から content を復元できること（TE-07の前提）
 *
 * Gemini APIは呼ばないため、無料枠（1日20回・Q-35）を消費しない。
 *
 * 事前に開発サーバーを起動しておくこと：npm run dev -- -p 3002
 * 実行：npm run verify:step2
 */

import { randomUUID } from 'node:crypto';
import { createServerClient } from '@supabase/ssr';
import { loadEnv, requireEnv } from './loadEnv';
import { createSupabaseAdminClient } from '../src/lib/supabase/admin';
import { requireAllowedDomain } from './testEmailDomain';
import { SIMILARITY_THRESHOLD } from '../src/lib/search/searchChunks';

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

/** 設定（検証用の緩い型） */
type SettingsRow = {
  history_limit: number;
  answer_length: string;
  match_count: number;
};

/** 履歴（検証用の緩い型） */
type HistoryRow = {
  id: string;
  question: string;
  citations: { document_name: string; content?: string }[];
};

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
  // 1. 新規画面の保護（F-06）
  // ------------------------------------------------------------
  console.log('');
  console.log('【1】新規画面の未ログインアクセス');
  for (const path of ['/histories', '/settings']) {
    const response = await fetch(`${BASE_URL}${path}`, { redirect: 'manual' });
    const location = response.headers.get('location') ?? '';

    check(
      `${path} が未ログインでログイン画面へ送られる`,
      response.status === 307 && location.includes('/login'),
      `status=${response.status} location=${location}`
    );
  }

  const cookie = await signInAndBuildCookie(mainEmail, mainPassword);

  for (const path of ['/histories', '/settings']) {
    const response = await fetch(`${BASE_URL}${path}`, {
      headers: { Cookie: cookie },
      redirect: 'manual',
    });
    check(`${path} がログイン後に表示される`, response.status === 200, `status=${response.status}`);
  }

  // ------------------------------------------------------------
  // 2. 設定APIの読み書き
  // ------------------------------------------------------------
  console.log('');
  console.log('【2】設定の読み書き');
  const unauthSettings = await callApi('GET', '/api/settings');
  check('未ログインのGETが401', unauthSettings.status === 401, `status=${unauthSettings.status}`);

  const unauthPut = await callApi('PUT', '/api/settings', {
    body: { history_limit: 10, answer_length: 'short', match_count: 3 },
  });
  check('未ログインのPUTが401', unauthPut.status === 401, `status=${unauthPut.status}`);

  const initial = await callApi('GET', '/api/settings', { cookie });
  const initialSettings = initial.json as SettingsRow | null;
  check('GET /api/settings が200', initial.status === 200, `status=${initial.status}`);
  check(
    '未保存でも既定値が返る',
    initialSettings?.history_limit === 20 && initialSettings?.match_count === 5,
    JSON.stringify(initialSettings)
  );
  // Q-40：表示言語は設定項目から削除済み。レスポンスに含まれないこと
  check(
    '表示言語が設定に含まれない（Q-40）',
    initialSettings !== null && !('language' in initialSettings),
    JSON.stringify(initialSettings)
  );

  const saved = await callApi('PUT', '/api/settings', {
    cookie,
    body: { history_limit: 50, answer_length: 'detailed', match_count: 10 },
  });
  const savedSettings = saved.json as SettingsRow | null;
  check('PUT /api/settings が200', saved.status === 200, `status=${saved.status}`);
  check(
    '保存した値が返る',
    savedSettings?.history_limit === 50 &&
      savedSettings?.answer_length === 'detailed' &&
      savedSettings?.match_count === 10,
    JSON.stringify(savedSettings)
  );

  const reloaded = await callApi('GET', '/api/settings', { cookie });
  const reloadedSettings = reloaded.json as SettingsRow | null;
  check('再取得しても保存内容が残る', reloadedSettings?.match_count === 10);

  // ------------------------------------------------------------
  // 3. 不正な設定値の拒否
  // ------------------------------------------------------------
  console.log('');
  console.log('【3】不正な設定値の拒否');
  const invalidCases: { label: string; body: Record<string, unknown> }[] = [
    {
      label: '選択肢にない履歴件数',
      body: { history_limit: 999, answer_length: 'short', match_count: 3 },
    },
    {
      label: '選択肢にない回答の長さ',
      body: { history_limit: 10, answer_length: 'very-long', match_count: 3 },
    },
    {
      label: '選択肢にない検索件数',
      body: { history_limit: 10, answer_length: 'short', match_count: 100 },
    },
    {
      label: '項目の欠落',
      body: { history_limit: 10 },
    },
  ];

  for (const testCase of invalidCases) {
    const result = await callApi('PUT', '/api/settings', { cookie, body: testCase.body });
    check(`${testCase.label}が400で拒否される`, result.status === 400, `status=${result.status}`);
  }

  // Q-38：閾値は設定項目に含めない。送っても保存されないこと
  const withThreshold = await callApi('PUT', '/api/settings', {
    cookie,
    body: {
      history_limit: 20,
      answer_length: 'standard',
      match_count: 5,
      threshold: 0.55,
    },
  });
  const thresholdResult = withThreshold.json as Record<string, unknown> | null;
  check(
    '閾値を送っても設定に取り込まれない（Q-38）',
    withThreshold.status === 200 && thresholdResult !== null && !('threshold' in thresholdResult),
    JSON.stringify(thresholdResult)
  );
  check(
    `類似度閾値はコード側で${SIMILARITY_THRESHOLD}固定`,
    SIMILARITY_THRESHOLD === 0.62,
    String(SIMILARITY_THRESHOLD)
  );

  // ------------------------------------------------------------
  // 4. 他人の設定が見えない・書き換えられないこと（RLS）
  // ------------------------------------------------------------
  console.log('');
  console.log('【4】他人の設定が見えないこと（RLS）');
  // RLS検証用の別ユーザーも社内メールドメインで作る。
  // ドメイン外だとMiddlewareに403で弾かれ、RLSの検証にならない（TS-06）
  const otherEmail = `settings-rls-${randomUUID()}@${requireAllowedDomain()}`;
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
    const otherSettings = await callApi('GET', '/api/settings', { cookie: otherCookie });
    const otherRow = otherSettings.json as SettingsRow | null;

    // 本人は match_count=5 を保存済み。別ユーザーには既定値が返るべき
    check(
      '別ユーザーには本人の設定が見えない（既定値が返る）',
      otherRow?.match_count === 5 && otherRow?.history_limit === 20,
      JSON.stringify(otherRow)
    );

    // 別ユーザーが保存しても、本人の設定は変わらないこと
    await callApi('PUT', '/api/settings', {
      cookie: otherCookie,
      body: { history_limit: 10, answer_length: 'short', match_count: 3 },
    });

    const mainAfter = await callApi('GET', '/api/settings', { cookie });
    const mainAfterRow = mainAfter.json as SettingsRow | null;
    check(
      '別ユーザーの保存で本人の設定が変わらない',
      mainAfterRow?.match_count === 5 && mainAfterRow?.history_limit === 20,
      JSON.stringify(mainAfterRow)
    );
  } finally {
    await admin.auth.admin.deleteUser(otherUser.user.id);
    console.log('  （検証用ユーザーを削除しました）');
  }

  // ------------------------------------------------------------
  // 5. 出典モーダルの前提（該当箇所テキスト）
  // ------------------------------------------------------------
  console.log('');
  console.log('【5】出典の該当箇所テキスト（TE-06の前提）');

  const sampleContent = '第2章 休日・休暇\n年次有給休暇は、入社6ヶ月経過後に10日付与する。';
  const marker = `STEP2検証 ${randomUUID()}`;

  const savedHistory = await callApi('POST', '/api/histories', {
    cookie,
    body: {
      question: marker,
      answer: '入社6ヶ月経過後に10日付与されます。',
      citations: [
        {
          document_name: '就業規則(抜粋)',
          page: 'p.1',
          section: '第2章 休日・休暇',
          document_id: randomUUID(),
          content: sampleContent,
        },
      ],
    },
  });
  check('該当箇所テキスト付きで履歴を保存できる', savedHistory.status === 201, `status=${savedHistory.status}`);

  const histories = await callApi('GET', '/api/histories', { cookie });
  const savedRow = (Array.isArray(histories.json) ? (histories.json as HistoryRow[]) : []).find(
    (row) => row.question === marker
  );

  check('保存した履歴を取得できる', Boolean(savedRow));
  check(
    '履歴の出典から該当箇所テキストを復元できる',
    savedRow?.citations?.[0]?.content === sampleContent,
    savedRow?.citations?.[0]?.content?.slice(0, 30) ?? '(なし)'
  );

  // content が無い古い履歴でも壊れないこと（モーダルは案内文を出す）
  const legacy = await callApi('POST', '/api/histories', {
    cookie,
    body: {
      question: `${marker}-旧形式`,
      answer: 'テスト',
      citations: [
        {
          document_name: '就業規則(抜粋)',
          page: null,
          section: null,
          document_id: randomUUID(),
        },
      ],
    },
  });
  const legacyRow = legacy.json as HistoryRow | null;
  check(
    'content が無い出典でも保存でき、空文字で返る',
    legacy.status === 201 && legacyRow?.citations?.[0]?.content === '',
    `status=${legacy.status}`
  );

  // ------------------------------------------------------------
  // 6. 履歴表示件数の設定が反映されること
  // ------------------------------------------------------------
  console.log('');
  console.log('【6】履歴表示件数の設定が反映されること');
  await callApi('PUT', '/api/settings', {
    cookie,
    body: { history_limit: 10, answer_length: 'standard', match_count: 5 },
  });

  const limited = await callApi('GET', '/api/histories', { cookie });
  const limitedRows = Array.isArray(limited.json) ? (limited.json as HistoryRow[]) : [];
  check(
    '設定の履歴表示件数（10件）が上限として効く',
    limitedRows.length <= 10,
    `${limitedRows.length}件`
  );

  // 検証で変更した設定を既定値へ戻す（次回の検証・手動確認へ影響させない）
  await callApi('PUT', '/api/settings', {
    cookie,
    body: { history_limit: 20, answer_length: 'standard', match_count: 5 },
  });
  console.log('  （設定を既定値へ戻しました）');

  console.log('');
  console.log('='.repeat(88));
  console.log(`検証結果: OK ${passed}件 / NG ${failed}件`);

  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error('検証に失敗しました:', error instanceof Error ? error.message : error);
  process.exit(1);
});
