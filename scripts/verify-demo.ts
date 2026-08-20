/**
 * BYOKデモモードの動作確認（feature/demo）
 *
 * 確認する内容：
 *  - `/`（ランディング）・`/demo`・`/demo/chat` が未ログインで開けること
 *  - 既存の保護画面・APIが**引き続き保護されていること**（デモ追加で穴を開けていないか）
 *  - デモの回答生成が、渡したAPIキーだけで動くこと（サーバーのGEMINI_API_KEYを使わない）
 *  - 文書外の質問に「該当する情報を社内文書から確認できませんでした。」を返すこと
 *  - モデルが作り出した文書名を出典に出さないこと
 *
 * 【Gemini APIキーについて】
 * デモの回答生成を実際に試す場合のみ、`.env.local` の GEMINI_API_KEY を
 * 「利用者が入力したキー」に見立てて使う（実行1回につき無料枠を消費する・Q-35）。
 * `SKIP_DEMO_ANSWER=1` を付けると回答生成をスキップし、枠を消費しない。
 *
 * 事前に開発サーバーを起動しておくこと：npm run dev -- -p 3002
 * 実行：npm run verify:demo
 */

import { loadEnv, requireEnv } from './loadEnv';
import { DEMO_DOCUMENTS } from '../src/lib/demo/documents';
import { PREVIEW_CONVERSATIONS } from '../src/lib/demo/previewConversations';

loadEnv();

const BASE_URL = process.env.VERIFY_BASE_URL ?? 'http://localhost:3002';
const SKIP_ANSWER = process.env.SKIP_DEMO_ANSWER === '1';

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

async function main() {
  try {
    await fetch(BASE_URL, { method: 'HEAD' });
  } catch {
    throw new Error(
      `開発サーバーへ接続できません（${BASE_URL}）。別ターミナルで npm run dev -- -p 3002 を実行してください。`
    );
  }

  console.log(`検証対象: ${BASE_URL}`);
  console.log('='.repeat(92));

  // ------------------------------------------------------------
  // 1. 公開ページ（未ログインで開けること）
  // ------------------------------------------------------------
  console.log('');
  console.log('【1】公開ページ（未ログインでアクセス）');

  const landing = await fetch(`${BASE_URL}/`, { redirect: 'manual' });
  const landingHtml = await landing.text();
  check('/ が未ログインで開ける', landing.status === 200, `status=${landing.status}`);
  check('システム名が表示される', landingHtml.includes('社内文書検索AI'));
  check('「ログインして使う」ボタンがある', landingHtml.includes('ログインして使う'));
  check('「デモとして試す」ボタンがある', landingHtml.includes('デモとして試す'));
  check('/login への導線がある', landingHtml.includes('href="/login"'));
  check('/demo への導線がある', landingHtml.includes('href="/demo"'));

  // ランディングの構成要素
  check('ナビに「機能」がある', landingHtml.includes('#features'));
  check('機能セクション（id="features"）がある', landingHtml.includes('id="features"'));
  check('CTAセクションがある', landingHtml.includes('まず、試してみてください'));
  check('技術スタックが表示される', landingHtml.includes('pgvector'));

  // ポートフォリオとして公開するため、架空の社名を前面に出さない
  // （実在の受託案件と誤解されるのを避ける。社名はデモ文書内のサンプルに留める）
  check('架空の社名がランディングに出ていない', !landingHtml.includes('テックブリッジ'));

  // 掲載する実績値は測定済みのものだけにする
  check('回答精度90%が表示される', landingHtml.includes('90%'));
  check('平均回答時間が実測値（2.0s）である', landingHtml.includes('2.0s'));
  check(
    '測定条件が併記されている',
    landingHtml.includes('評価データ12問') && landingHtml.includes('実測平均')
  );

  const demoKey = await fetch(`${BASE_URL}/demo`, { redirect: 'manual' });
  const demoKeyHtml = await demoKey.text();
  check('/demo が未ログインで開ける', demoKey.status === 200, `status=${demoKey.status}`);
  check(
    'キーがサーバーへ送信されない旨の説明がある',
    demoKeyHtml.includes('サーバーには送信されません')
  );
  check(
    'Google AI Studio のリンクがある',
    demoKeyHtml.includes('aistudio.google.com/app/apikey')
  );

  const demoChat = await fetch(`${BASE_URL}/demo/chat`, { redirect: 'manual' });
  check('/demo/chat が未ログインで開ける', demoChat.status === 200, `status=${demoChat.status}`);

  // ------------------------------------------------------------
  // 2. 既存の保護が外れていないこと（最重要）
  // ------------------------------------------------------------
  console.log('');
  console.log('【2】既存の保護（デモ追加で穴を開けていないか）');

  // 2026-08-18のサイドバー構成変更で追加した画面も含める。
  // 画面を追加したときにここへ足し忘れると、保護漏れに気づけない
  const protectedPaths = [
    '/chat',
    '/dashboard',
    '/documents',
    '/search',
    '/histories',
    '/settings',
  ];
  for (const path of protectedPaths) {
    const response = await fetch(`${BASE_URL}${path}`, { redirect: 'manual' });
    const location = response.headers.get('location') ?? '';
    check(
      `${path} は未ログインでログイン画面へ送られる`,
      response.status === 307 && location.includes('/login'),
      `status=${response.status}`
    );
  }

  const protectedApis: [string, string][] = [
    ['POST', '/api/chat'],
    ['GET', '/api/documents'],
    // 文書の削除は取り消せない操作なので、未ログインで呼べないことを必ず確認する
    ['DELETE', '/api/documents'],
    ['GET', '/api/histories'],
    ['GET', '/api/settings'],
  ];
  for (const [method, path] of protectedApis) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body: JSON.stringify({ question: 'テスト' }) } : {}),
    });
    check(`${method} ${path} が401`, response.status === 401, `status=${response.status}`);
  }

  // ------------------------------------------------------------
  // 3. デモ文書に実文書が混ざっていないこと
  // ------------------------------------------------------------
  console.log('');
  console.log('【3】デモ文書（クライアントに埋め込まれる内容）');
  check('5文書が収録されている', DEMO_DOCUMENTS.length === 5, `${DEMO_DOCUMENTS.length}件`);
  check(
    'すべてサンプル文書である旨が明記されている',
    DEMO_DOCUMENTS.every((document) => document.content.includes('実在の規程ではありません')),
    DEMO_DOCUMENTS.filter((d) => !d.content.includes('実在の規程ではありません'))
      .map((d) => d.name)
      .join(' / ') || 'すべて明記あり'
  );

  // ------------------------------------------------------------
  // 3-2. ランディングの回答例が収録文書と食い違わないこと
  //
  // ここが食い違うと、訪問者がデモで同じ質問をしたときに矛盾が露見する。
  // 文言を変更したらこの検証で必ず気づけるようにしている。
  // ------------------------------------------------------------
  console.log('');
  console.log('【3-2】ランディングの回答例と収録文書の整合');

  for (const conversation of PREVIEW_CONVERSATIONS) {
    // 出典に挙げた文書が実在すること
    const missingDocuments = conversation.sourceDocuments.filter(
      (name) => !DEMO_DOCUMENTS.some((document) => document.name === name)
    );
    check(
      `「${conversation.user}」の根拠文書が実在する`,
      missingDocuments.length === 0,
      missingDocuments.join(' / ') || conversation.sourceDocuments.join(' / ')
    );

    // 回答に書いた数値が、根拠文書にも書かれていること
    const sourceText = conversation.sourceDocuments
      .map((name) => DEMO_DOCUMENTS.find((document) => document.name === name)?.content ?? '')
      .join('\n');

    const missingFacts = conversation.facts.filter((fact) => !sourceText.includes(fact));
    check(
      `「${conversation.user}」の数値が文書の記載と一致する`,
      missingFacts.length === 0,
      missingFacts.length > 0 ? `文書に無い値: ${missingFacts.join(' / ')}` : conversation.facts.join(' / ')
    );

    // 回答本文にも同じ数値が含まれていること（データの取り違え防止）
    const missingInAnswer = conversation.facts.filter((fact) => !conversation.ai.includes(fact));
    check(
      `「${conversation.user}」の回答文に数値が含まれる`,
      missingInAnswer.length === 0,
      missingInAnswer.join(' / ') || 'OK'
    );
  }

  // ------------------------------------------------------------
  // 4. デモの回答生成（利用者のキーだけで動くこと）
  // ------------------------------------------------------------
  console.log('');
  console.log('【4】デモの回答生成');

  if (SKIP_ANSWER) {
    console.log('  -- SKIP_DEMO_ANSWER=1 のため回答生成をスキップします（無料枠を消費しない）');
  } else {
    // 動的importにするのは、@google/genai の読み込みをスキップ時に避けるため
    const { askDemo, DemoChatError } = await import('../src/lib/demo/gemini');
    const apiKey = requireEnv('GEMINI_API_KEY');

    try {
      // 文書に記載がある質問
      const answered = await askDemo('在宅勤務手当はいくらですか？', apiKey);
      check('文書内の質問に回答できる', answered.has_answer === true);
      check('金額が正しく回答される', answered.answer.replace(/,/g, '').includes('3000円'), answered.answer);
      check('出典が1件以上返る', answered.citations.length > 0, `${answered.citations.length}件`);
      check(
        '出典が収録文書のいずれかである（作り出した出典が無い）',
        answered.citations.every((citation) =>
          DEMO_DOCUMENTS.some((document) => document.name === citation.document_name)
        ),
        answered.citations.map((c) => c.document_name).join(' / ')
      );
      check(
        '出典に該当箇所テキストが入っている（出典モーダル用）',
        answered.citations.every((citation) => citation.content.length > 0)
      );
      console.log(`       A. ${answered.answer}`);

      // 文書に記載が無い質問（ハルシネーション抑制）
      const notFound = await askDemo('退職金はいくらもらえますか？', apiKey);
      check(
        '文書外の質問に定型文を返す',
        notFound.has_answer === false &&
          notFound.answer === '該当する情報を社内文書から確認できませんでした。',
        notFound.answer
      );
      check('文書外の質問で出典を表示しない', notFound.citations.length === 0);
    } catch (error) {
      const message = error instanceof DemoChatError ? error.userMessage : String(error);

      if (message.includes('利用制限')) {
        console.log(`  -- Gemini APIの利用制限に達しているため回答生成をスキップします`);
        console.log(`     メッセージ: ${message}`);
        check('利用制限時に原因と次の行動が分かる文言を返す', true);
      } else {
        check('デモの回答生成が動作する', false, message);
      }
    }

    // 不正なキーで分かりやすいエラーになること
    try {
      await askDemo('テスト', 'AIzaInvalidKeyForVerificationOnly123456');
      check('不正なAPIキーが拒否される', false, 'エラーにならなかった');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      check(
        '不正なAPIキーで次の行動が分かるエラーになる',
        message.includes('APIキー') || message.includes('利用制限'),
        message
      );
      check('エラー文にAPIキーが含まれない', !message.includes('AIzaInvalidKeyForVerificationOnly'));
    }
  }

  console.log('');
  console.log('='.repeat(92));
  console.log(`検証結果: OK ${passed}件 / NG ${failed}件`);

  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error('検証に失敗しました:', error instanceof Error ? error.message : error);
  process.exit(1);
});
