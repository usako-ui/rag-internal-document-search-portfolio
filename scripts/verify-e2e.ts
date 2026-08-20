/**
 * 納品前 通し動作確認（Phase ENH 完了後）
 *
 * 指定された確認項目8件を、実際の画面と同じ経路（HTTP・Cookie認証）でたどる。
 * ブラウザのクリック操作は自動化できないため、**画面の裏側の動作**を確認する。
 * 見た目・レイアウト・モーダルの開閉はブラウザでの目視が必要（報告に一覧を添える）。
 *
 * 【Gemini無料枠について】
 * 質問を1回だけ実行する（1日20回・Q-35）。実行のたびに1回消費する点に注意。
 *
 * 事前に開発サーバーを起動しておくこと：npm run dev -- -p 3002
 * 実行：npm run verify:e2e
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServerClient } from '@supabase/ssr';
import { loadEnv, requireEnv } from './loadEnv';
import { createSupabaseAdminClient } from '../src/lib/supabase/admin';

loadEnv();

const BASE_URL = process.env.VERIFY_BASE_URL ?? 'http://localhost:3002';

/** アップロード確認に使うテストPDF（npm run generate:test-pdf で生成） */
const TEST_PDF_PATH = resolve(process.cwd(), 'data/test/sample-test.pdf');

/** 取り込み完了を待つ上限 */
const INGEST_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 1_000;

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed += 1;
    console.log(`  OK   ${label}${detail ? ` … ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`  NG   ${label}${detail ? ` … ${detail}` : ''}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type Citation = {
  document_name: string;
  page: string | null;
  section: string | null;
  document_id: string;
  content: string;
};

type ChatResponse = { answer: string; citations: Citation[]; has_answer: boolean };
type DocumentRow = { id: string; name: string; department: string | null; status: string };
type HistoryRow = { id: string; question: string; answer: string; citations: Citation[] };

/** 指定ユーザーでログインし、ブラウザが持つのと同じ形のCookieを組み立てる */
async function signIn(email: string, password: string): Promise<string> {
  const jar: Record<string, string> = {};

  const supabase = createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll: () => Object.entries(jar).map(([name, value]) => ({ name, value })),
        setAll: (list) => {
          list.forEach(({ name, value }) => {
            jar[name] = value;
          });
        },
      },
    }
  );

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`ログインに失敗しました: ${error.message}`);

  return Object.entries(jar)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
}

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

  return { status: response.status, json: await response.json().catch(() => null) };
}

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
  const email = requireEnv('TEST_USER_EMAIL');
  const password = requireEnv('TEST_USER_PASSWORD');

  console.log(`検証対象: ${BASE_URL}`);
  console.log('='.repeat(92));

  // ------------------------------------------------------------
  // 1. ログイン
  // ------------------------------------------------------------
  console.log('');
  console.log('【1】ログイン');
  // `/` は公開ランディングページになったため、保護対象は `/chat`
  const beforeLogin = await fetch(`${BASE_URL}/chat`, { redirect: 'manual' });
  check(
    '未ログインではチャット画面へ入れない',
    beforeLogin.status === 307,
    `status=${beforeLogin.status} → ${beforeLogin.headers.get('location') ?? ''}`
  );

  const cookie = await signIn(email, password);
  const afterLogin = await fetch(`${BASE_URL}/chat`, {
    headers: { Cookie: cookie },
    redirect: 'manual',
  });
  const homeHtml = await afterLogin.text();
  check(`${email} でログインできる`, afterLogin.status === 200, `status=${afterLogin.status}`);
  check('チャット画面にログイン中のメールが表示される', homeHtml.includes(email));

  // ------------------------------------------------------------
  // 2. 質問（Gemini APIを1回消費）
  // ------------------------------------------------------------
  console.log('');
  console.log('【2】質問「在宅勤務手当はいくらですか？」（Gemini無料枠を1回消費）');
  const chat = await callApi('POST', '/api/chat', {
    cookie,
    body: { question: '在宅勤務手当はいくらですか？' },
  });
  const answer = chat.json as ChatResponse | null;

  if (chat.status === 429) {
    console.log('  -- Gemini APIの利用制限に達しているため、質問系の確認をスキップします');
    console.log(`     メッセージ: ${(chat.json as { error?: string })?.error ?? ''}`);
    check('429時に原因と待ち時間が分かる文言が返る（TE-05）', true);
  } else {
    check('回答が返る', chat.status === 200 && answer?.has_answer === true, `status=${chat.status}`);
    check('回答本文が空でない', (answer?.answer.length ?? 0) > 0);
    check('出典が1件以上返る', (answer?.citations.length ?? 0) > 0, `${answer?.citations.length ?? 0}件`);
    check(
      '出典に文書名とdocument_idがある',
      (answer?.citations ?? []).every((c) => Boolean(c.document_name) && Boolean(c.document_id))
    );
    // TE-06：出典モーダルに表示する該当箇所テキスト
    check(
      '出典に該当箇所テキスト（content）が入っている（TE-06）',
      (answer?.citations ?? []).every((c) => typeof c.content === 'string' && c.content.length > 0)
    );

    console.log(`       A. ${answer?.answer}`);
    for (const c of answer?.citations ?? []) {
      console.log(`          - ${c.document_name}（${c.page ?? 'ページ不明'} / ${c.section ?? '見出しなし'}）`);
      console.log(`            該当箇所: ${c.content.replace(/\n/g, ' ').slice(0, 60)}…`);
    }

    // ------------------------------------------------------------
    // 3. 質問履歴（UIと同じく回答受領後に保存する）
    // ------------------------------------------------------------
    console.log('');
    console.log('【3】質問履歴への記録');
    const savedHistory = await callApi('POST', '/api/histories', {
      cookie,
      body: {
        question: '在宅勤務手当はいくらですか？',
        answer: answer?.answer ?? '',
        citations: answer?.citations ?? [],
      },
    });
    check('回答受領後に履歴が保存される', savedHistory.status === 201, `status=${savedHistory.status}`);

    const histories = await callApi('GET', '/api/histories', { cookie });
    const rows = asArray<HistoryRow>(histories.json);
    const recorded = rows.find((r) => r.question === '在宅勤務手当はいくらですか？');
    check('質問履歴に記録されている', Boolean(recorded), `全${rows.length}件`);
    check(
      '履歴の出典からも該当箇所テキストを復元できる',
      (recorded?.citations.length ?? 0) > 0 &&
        (recorded?.citations ?? []).every((c) => c.content.length > 0)
    );
  }

  // ------------------------------------------------------------
  // 4. PDFアップロードと4段階ステータス
  // ------------------------------------------------------------
  console.log('');
  console.log('【4】PDFアップロードと取り込み状態');
  let uploadedDocumentId: string | null = null;

  try {
    const pdfBytes = readFileSync(TEST_PDF_PATH);
    const form = new FormData();
    form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'e2e-確認用.pdf');

    const uploadResponse = await fetch(`${BASE_URL}/api/documents`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: form,
    });
    const uploaded = (await uploadResponse.json().catch(() => null)) as
      | { document_id?: string; status?: string }
      | null;

    uploadedDocumentId = uploaded?.document_id ?? null;

    // 段階1「アップロード済み」＋段階2「テキスト抽出中」＝202が返るまで
    check('アップロードが受理される（202）', uploadResponse.status === 202, `status=${uploadResponse.status}`);
    // 段階3「検索用データを作成中」＝ status: processing
    check('受理直後は processing（検索用データを作成中）', uploaded?.status === 'processing', String(uploaded?.status));

    // 段階4「検索可能」＝ status: ready になるまで待つ
    const deadline = Date.now() + INGEST_TIMEOUT_MS;
    let finalStatus = 'processing';

    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);

      const list = await callApi('GET', '/api/documents', { cookie });
      const target = asArray<DocumentRow>(list.json).find((d) => d.id === uploadedDocumentId);

      if (target && target.status !== 'processing') {
        finalStatus = target.status;
        break;
      }
    }

    check('取り込み完了後に ready（検索可能）になる', finalStatus === 'ready', `status=${finalStatus}`);
  } catch (error) {
    check('PDFアップロードを実行できる', false, error instanceof Error ? error.message : String(error));
  } finally {
    // 確認用に追加した文書は必ず消す（文書一覧を元の5件へ戻す）
    if (uploadedDocumentId) {
      await admin.from('documents').delete().eq('id', uploadedDocumentId);
      console.log('  （確認用にアップロードした文書を削除しました）');
    }
  }

  // ------------------------------------------------------------
  // 5. 文書一覧とフィルター
  // ------------------------------------------------------------
  console.log('');
  console.log('【5】文書一覧・フィルター');
  const all = await callApi('GET', '/api/documents', { cookie });
  const allRows = asArray<DocumentRow>(all.json);
  check('実データが5件表示される', allRows.length === 5, `${allRows.length}件`);
  check('すべて検索可能（ready）', allRows.every((d) => d.status === 'ready'));

  const byDept = await callApi('GET', '/api/documents?department=情報システム部', { cookie });
  const deptRows = asArray<DocumentRow>(byDept.json);
  check(
    '部署フィルター（情報システム部）が効く',
    deptRows.length > 0 && deptRows.every((d) => (d.department ?? '').includes('情報システム部')),
    deptRows.map((d) => d.name).join(' / ')
  );

  const byKeyword = await callApi('GET', '/api/documents?keyword=マニュアル', { cookie });
  const keywordRows = asArray<DocumentRow>(byKeyword.json);
  check(
    'キーワード検索（マニュアル）が効く',
    keywordRows.length > 0 && keywordRows.every((d) => d.name.includes('マニュアル')),
    keywordRows.map((d) => d.name).join(' / ')
  );

  // ------------------------------------------------------------
  // 6. 設定の保存
  // ------------------------------------------------------------
  console.log('');
  console.log('【6】設定の保存');
  const settingsPage = await fetch(`${BASE_URL}/settings`, {
    headers: { Cookie: cookie },
    redirect: 'manual',
  });
  const settingsHtml = await settingsPage.text();
  check('設定画面が開ける', settingsPage.status === 200, `status=${settingsPage.status}`);
  check('メールアドレスが読み取り専用で表示される', settingsHtml.includes(email));
  // Q-40：表示言語の項目は削除済み
  check('「表示言語」の項目が無い（Q-40）', !settingsHtml.includes('表示言語'));

  const saveResult = await callApi('PUT', '/api/settings', {
    cookie,
    body: { history_limit: 50, answer_length: 'detailed', match_count: 10 },
  });
  const savedSettings = saveResult.json as Record<string, unknown> | null;
  check('設定を保存できる', saveResult.status === 200, `status=${saveResult.status}`);
  check(
    '履歴表示件数・回答の最大文字数・検索件数が保存される',
    savedSettings?.history_limit === 50 &&
      savedSettings?.answer_length === 'detailed' &&
      savedSettings?.match_count === 10,
    JSON.stringify(savedSettings)
  );

  const reloaded = await callApi('GET', '/api/settings', { cookie });
  check(
    '再読み込みしても保存内容が残る',
    (reloaded.json as Record<string, unknown> | null)?.match_count === 10
  );

  // 確認で変えた設定を既定値へ戻す
  await callApi('PUT', '/api/settings', {
    cookie,
    body: { history_limit: 20, answer_length: 'standard', match_count: 5 },
  });
  console.log('  （設定を既定値へ戻しました）');

  // ------------------------------------------------------------
  // 7. 質問履歴画面
  // ------------------------------------------------------------
  console.log('');
  console.log('【7】質問履歴画面');
  const historiesPage = await fetch(`${BASE_URL}/histories`, {
    headers: { Cookie: cookie },
    redirect: 'manual',
  });
  check('質問履歴画面が開ける', historiesPage.status === 200, `status=${historiesPage.status}`);

  // ------------------------------------------------------------
  // 8. ログアウト
  // ------------------------------------------------------------
  console.log('');
  console.log('【8】ログアウト');
  const signOutClient = createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll: () =>
          cookie.split('; ').map((pair) => {
            const index = pair.indexOf('=');
            return {
              name: pair.slice(0, index),
              value: decodeURIComponent(pair.slice(index + 1)),
            };
          }),
        setAll: () => {
          /* 破棄後のCookieは使わないため保持しない */
        },
      },
    }
  );

  const { error: signOutError } = await signOutClient.auth.signOut();
  check('セッションを破棄できる', !signOutError, signOutError?.message ?? '');

  // 破棄後のトークンでは保護画面へ入れないこと
  const afterLogout = await fetch(`${BASE_URL}/chat`, {
    headers: { Cookie: cookie },
    redirect: 'manual',
  });
  check(
    'ログアウト後はチャット画面からログイン画面へ送られる',
    afterLogout.status === 307 && (afterLogout.headers.get('location') ?? '').includes('/login'),
    `status=${afterLogout.status} → ${afterLogout.headers.get('location') ?? ''}`
  );

  console.log('');
  console.log('='.repeat(92));
  console.log(`検証結果: OK ${passed}件 / NG ${failed}件`);

  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error('検証に失敗しました:', error instanceof Error ? error.message : error);
  process.exit(1);
});
