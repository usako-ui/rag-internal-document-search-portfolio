import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { checkEmailDomain } from '@/lib/auth/emailDomain';
import {
  DEFAULT_USER_SETTINGS,
  loadUserSettings,
  parseUserSettings,
} from '@/lib/settings/userSettings';

/**
 * 利用者設定API（Phase ENH TE-10）
 *
 * - GET /api/settings … ログインユーザー本人の設定を返す（未保存なら既定値）
 * - PUT /api/settings … 設定を保存する（無ければ作成・あれば更新）
 *
 * 【重要】必ず anon キー＋RLS（`createSupabaseServerClient`）で操作すること。
 * service_role を使うとRLSを迂回し、他人の設定を読み書きできてしまう。
 */

// 設定は保存直後に最新が読めないと画面がちらつくためキャッシュしない
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

/** エラーレスポンスを返す */
function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
}

/**
 * GET /api/settings
 *
 * 設定行が無いユーザーには既定値を返す。
 * 「未設定」を画面側で意識せずに済むようにするため、404ではなく200＋既定値とする。
 */
export async function GET(): Promise<NextResponse> {
  try {
    const supabase = createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return errorResponse('ログインが必要です。ログインしてから再度お試しください。', 401);
    }

    // ------------------------------------------------------------
    // 社内メールドメインの確認（TS-06 / 要件F-06）
    //    Middlewareでも弾いているが、公開パス設定の漏れや環境変数の
    //    設定漏れで素通りした場合でも社内文書を返さないよう二重に守る
    // ------------------------------------------------------------
    const domainCheck = checkEmailDomain(user.email);

    if (!domainCheck.allowed) {
      return errorResponse(domainCheck.message, 403);
    }

    const settings = await loadUserSettings(supabase, user.id);
    return NextResponse.json(settings, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error('[GET /api/settings] 想定外のエラー:', error);
    // 設定が読めなくても画面は開けるべきなので、既定値を返して操作を継続させる
    return NextResponse.json(DEFAULT_USER_SETTINGS, { headers: NO_STORE_HEADERS });
  }
}

/**
 * PUT /api/settings
 *
 * 設定を保存する。user_id はリクエストボディではなく**ログインセッションから決める**
 * （ボディで受け取ると他人の設定を書き換えられてしまう）。
 *
 * 1ユーザー1行のため upsert（無ければ挿入・あれば更新）を使う。
 */
export async function PUT(request: Request): Promise<NextResponse> {
  try {
    const supabase = createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return errorResponse('ログインが必要です。ログインしてから再度お試しください。', 401);
    }

    // ------------------------------------------------------------
    // 社内メールドメインの確認（TS-06 / 要件F-06）
    //    Middlewareでも弾いているが、公開パス設定の漏れや環境変数の
    //    設定漏れで素通りした場合でも社内文書を返さないよう二重に守る
    // ------------------------------------------------------------
    const domainCheck = checkEmailDomain(user.email);

    if (!domainCheck.allowed) {
      return errorResponse(domainCheck.message, 403);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse('リクエストの形式が正しくありません。', 400);
    }

    // 不正な値はDBのCHECK制約でも弾かれるが、
    // 制約違反エラーは原因が分からないため、ここで具体的な文言を返す
    const parsed = parseUserSettings(body);
    if (!parsed.ok) {
      return errorResponse(parsed.reason, 400);
    }

    const { data, error } = await supabase
      .from('user_settings')
      .upsert({ user_id: user.id, ...parsed.value }, { onConflict: 'user_id' })
      .select('history_limit, answer_length, match_count')
      .single();

    if (error) {
      console.error('[PUT /api/settings] 設定の保存に失敗:', error);
      return errorResponse('設定を保存できませんでした。時間をおいてもう一度お試しください。', 500);
    }

    return NextResponse.json(data, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error('[PUT /api/settings] 想定外のエラー:', error);
    return errorResponse('設定を保存できませんでした。時間をおいてもう一度お試しください。', 500);
  }
}
