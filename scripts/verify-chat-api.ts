/**
 * POST /api/chat のHTTPレベル動作確認（TB-09・TB-10・TB-11）
 *
 * 実際に起動中の開発サーバーへリクエストし、requirements.md セクション7の
 * API仕様どおりのレスポンスが返ることを確認する。
 *  - 未ログイン → 401（TB-11・F-06）
 *  - 質問が空   → 400（原因が分かるメッセージ）
 *  - 記載あり   → answer ＋ citations ＋ has_answer:true（TB-09）
 *  - 記載なし   → 定型文 ＋ citations:[] ＋ has_answer:false（TB-10）
 *
 * 検証用ユーザーは `.env.local` の TEST_USER_EMAIL / TEST_USER_PASSWORD を使う
 * （未設定の場合はその場で作成し、終了時に必ず削除する）。
 *
 * 事前に開発サーバーを起動しておくこと：npm run dev -- -p 3002
 * 実行：npm run verify:chat-api
 */

import { randomUUID } from 'node:crypto';
import { createServerClient } from '@supabase/ssr';
import { loadEnv } from './loadEnv';
import { requireAllowedDomain } from './testEmailDomain';
import { createSupabaseAdminClient } from '../src/lib/supabase/admin';

loadEnv();

/** 検証対象の開発サーバー */
const BASE_URL = process.env.VERIFY_BASE_URL ?? 'http://localhost:3002';

/**
 * 検証用ユーザー。`.env.local` に設定があればそれを使う（Q-27で作成したユーザー）。
 * 未設定の場合は一時ユーザーを作成し、実行後に削除する。
 */
// 【重要】社内メールドメイン（ALLOWED_EMAIL_DOMAIN）以外のアドレスは
// Middlewareが403で弾くため、フォールバック側も許可ドメインで組み立てる（TS-06）
const TEST_EMAIL = process.env.TEST_USER_EMAIL ?? `rag-api-verify@${requireAllowedDomain()}`;
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD;

/** APIレスポンスの型（requirements.md セクション7） */
type ChatResponse = {
  answer?: string;
  citations?: { document_name: string; page: string | null; section: string | null; document_id: string }[];
  has_answer?: boolean;
  error?: string;
};

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

/** /api/chat へリクエストする */
async function postChat(
  body: unknown,
  cookieHeader?: string
): Promise<{ status: number; json: ChatResponse }> {
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    body: JSON.stringify(body),
  });

  const json = (await response.json().catch(() => ({}))) as ChatResponse;
  return { status: response.status, json };
}

/**
 * 検証用ユーザーでログインし、ブラウザが持つのと同じ形のCookieを組み立てる。
 * Cookieの分割・エンコードは @supabase/ssr に任せる（自前で作ると形式ズレで動かない）。
 */
async function signInAndBuildCookie(password: string): Promise<string> {
  const jar: Record<string, string> = {};

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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

  const { error } = await supabase.auth.signInWithPassword({ email: TEST_EMAIL, password });
  if (error) throw new Error(`検証用ユーザーのログインに失敗しました: ${error.message}`);

  return Object.entries(jar)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
}

async function main() {
  const admin = createSupabaseAdminClient();

  // 開発サーバーが起動しているか先に確認する（起動忘れの切り分けを早くするため）
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
  // TB-11：未ログインのアクセスを拒否できること
  // ------------------------------------------------------------
  console.log('');
  console.log('【TB-11】未認証アクセス');
  const unauthorized = await postChat({ question: '在宅勤務手当はいくらですか？' });
  check('未ログインで401が返る', unauthorized.status === 401, `status=${unauthorized.status}`);
  check(
    'エラーメッセージが返る',
    typeof unauthorized.json.error === 'string' && unauthorized.json.error.length > 0,
    unauthorized.json.error ?? ''
  );
  check(
    '未ログインへ回答・出典を返していない',
    unauthorized.json.answer === undefined && unauthorized.json.citations === undefined
  );

  // ------------------------------------------------------------
  // 検証用ユーザーでログインする
  // .env.local に設定済みならそのユーザーを使い、削除はしない
  // ------------------------------------------------------------
  const password = TEST_PASSWORD ?? `Verify-${randomUUID()}`;
  /** このスクリプトが作成した一時ユーザーのID（実行後に削除する対象） */
  let temporaryUserId: string | null = null;

  if (!TEST_PASSWORD) {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: TEST_EMAIL,
      password,
      email_confirm: true,
    });

    if (createError || !created.user) {
      throw new Error(
        `検証用ユーザーの作成に失敗しました: ${createError?.message ?? '不明なエラー'}`
      );
    }

    temporaryUserId = created.user.id;
  }

  console.log(`検証用ユーザー: ${TEST_EMAIL}${temporaryUserId ? '（一時作成）' : '（.env.local の設定を使用）'}`);

  try {
    const cookieHeader = await signInAndBuildCookie(password);

    // ------------------------------------------------------------
    // TB-09：リクエスト検証
    // ------------------------------------------------------------
    console.log('');
    console.log('【TB-09】リクエストの検証');
    const emptyQuestion = await postChat({ question: '   ' }, cookieHeader);
    check('空の質問で400が返る', emptyQuestion.status === 400, `status=${emptyQuestion.status}`);
    check('原因が分かるメッセージが返る', emptyQuestion.json.error === '質問を入力してください。', emptyQuestion.json.error ?? '');

    // ------------------------------------------------------------
    // TB-09：文書に記載がある質問
    // ------------------------------------------------------------
    console.log('');
    console.log('【TB-09】文書に記載がある質問');
    const answered = await postChat({ question: '在宅勤務手当はいくらですか？' }, cookieHeader);
    check('200が返る', answered.status === 200, `status=${answered.status}`);
    check('has_answer が true', answered.json.has_answer === true);
    check('回答本文が返る', typeof answered.json.answer === 'string' && answered.json.answer.length > 0);
    check('出典が1件以上返る', (answered.json.citations?.length ?? 0) > 0, `${answered.json.citations?.length ?? 0}件`);
    check(
      '出典に文書名とdocument_idが含まれる',
      (answered.json.citations ?? []).every(
        (citation) => Boolean(citation.document_name) && Boolean(citation.document_id)
      )
    );
    console.log(`       A. ${answered.json.answer}`);
    for (const citation of answered.json.citations ?? []) {
      console.log(`          - ${citation.document_name}（${citation.page ?? 'ページ不明'} / ${citation.section ?? '見出しなし'}）`);
    }

    // ------------------------------------------------------------
    // TB-10：文書に記載がない質問
    // ------------------------------------------------------------
    console.log('');
    console.log('【TB-10】文書に記載がない質問');
    const noAnswer = await postChat({ question: '社長の名前は何ですか？' }, cookieHeader);
    check('200が返る', noAnswer.status === 200, `status=${noAnswer.status}`);
    check('has_answer が false', noAnswer.json.has_answer === false);
    check('citations が空配列', Array.isArray(noAnswer.json.citations) && noAnswer.json.citations.length === 0);
    check(
      '定型文が返る',
      noAnswer.json.answer === '該当する情報を社内文書から確認できませんでした。',
      noAnswer.json.answer ?? ''
    );
  } finally {
    // このスクリプトが作成した一時ユーザーだけを削除する（認証情報を残さない）。
    // .env.local で管理しているユーザーは他の検証でも使うため残す
    if (temporaryUserId) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(temporaryUserId);
      console.log('');
      console.log(
        deleteError ? `一時ユーザーの削除に失敗: ${deleteError.message}` : '一時ユーザーを削除しました。'
      );
    }
  }

  console.log('='.repeat(88));
  console.log(`検証結果: OK ${passed}件 / NG ${failed}件`);

  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error('検証に失敗しました:', error instanceof Error ? error.message : error);
  process.exit(1);
});
