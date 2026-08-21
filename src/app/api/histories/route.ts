import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { checkEmailDomain } from '@/lib/auth/emailDomain';
import { loadUserSettings } from '@/lib/settings/userSettings';
import type { Citation } from '@/types/api';

/**
 * 質問履歴API（納品前改善フェーズ STEP 1-2・1-3）
 *
 * - GET  /api/histories … ログインユーザー本人の履歴を作成日時の降順で返す
 * - POST /api/histories … 回答を受け取った直後に1件保存する
 *
 * 【重要】履歴は「誰が何を聞いたか」が残るデータのため、
 * 必ず anon キー＋RLS（`createSupabaseServerClient`）で操作すること。
 * service_role を使うとRLSを迂回し、他人の履歴が見える・書ける状態になる。
 */

// 履歴は常に最新を返す必要があるためキャッシュしない（コーディング規約）
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** レスポンスをキャッシュさせないための共通ヘッダー */
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

/** 1回の取得で返す履歴の上限。際限なく返すと画面表示・通信量が重くなるため上限を設ける */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/** 保存する質問・回答の最大文字数（DB肥大化と極端なデータの混入を防ぐ） */
const MAX_QUESTION_LENGTH = 1000;
const MAX_ANSWER_LENGTH = 10000;

/** エラーレスポンスを返す */
function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
}

/**
 * ログイン中のユーザーを取得する。
 * 未ログインの場合は null を返し、呼び出し側で401にする。
 */
async function getAuthenticatedUser() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return { supabase, user: null };
  return { supabase, user };
}

/**
 * GET /api/histories（STEP 1-2）
 *
 * ログインユーザー本人の履歴を新しい順で返す。
 * 他人の履歴はRLSによって除外されるため、アプリ側でも user_id を条件に加えて二重に守る。
 *
 * クエリパラメータ：
 *   limit … 取得件数（既定50・最大100）。設定画面の「履歴表示件数」から指定する
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { supabase, user } = await getAuthenticatedUser();

    if (!user) {
      return errorResponse('ログインが必要です。ログインしてから再度お試しください。', 401);
    }

    // ------------------------------------------------------------
    // 社内メールドメインの確認（要件F-06）
    //    Middlewareでも弾いているが、公開パス設定の漏れや環境変数の
    //    設定漏れで素通りした場合でも社内文書を返さないよう二重に守る
    // ------------------------------------------------------------
    const domainCheck = checkEmailDomain(user.email);

    if (!domainCheck.allowed) {
      return errorResponse(domainCheck.message, 403);
    }

    // limit の明示指定が無ければ、設定画面の「履歴表示件数」を使う。
    // 設定も無ければ既定値。不正な値・上限超過は丸める（エラーにせず表示を優先する）
    const requestedLimit = Number(new URL(request.url).searchParams.get('limit'));
    let limit = DEFAULT_LIMIT;

    if (Number.isFinite(requestedLimit) && requestedLimit > 0) {
      limit = Math.min(Math.floor(requestedLimit), MAX_LIMIT);
    } else {
      const settings = await loadUserSettings(supabase, user.id);
      limit = settings.history_limit;
    }

    const { data, error } = await supabase
      .from('chat_histories')
      .select('id, question, answer, citations, created_at')
      // RLSでも絞られるが、ポリシー変更時の事故を防ぐためアプリ側でも明示する
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[GET /api/histories] 履歴の取得に失敗:', error);
      return errorResponse('質問履歴を取得できませんでした。時間をおいてもう一度お試しください。', 500);
    }

    return NextResponse.json(data ?? [], { headers: NO_STORE_HEADERS });
  } catch (error) {
    // 環境変数未設定などはここに来る
    console.error('[GET /api/histories] 想定外のエラー:', error);
    return errorResponse('質問履歴を取得できませんでした。時間をおいてもう一度お試しください。', 500);
  }
}

/**
 * リクエストボディの citations を検証する。
 *
 * クライアントから届く値をそのままDBへ入れると、
 * 履歴画面が想定外の形で壊れるため、必要なフィールドだけを取り出して整形する。
 */
function normalizeCitations(value: unknown): Citation[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .filter((item) => typeof item.document_name === 'string' && typeof item.document_id === 'string')
    .map((item) => ({
      document_name: item.document_name as string,
      page: typeof item.page === 'string' ? item.page : null,
      section: typeof item.section === 'string' ? item.section : null,
      document_id: item.document_id as string,
      // 履歴から出典モーダルを開けるよう該当箇所の本文も保存する。
      // 古い履歴には content が無いため、欠けている場合は空文字にする
      content: typeof item.content === 'string' ? item.content : '',
    }));
}

/**
 * POST /api/histories（STEP 1-3）
 *
 * 回答が返ってきた直後にUI側から呼び出し、履歴を1件保存する。
 *
 * user_id はリクエストボディからではなく**ログインセッションから決める**。
 * ボディで受け取ると他人になりすまして履歴を書き込めてしまうため。
 * （RLSの with check でも弾かれるが、そもそも受け取らない設計にしている）
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const { supabase, user } = await getAuthenticatedUser();

    if (!user) {
      return errorResponse('ログインが必要です。ログインしてから再度お試しください。', 401);
    }

    // ------------------------------------------------------------
    // 社内メールドメインの確認（要件F-06）
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

    const payload = (body ?? {}) as { question?: unknown; answer?: unknown; citations?: unknown };

    const question = typeof payload.question === 'string' ? payload.question.trim() : '';
    const answer = typeof payload.answer === 'string' ? payload.answer.trim() : '';

    if (question.length === 0) {
      return errorResponse('質問が空のため履歴を保存できません。', 400);
    }

    if (answer.length === 0) {
      return errorResponse('回答が空のため履歴を保存できません。', 400);
    }

    const { data, error } = await supabase
      .from('chat_histories')
      .insert({
        user_id: user.id,
        question: question.slice(0, MAX_QUESTION_LENGTH),
        answer: answer.slice(0, MAX_ANSWER_LENGTH),
        citations: normalizeCitations(payload.citations),
      })
      .select('id, question, answer, citations, created_at')
      .single();

    if (error) {
      console.error('[POST /api/histories] 履歴の保存に失敗:', error);
      return errorResponse('質問履歴を保存できませんでした。', 500);
    }

    return NextResponse.json(data, { status: 201, headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error('[POST /api/histories] 想定外のエラー:', error);
    return errorResponse('質問履歴を保存できませんでした。', 500);
  }
}
