/**
 * 画面スクリーンショットの自動撮影（Phase DEL）
 *
 * 納品資料（README・運用手順書）へ埋め込む画面キャプチャを、
 * 実際に動いているアプリから撮影する。
 *
 * 【なぜ手作業ではなく自動撮影にするか】
 * 画面を変更するたびに13枚を撮り直すのは現実的でなく、
 * 資料の画像だけが古いまま残りやすい。コマンド1つで撮り直せる形にしておく。
 *
 * 【前提】
 *  - 開発サーバーが起動していること（npm run dev）
 *  - .env.local に TEST_USER_EMAIL / TEST_USER_PASSWORD が設定され、
 *    そのユーザーでログインできること（npm run create:test-user）
 *  - Google Chrome がインストールされていること
 *    （puppeteer-core を使うためブラウザ本体は同梱しない）
 *
 * 【重要】撮影した画像はGitへコミットされ、納品資料に載る。
 * 実在の個人情報が写らないよう、検証用ユーザーで撮影すること。
 *
 * 実行：npm run capture:screenshots
 */

import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { loadEnv, requireEnv } from './loadEnv';

loadEnv();

/** 撮影先。docs/screenshots 配下のファイル名は README から参照している */
const OUTPUT_DIR = resolve(process.cwd(), 'docs/screenshots');

/** 撮影対象のベースURL。別ポートで起動している場合は BASE_URL で上書きできる */
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

/** PC表示の画面サイズ。横1440pxは資料へ貼ったときに文字が潰れない最小限の幅 */
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };

/**
 * 縦に長い画面を撮るときの高さの上限・下限。
 *
 * 【fullPage オプションを使わない理由】
 * このアプリはサイドバー＋メイン領域がそれぞれ内部スクロールする構成のため、
 * ページ自体は縦に伸びない。fullPage を指定しても表示範囲は広がらず、
 * 一覧の下側が切れたまま撮れてしまう。
 *
 * 【切り抜き（clip）でもない理由】
 * サイドバーは画面いっぱいの高さで、下端にユーザー情報が固定されている。
 * 内容の高さで切り抜くと、サイドバーが途中で切れた不自然な絵になる。
 * そこで「メイン領域の内容が収まる高さ」へ画面自体を広げてから撮る。
 */
const MIN_PAGE_HEIGHT = 900;
const MAX_PAGE_HEIGHT = 1600;

/** スマホ表示（要件F-05：スマホは640px以下で1カラム） */
const MOBILE_VIEWPORT = { width: 375, height: 812, isMobile: true, deviceScaleFactor: 2 };

/** Chromeの実行ファイル候補。環境変数 CHROME_PATH があればそれを優先する */
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
];

/** 精度検証でも使っている、確実に回答が返る質問（06・07の撮影に使う） */
const SAMPLE_QUESTION = '在宅勤務手当はいくらですか？';

/**
 * 出典リンク（AiMessage の citationLink ボタン）を指すセレクタ。
 *
 * CSS Modules のクラス名はビルドのたびにハッシュが変わるため、完全一致では指定できない。
 * クラス名に元の識別子が残る性質を利用して部分一致で探す。
 */
const CITATION_SELECTOR = 'button[class*="citationLink"]';

/**
 * 06・07（回答つきチャット・出典モーダル）の撮影を飛ばすかどうか。
 *
 * この2枚だけがGemini APIを実際に呼ぶ。無料枠は毎分5回・1日20回のため、
 * 「文書管理の見た目だけ直したい」といった撮り直しのたびに枠を消費すると、
 * すぐ制限に達して他の画面も撮れなくなる。
 *
 * 実行例：SKIP_CHAT_ANSWER=1 npm run capture:screenshots
 */
const SKIP_CHAT_ANSWER = process.env.SKIP_CHAT_ANSWER === '1';

/**
 * 17（アップロードの処理状況）の撮影を飛ばすかどうか。
 *
 * この1枚だけは、実際にPDFを取り込まないと撮れない（段階表示は取り込み中しか出ない）。
 * 撮影用の文書を1件登録し、撮影後に必ず削除する。
 * Embedding生成のAPIを呼ぶため、不要なときは飛ばせるようにしている。
 *
 * 実行例：SKIP_UPLOAD_FLOW=1 npm run capture:screenshots
 */
const SKIP_UPLOAD_FLOW = process.env.SKIP_UPLOAD_FLOW === '1';

/** 17の撮影に使うPDF。取り込み後に削除する */
const SAMPLE_PDF_PATH = resolve(process.cwd(), 'data/test/sample-test.pdf');

/** 一覧の行にある「更新」「削除」ボタン（CSS Modulesのためクラス名は部分一致で指定する） */
const REPLACE_BUTTON_SELECTOR = 'button[class*="actionButton"]';
const DELETE_BUTTON_SELECTOR = 'button[class*="deleteButton"]';

/** 確認ダイアログ。role は実装で明示しているため安定して指定できる */
const DIALOG_SELECTOR = '[role="dialog"]';

function findChrome(): string {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate;
  }

  throw new Error(
    'Chromeが見つかりません。インストール先を環境変数 CHROME_PATH で指定してください。'
  );
}

/**
 * 画面に写る検証用ユーザーのメールアドレスを、資料用の表記へ差し替える。
 *
 * 【なぜ必要か】
 * サイドバー下部などにログイン中のメールアドレスが表示される。
 * 撮影した画像は納品資料としてそのまま配布されるため、
 * 実在しうるアドレスやクライアントの社名ドメインを載せない。
 *
 * 【何をしているか】
 * 表示中のテキストだけを差し替える（DOMのテキストノードのみ）。
 * アプリの動作・データには影響しない。撮影のたびに実行するため、
 * ページ遷移で元に戻っても次の撮影前にまた適用される。
 */
const MASKED_EMAIL = 'user@example.co.jp';

async function maskSensitiveText(page: Page, email: string) {
  await page.evaluate(
    (target: string, replacement: string) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];

      let current = walker.nextNode();
      while (current) {
        if (current.textContent && current.textContent.includes(target)) {
          nodes.push(current as Text);
        }
        current = walker.nextNode();
      }

      nodes.forEach((node) => {
        node.textContent = (node.textContent ?? '').split(target).join(replacement);
      });
    },
    email,
    MASKED_EMAIL
  );
}

/** 指定ミリ秒待つ（アニメーション・遅延読み込みの完了を待つため） */
function wait(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/**
 * 1枚撮影する。
 *
 * `fullPage` は縦に長い画面（ダッシュボード・文書管理）で使う。
 * 画面内に収まる画面で使うと余白が増えて見づらくなるため、必要な画面だけ true にする。
 */
async function shoot(page: Page, fileName: string, options: { fullPage?: boolean } = {}) {
  // 遅延読み込みの画像・フォントが出そろうのを待つ
  await wait(700);

  // 撮影の直前にマスクする。ページ遷移で元へ戻るため、毎回実行する必要がある
  await maskSensitiveText(page, process.env.TEST_USER_EMAIL ?? '');

  await page.screenshot({
    path: resolve(OUTPUT_DIR, fileName) as `${string}.png`,
    fullPage: options.fullPage ?? false,
  });

  console.log(`  撮影: ${fileName}`);
}

/**
 * メイン領域の内容が収まる高さへ画面を広げてから撮影する。
 *
 * 固定の高さを決め打ちすると、内容が少ない画面では下半分が空白になり、
 * 多い画面では下が切れる。表示されている内容から必要な高さを測って合わせる。
 */
async function shootFitted(page: Page, path: string, fileName: string) {
  await page.setViewport(DESKTOP_VIEWPORT);
  await goto(page, path);

  /*
   * 「スクロールしないと見えていない分」の高さを測る。
   *
   * main 自体ではなく、その内側のdivがスクロールしている画面があるため、
   * main の子孫のうち最も多くはみ出している要素を探す。
   * 画面の高さをこのはみ出し分だけ広げれば、内側スクロールが消えて全体が写る。
   */
  const hiddenHeight = await page.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) return 0;

    const candidates = [main, ...Array.from(main.querySelectorAll('*'))];

    return candidates.reduce((max, element) => {
      const overflow = element.scrollHeight - element.clientHeight;
      return overflow > max ? overflow : max;
    }, 0);
  });

  const height = Math.min(
    MAX_PAGE_HEIGHT,
    Math.max(MIN_PAGE_HEIGHT, DESKTOP_VIEWPORT.height + Math.ceil(hiddenHeight))
  );
  await page.setViewport({ width: DESKTOP_VIEWPORT.width, height });

  // 高さを変えると再レイアウト・再取得が走る画面があるため、落ち着くまで待つ
  await wait(600);
  await shoot(page, fileName);
}

/** 指定URLを開いて、ネットワークが落ち着くまで待つ */
async function goto(page: Page, path: string) {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle0', timeout: 60_000 });
}

/**
 * ログインする。
 *
 * 画面のフォームを実際に操作する（APIを直接叩かない）。
 * ログイン画面が壊れていれば撮影も失敗するため、動作確認を兼ねられる。
 */
async function login(page: Page) {
  const email = requireEnv('TEST_USER_EMAIL');
  const password = requireEnv('TEST_USER_PASSWORD');

  await goto(page, '/login');

  await page.type('input[type="email"]', email);
  await page.type('input[type="password"]', password);

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60_000 }),
    page.click('button[type="submit"]'),
  ]);

  if (page.url().includes('/login')) {
    throw new Error(
      'ログインに失敗しました。TEST_USER_EMAIL / TEST_USER_PASSWORD を確認し、' +
        '`npm run create:test-user` を実行してから再度お試しください。'
    );
  }

  console.log('  ログイン成功');
}

/** 現在登録されている文書IDの一覧を取得する（撮影用文書の後始末に使う） */
async function fetchDocumentIds(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const response = await fetch('/api/documents', { cache: 'no-store' });
    if (!response.ok) return [] as string[];
    const documents = (await response.json()) as { id: string }[];
    return documents.map((document) => document.id);
  });
}

/**
 * 資料更新の操作フロー（14〜17）を撮影する。
 *
 * 運用手順書で「どのボタンを押すと何が起きるか」を示すための画像。
 * 文章だけでは、更新と削除のどちらを押せばよいか担当者が迷うため。
 */
async function captureUpdateFlow(page: Page) {
  await page.setViewport(DESKTOP_VIEWPORT);
  await goto(page, '/documents');

  // ------------------------------------------------------------
  // 14. 一覧の行（更新・削除ボタンの位置を示す）
  //     画面全体ではなく一覧部分だけを切り出す。全体だと押す場所が伝わりにくい
  // ------------------------------------------------------------
  const table = await page.$('[role="table"]');
  if (table) {
    await wait(400);
    await table.screenshot({
      path: resolve(OUTPUT_DIR, '14-documents-actions.png') as `${string}.png`,
    });
    console.log('  撮影: 14-documents-actions.png');
  }

  // ------------------------------------------------------------
  // 15. 更新の確認ダイアログ
  // ------------------------------------------------------------
  await page.click(REPLACE_BUTTON_SELECTOR);
  await page.waitForSelector(DIALOG_SELECTOR, { timeout: 10_000 });
  await shoot(page, '15-update-dialog.png');

  // ファイル選択ダイアログが開かないよう、キャンセルで閉じる
  await page.keyboard.press('Escape');
  await wait(400);

  // ------------------------------------------------------------
  // 16. 削除の確認ダイアログ（取り消せない操作であることを示す）
  // ------------------------------------------------------------
  await page.click(DELETE_BUTTON_SELECTOR);
  await page.waitForSelector(DIALOG_SELECTOR, { timeout: 10_000 });
  await shoot(page, '16-delete-dialog.png');

  await page.keyboard.press('Escape');
  await wait(400);

  // ------------------------------------------------------------
  // 17. アップロードの処理状況（段階表示）
  //
  //     段階表示は取り込み中にしか出ないため、実際に1件取り込んで撮る。
  //     撮影用の文書は最後に必ず削除する（一覧に残すと納品データが汚れる）
  // ------------------------------------------------------------
  if (SKIP_UPLOAD_FLOW) {
    console.log('  17はスキップします（SKIP_UPLOAD_FLOW=1）');
    return;
  }

  if (!existsSync(SAMPLE_PDF_PATH)) {
    console.log(`  17はスキップします（${SAMPLE_PDF_PATH} が見つかりません）`);
    console.log('  `npm run generate:test-pdf` で作成できます');
    return;
  }

  const idsBefore = await fetchDocumentIds(page);

  const fileInput = await page.$('input[aria-label="PDFファイルを選択"]');
  if (!fileInput) {
    console.log('  17はスキップします（アップロード用の入力が見つかりません）');
    return;
  }

  try {
    await fileInput.uploadFile(SAMPLE_PDF_PATH);

    // 「テキスト抽出中」「検索用データを作成中」が出ている間に撮る
    await wait(1800);
    await shoot(page, '17-upload-progress.png');
  } finally {
    // ------------------------------------------------------------
    // 後始末：撮影のために登録した文書を必ず削除する
    //
    // 取り込みが終わる前に消すと、裏で動いている索引作成が
    // 存在しない文書を更新しようとしてログにエラーが出る。
    // 完了を待ってから消す
    // ------------------------------------------------------------
    console.log('  撮影用に登録した文書を削除しています...');
    await wait(15_000);

    const idsAfter = await fetchDocumentIds(page);
    const created = idsAfter.filter((id) => !idsBefore.includes(id));

    for (const id of created) {
      await page.evaluate(async (documentId: string) => {
        await fetch(`/api/documents?id=${documentId}`, { method: 'DELETE' });
      }, id);
    }

    console.log(`  削除しました（${created.length}件）`);
  }
}

async function captureAll(browser: Browser) {
  // ------------------------------------------------------------
  // 1. 未ログインで撮る画面
  //
  //    ランディング（/）はログイン済みだと /dashboard へ自動遷移するため、
  //    セッションを持たない別コンテキストで撮影する
  // ------------------------------------------------------------
  console.log('\n[1/3] 未ログインの画面');
  const guestContext = await browser.createBrowserContext();
  const guest = await guestContext.newPage();
  await guest.setViewport(DESKTOP_VIEWPORT);

  await goto(guest, '/');
  // ランディングのチャットデモは自動再生される。
  // 「...」の入力中表示のまま撮れてしまわないよう、回答が出るまで待つ
  await wait(4000);
  await shoot(guest, '01-landing.png');

  await goto(guest, '/login');
  await shoot(guest, '02-login.png');

  await goto(guest, '/register');
  await shoot(guest, '03-register.png');

  // APIキーを入力する「前」の状態を撮る（キーを画像へ写さない）
  await goto(guest, '/demo');
  await shoot(guest, '12-demo.png');

  await guestContext.close();

  // ------------------------------------------------------------
  // 2. ログイン後の画面
  // ------------------------------------------------------------
  console.log('\n[2/3] ログイン後の画面');
  const userContext = await browser.createBrowserContext();
  const page = await userContext.newPage();
  await page.setViewport(DESKTOP_VIEWPORT);

  await login(page);

  await shootFitted(page, '/dashboard', '04-dashboard.png');

  // チャットは通常の画面サイズで撮る（縦に伸ばすと空白ばかりの絵になる）
  await page.setViewport(DESKTOP_VIEWPORT);

  // 質問前の初期状態（質問例が見える）
  await goto(page, '/chat?new=1');
  await shoot(page, '05-chat.png');

  // ------------------------------------------------------------
  // 回答つきのチャット画面（06）と出典モーダル（07）
  //
  // Gemini無料枠は毎分5回・1日20回のため、質問は1回だけにする。
  // 撮り直すときも連続実行しないこと
  // ------------------------------------------------------------
  if (SKIP_CHAT_ANSWER) {
    console.log('  06・07はスキップします（SKIP_CHAT_ANSWER=1）');
  } else {
    // aria-label は実装側で明示している値のため、CSS変更の影響を受けない
    await page.type('textarea[aria-label="質問を入力"]', SAMPLE_QUESTION);
    await page.keyboard.press('Enter');

    // 回答生成は数秒かかる。出典リンクが現れるまで待つ
    console.log('  回答生成を待機中（Gemini APIの応答待ち）...');
    try {
      // CSS Modules のクラス名は `Message_citationLink__ハッシュ` になるため部分一致で探す
      await page.waitForSelector(CITATION_SELECTOR, { timeout: 90_000 });
    } catch {
      throw new Error(
        '回答が返りませんでした。Gemini APIの利用制限（毎分5回・1日20回）に達している可能性があります。' +
          '1分ほど待ってから、もう一度実行してください。' +
          '他の画面だけ撮り直したい場合は SKIP_CHAT_ANSWER=1 を付けて実行してください。'
      );
    }

    await shoot(page, '06-chat-answer.png');

    // 出典をクリックしてモーダルを開く
    await page.click(CITATION_SELECTOR);
    await wait(500);
    await shoot(page, '07-citation-modal.png');

    // モーダルを閉じてから次の画面へ進む
    await page.keyboard.press('Escape');
    await wait(300);
  }

  await shootFitted(page, '/documents', '08-documents.png');

  // 資料更新の操作フロー（14〜17）
  await captureUpdateFlow(page);

  await shootFitted(page, '/search', '09-search.png');
  await shootFitted(page, '/histories', '10-histories.png');
  await shootFitted(page, '/settings', '11-settings.png');

  // ------------------------------------------------------------
  // 3. スマホ表示
  // ------------------------------------------------------------
  console.log('\n[3/3] スマホ表示');
  await page.setViewport(MOBILE_VIEWPORT);
  await goto(page, '/chat');
  await shoot(page, '13-mobile-chat.png');

  await userContext.close();
}

async function main() {
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  const executablePath = findChrome();
  console.log(`撮影先URL : ${BASE_URL}`);
  console.log(`使用ブラウザ: ${executablePath}`);

  // サーバーが起動しているかを先に確かめる。
  // 起動していない場合、Puppeteerのタイムアウトまで待たされて原因が分かりにくい
  try {
    const response = await fetch(BASE_URL, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    throw new Error(
      `${BASE_URL} へ接続できません。別のターミナルで \`npm run dev\` を起動してから実行してください。`,
      { cause: error }
    );
  }

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    // 日本語フォントの描画を安定させる
    args: ['--font-render-hinting=none', '--disable-lcd-text'],
  });

  try {
    await captureAll(browser);
  } finally {
    await browser.close();
  }

  console.log(`\n撮影が完了しました。保存先: ${OUTPUT_DIR}`);
  console.log('画像に実在の個人情報が写っていないか、目視で確認してからコミットしてください。');
}

main().catch((error) => {
  console.error('\n撮影に失敗しました:', error instanceof Error ? error.message : error);
  process.exit(1);
});
