import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { checkEmailDomain } from '@/lib/auth/emailDomain';
import { toLoginErrorMessage, toLoginErrorStatus } from '@/lib/auth/loginErrors';

/**
 * POST /api/auth/login（要件F-06）
 *
 * ログイン処理をサーバー側で行う唯一のエンドポイント。
 * Supabaseへ認証を投げる**前に**社内メールドメインを検証し、
 * 対象外のアドレスはSupabaseへ問い合わせることなく拒否する。
 *
 * 【このエンドポイントの位置づけ】
 * ここでのドメイン検証は「社外の人にログインを試させない」ための入口であり、
 * これ単体をセキュリティ境界とはみなさない。
 * anonキーは公開値のため、このAPIを使わずSupabaseを直接叩けばセッションは取得できる。
 * その経路は Middleware（`src/middleware.ts`）が毎リクエスト検査して遮断する。
 *
 * 【なぜサーバー側で行うか】
 *  - ドメイン判定と許可ドメイン（ALLOWED_EMAIL_DOMAIN）をブラウザへ配らずに済む
 *  - 判定を書き換えた改造クライアントでも、この経路では突破できない
 *  - セッションCookieの発行をサーバー側に一本化できる
 *
 * 【Middlewareの公開パス設定に依存している】
 * 未ログインで呼べる必要があるため `/api/auth` は公開パスに含めている。
 * 同じ配下へ社内データを返すエンドポイントを追加してはいけない。
 */

// 認証結果をキャッシュしてはならない
export const dynamic = 'force-dynamic';
// Supabaseクライアント（Cookie操作）を使うためNode.jsランタイムで動かす
export const runtime = 'nodejs';

/** レスポンスをキャッシュさせないための共通ヘッダー */
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

/** 入力不足時のメッセージ */
const MISSING_INPUT_MESSAGE = 'メールアドレスとパスワードを入力してください。';

/** 想定外の例外で返す共通メッセージ（内部情報をクライアントへ出さない） */
const GENERIC_ERROR_MESSAGE =
  'ログインできませんでした。時間をおいてもう一度お試しください。解消しない場合は管理者へご連絡ください。';

type LoginRequestBody = {
  email?: unknown;
  password?: unknown;
};

/** エラーレスポンスを返す */
function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    // ------------------------------------------------------------
    // 1. 入力の取り出しと検証
    // ------------------------------------------------------------
    let body: LoginRequestBody;
    try {
      body = (await request.json()) as LoginRequestBody;
    } catch {
      return errorResponse(MISSING_INPUT_MESSAGE, 400);
    }

    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (email === '' || password === '') {
      return errorResponse(MISSING_INPUT_MESSAGE, 400);
    }

    // ------------------------------------------------------------
    // 2. 社内メールドメインの検証（Supabaseへ投げる前に行う）
    //
    // 対象外のアドレスをSupabaseへ送らないことで、
    // 社外アドレスに対する総当たり試行の踏み台にされることも防げる
    // ------------------------------------------------------------
    const domainCheck = checkEmailDomain(email);

    if (!domainCheck.allowed) {
      // 【重要】ログにメールアドレスを残さない（個人情報・アカウント列挙の材料になる）
      return errorResponse(domainCheck.message, 403);
    }

    // ------------------------------------------------------------
    // 3. Supabase Auth でログインする
    //    成功するとセッションCookieがこのレスポンスへ書き込まれる
    // ------------------------------------------------------------
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      return errorResponse(toLoginErrorMessage(error.message), toLoginErrorStatus(error.message));
    }

    // ------------------------------------------------------------
    // 4. 発行されたセッションのメールアドレスを再検証する
    //
    // 入力値ではなくSupabaseが返した確定値で確認する。
    // 万一ここで不一致なら、セッションを残さず破棄してから拒否する
    // ------------------------------------------------------------
    const confirmedCheck = checkEmailDomain(data.user?.email);

    if (!confirmedCheck.allowed) {
      await supabase.auth.signOut();
      return errorResponse(confirmedCheck.message, 403);
    }

    return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    // 内部エラーの詳細はサーバーログのみへ出す（利用者へ内部情報を渡さない）
    console.error('[api/auth/login] ログイン処理で想定外のエラーが発生しました:', error);
    return errorResponse(GENERIC_ERROR_MESSAGE, 500);
  }
}
