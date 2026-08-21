import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { checkEmailDomain } from '@/lib/auth/emailDomain';

/**
 * 認証Middleware（要件F-06）
 *
 * 目的は3つ。
 *  1. Supabase Authのセッションを更新し、Cookieを最新に保つ
 *     （これを行わないとリロードのたびにログアウト扱いになる）
 *  2. 未ログインのアクセスを拒否する
 *     - API（/api/*）        … 401 をJSONで返す（UIがエラー表示できる形にする）
 *     - 画面（それ以外）     … ログイン画面へリダイレクトする
 *  3. **社内メールドメイン以外のセッションを拒否する**
 *     - API（/api/*）        … 403 をJSONで返す
 *     - 画面（それ以外）     … ログイン画面へ戻し、理由を表示する
 *
 * これを外すと、ログインしていない相手が社内文書を検索できてしまう。
 * クライアントの最重要要件「社外への情報漏洩を絶対に避ける」に直結する。
 *
 * 【ドメイン制限をここに置く理由】
 * anonキーは NEXT_PUBLIC_ で公開されるため、ログイン画面を使わずに
 * Supabaseの認証エンドポイントを直接叩けばセッションを取得できる。
 * つまり「ログイン前のドメインチェック」だけでは迂回されてしまう。
 * Middlewareは毎リクエスト、Supabaseが検証済みのメールアドレスを見て判定するため、
 * どの経路でセッションを取得しても社内文書へは到達できない。
 */

/** ログイン画面のパス */
const LOGIN_PATH = '/login';

/** アカウント登録画面のパス */
const REGISTER_PATH = '/register';

/**
 * 未ログインでもアクセスできるパス。
 *
 * - ログイン画面・認証コールバック … 塞ぐとログインできなくなるため
 * - `/register`（アカウント登録）  … 未ログインの人が自分で登録するための画面のため
 * - `/api/auth` 配下              … ログインAPI・登録APIは未ログインで呼べる必要があるため
 *                                   （`/api/auth/login`・`/api/auth/register` はこの前方一致で公開される）
 * - `/`（ランディングページ）      … 未ログインの訪問者が最初に見る公開ページ
 * - `/demo` 配下（BYOKデモ）        … 認証なしで試せることがデモの目的
 *
 * 【重要】ここへ追加するパスには**社内文書を表示してはいけない**。
 * デモが扱うのは公開してよいサンプル文書のみで、実データはSupabase側にあり
 * RLSと認証で保護されている。追加時は必ず「未ログインの相手に見せてよいか」を確認すること。
 *
 * 【重要】`/api/auth` 配下へ新しいエンドポイントを追加するときは、
 * 未ログインで呼ばれても安全かを必ず確認すること（この配列で丸ごと公開扱いになる）。
 * ドメイン制限も適用されないため、社内データを返す処理を置いてはいけない。
 *
 * なお `/demo/chat` はGemini APIをブラウザから直接呼ぶため、
 * このサーバーのAPIも環境変数の GEMINI_API_KEY も使わない。
 */
const PUBLIC_PATHS = [LOGIN_PATH, REGISTER_PATH, '/auth/callback', '/auth/confirm', '/api/auth', '/demo'];

/** ランディングページ（完全一致のみ公開。配下は保護対象のまま） */
const LANDING_PATH = '/';

/** ログイン済みの利用者を送る初期画面（lib/auth/redirect.ts の DEFAULT_REDIRECT_PATH と一致させること） */
const DASHBOARD_PATH = '/dashboard';

/** 未ログイン時にAPIが返すメッセージ（UIでそのまま表示できる文言にする） */
const UNAUTHORIZED_MESSAGE = 'ログインが必要です。ログインしてから再度お試しください。';

/**
 * ドメイン不一致で画面を弾いたときにログイン画面へ渡す印。
 * ログイン画面はこの値を見て理由を表示し、残っているセッションを破棄する。
 */
const DOMAIN_ERROR_PARAM = 'error';
const DOMAIN_ERROR_VALUE = 'domain';

/** 公開パスかどうかを判定する */
function isPublicPath(pathname: string): boolean {
  // ランディングは完全一致のみ。`/` で startsWith 判定すると全パスが公開になってしまう
  if (pathname === LANDING_PATH) return true;

  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export async function middleware(request: NextRequest) {
  // Supabaseが更新したCookieを載せるためのレスポンス。
  // 認証済みの場合はこのレスポンスをそのまま返す
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // 環境変数が無い状態で素通しすると、認証されないまま画面が開いてしまう。
  // 設定漏れは通さずに落とす
  if (!url || !anonKey) {
    console.error('[middleware] Supabaseの環境変数が設定されていません。.env.local を確認してください。');
    return NextResponse.json({ error: UNAUTHORIZED_MESSAGE }, { status: 401 });
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // 【重要】getSession() ではなく getUser() を使う。
  // getSession() はCookieの中身をそのまま信用するため、改ざんされたCookieを検知できない。
  // getUser() はSupabaseへ問い合わせてトークンを検証する
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // 公開パスはここで確定させる。
  // ログイン画面をドメイン制限の対象にすると、弾かれた利用者がログイン画面にも
  // 入れずリダイレクトが無限ループするため、判定は必ず認証チェックより先に行う
  if (isPublicPath(pathname)) {
    /*
     * ログイン済みの利用者がランディングを開いたらダッシュボードへ送る。
     *
     * ランディングは未ログインの訪問者へ「デモ／ログイン」を案内する画面で、
     * すでにログインしている人には用がない。毎回「ログイン」を押させないための遷移。
     *
     * ドメイン確認を通った場合だけ送ること。
     * 社外ドメインのセッションをダッシュボードへ送ると、
     * その先で弾かれてログイン画面へ戻され、行き来しているように見えてしまう。
     */
    if (pathname === LANDING_PATH && user && checkEmailDomain(user.email).allowed) {
      const dashboardUrl = request.nextUrl.clone();
      dashboardUrl.pathname = DASHBOARD_PATH;
      dashboardUrl.search = '';

      return NextResponse.redirect(dashboardUrl);
    }

    return response;
  }

  if (!user) {
    // APIはリダイレクトすると呼び出し側でHTMLが返り原因が分からなくなるため、401をJSONで返す
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: UNAUTHORIZED_MESSAGE }, { status: 401 });
    }

    // 画面はログイン画面へ送る。ログイン後に元の画面へ戻れるよう遷移元を渡す
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = LOGIN_PATH;
    loginUrl.search = '';
    loginUrl.searchParams.set('redirectTo', pathname);

    return NextResponse.redirect(loginUrl);
  }

  // ------------------------------------------------------------
  // 社内メールドメインの検査
  //
  // ここが実効的な防御線。ログイン画面を経由せずSupabaseから直接
  // セッションを取得された場合でも、このチェックで社内文書へ到達できない。
  // ALLOWED_EMAIL_DOMAIN 未設定時も拒否する（設定漏れで素通りさせない）
  // ------------------------------------------------------------
  const domainCheck = checkEmailDomain(user.email);

  if (!domainCheck.allowed) {
    if (pathname.startsWith('/api/')) {
      // 401（未ログイン）ではなく403（ログイン済みだが権限が無い）を返す。
      // UI側が「再ログインを促す」のか「利用不可を伝える」のかを判断できる
      return NextResponse.json({ error: domainCheck.message }, { status: 403 });
    }

    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = LOGIN_PATH;
    loginUrl.search = '';
    loginUrl.searchParams.set(DOMAIN_ERROR_PARAM, DOMAIN_ERROR_VALUE);

    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * 静的ファイル・画像最適化・favicon以外のすべてに適用する。
     * 静的ファイルまで通すとMiddlewareが無駄に動き、表示が遅くなる
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
