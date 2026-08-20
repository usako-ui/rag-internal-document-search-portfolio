import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { validateRegisterInput } from '@/lib/auth/registerRules';

/**
 * POST /api/auth/register（TS-07 / 要件F-06）
 *
 * 社内メールアドレスでの自己登録を受け付ける。
 * Supabaseへ登録を投げる**前に**ドメインを検証し、対象外のアドレスは拒否する。
 *
 * 【Confirm email（メール確認）は必ず有効のままにすること】
 * この画面は誰でも開ける。メール確認を無効化すると、社内アドレスを騙って
 * 登録した相手がそのままログインでき、ドメイン制限が意味を失う。
 * 「社内ドメインのメールを受信できること」が唯一の本人確認手段である。
 * Supabaseダッシュボードの Authentication > Sign In / Providers >
 * 「Confirm email」を無効化してはいけない（tasks.md TS-06・TS-07に記録）。
 *
 * 【確認メールのリンク先について】
 * `emailRedirectTo` は**あえて指定していない**。
 * リクエストのHostヘッダーから組み立てると、偽装したHostで
 * 確認リンクを外部サイトへ向けさせられる余地が生まれるため、
 * 遷移先はSupabaseダッシュボードの Site URL（サーバー側の設定値）に委ねる。
 */

// 登録結果をキャッシュしてはならない
export const dynamic = 'force-dynamic';
// Supabaseクライアントを使うためNode.jsランタイムで動かす
export const runtime = 'nodejs';

/** レスポンスをキャッシュさせないための共通ヘッダー */
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

/** 想定外の例外で返す共通メッセージ（内部情報をクライアントへ出さない） */
const GENERIC_ERROR_MESSAGE =
  '登録できませんでした。時間をおいてもう一度お試しください。解消しない場合は管理者へご連絡ください。';

/** 登録受付時のメッセージ（画面側でも表示する） */
const REGISTERED_MESSAGE = '確認メールを送信しました。';

type RegisterRequestBody = {
  email?: unknown;
  password?: unknown;
};

/** エラーレスポンスを返す */
function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
}

/**
 * Supabaseが返す登録エラーを利用者向けメッセージへ変換する。
 *
 * 【重要】「そのアドレスは登録済み」と伝えてはいけない。
 * 誰が在籍しているかを外部から総当たりで調べられてしまう。
 */
function toRegisterErrorMessage(message: string): string {
  const normalized = message.toLowerCase();

  if (normalized.includes('password')) {
    return 'パスワードが条件を満たしていません。12文字以上で設定してください。';
  }

  if (normalized.includes('too many requests') || normalized.includes('rate limit')) {
    return '登録の試行回数が上限に達しました。しばらく待ってからもう一度お試しください。';
  }

  if (normalized.includes('invalid') && normalized.includes('email')) {
    return 'メールアドレスの形式が正しくありません。入力内容をご確認ください。';
  }

  return GENERIC_ERROR_MESSAGE;
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    // ------------------------------------------------------------
    // 1. 入力の取り出し
    // ------------------------------------------------------------
    let body: RegisterRequestBody;
    try {
      body = (await request.json()) as RegisterRequestBody;
    } catch {
      return errorResponse('リクエストの形式が正しくありません。', 400);
    }

    const rawEmail = typeof body.email === 'string' ? body.email : '';
    const rawPassword = typeof body.password === 'string' ? body.password : '';

    // ------------------------------------------------------------
    // 2. ドメイン・パスワードの検証
    //    画面側と同じ関数を使う（画面の検証は改造すれば飛ばせるため必須）
    // ------------------------------------------------------------
    const validated = validateRegisterInput({ email: rawEmail, password: rawPassword });

    if (!validated.ok) {
      if (validated.reason === 'not-configured') {
        // 設定不備は利用者では解決できない。原因が追えるようサーバーログへ残す
        console.error(
          '[api/auth/register] ALLOWED_EMAIL_DOMAIN が未設定のため登録を拒否しました。.env.local / Vercelの環境変数を確認してください。'
        );
      }

      // ドメイン関連は403（社外アドレス・設定漏れ）、それ以外の入力不備は400。
      // 画面側が「社外アドレス」と「入力ミス」を区別できるようにする。
      // 【重要】メッセージ本文ではなく reason で判定する。
      //         メール未入力を「ドメイン不一致」と取り違えて403にしないため
      const isDomainError =
        validated.reason === 'domain-mismatch' || validated.reason === 'not-configured';

      return errorResponse(validated.message, isDomainError ? 403 : 400);
    }

    // ------------------------------------------------------------
    // 3. Supabase Auth へ登録する
    //
    //    Confirm email が有効なため、ここではセッションが発行されない。
    //    利用者は確認メールのリンクを開いて初めてログインできるようになる
    // ------------------------------------------------------------
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.auth.signUp({
      email: validated.email,
      password: validated.password,
    });

    if (error) {
      return errorResponse(toRegisterErrorMessage(error.message), 400);
    }

    // 【重要】登録済みかどうかで応答を変えない。
    // Supabaseも既存アドレスの登録を成功と同じ形で返す（アカウント列挙を防ぐため）。
    // ここで分岐を足すと、その配慮を台無しにしてしまう
    return NextResponse.json(
      { ok: true, message: REGISTERED_MESSAGE },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    // 内部エラーの詳細はサーバーログのみへ出す（メールアドレスは残さない）
    console.error('[api/auth/register] 登録処理で想定外のエラーが発生しました:', error);
    return errorResponse(GENERIC_ERROR_MESSAGE, 500);
  }
}
