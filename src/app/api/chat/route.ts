import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { checkEmailDomain } from '@/lib/auth/emailDomain';
import {
  InvalidQuestionError,
  generateQueryEmbedding,
  validateQuestion,
} from '@/lib/search/queryEmbedding';
import { SearchError, searchChunks } from '@/lib/search/searchChunks';
import {
  AnswerGenerationError,
  NO_ANSWER_MESSAGE,
  RATE_LIMIT_MESSAGE,
  generateAnswer,
} from '@/lib/gemini/answer';
import { type Citation, buildCitations } from '@/lib/chat/citations';
import { EmbeddingError } from '@/lib/gemini/embedding';
import { loadUserSettings } from '@/lib/settings/userSettings';
import { checkRateLimit } from '@/lib/rateLimit';

/**
 * POST /api/chat（TB-09 / 要件F-02・F-03・F-04・F-06）
 *
 * UI（Worktree C）から呼び出す質問用の唯一のエンドポイント。
 * 質問 → クエリEmbedding → pgvector検索 → Gemini回答生成 → 出典組み立て、の順に処理する。
 *
 * レスポンス仕様は requirements.md セクション7に従う。
 * 【重要】フィールドを勝手に追加・削除・リネームしないこと（UIとの契約が壊れる）。
 */

// 検索結果は毎回最新であるべきなので、キャッシュせず常に実行する
export const dynamic = 'force-dynamic';
// Gemini SDK・Supabaseクライアントを使うためNode.jsランタイムで動かす
export const runtime = 'nodejs';

/** 正常時のレスポンス */
type ChatResponse = {
  answer: string;
  citations: Citation[];
  has_answer: boolean;
};

/** エラー時のレスポンス */
type ChatErrorResponse = {
  error: string;
};

/** 想定外の例外で返す共通メッセージ（内部情報をクライアントへ出さない） */
const GENERIC_ERROR_MESSAGE = '回答の取得に失敗しました。もう一度お試しください。';

/** エラーレスポンスを返す */
function errorResponse(message: string, status: number): NextResponse<ChatErrorResponse> {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request): Promise<NextResponse<ChatResponse | ChatErrorResponse>> {
  try {
    // ------------------------------------------------------------
    // 1. 認証確認（F-06）
    //    Middlewareでも弾いているが、APIは直接呼び出される可能性があるため
    //    ここでも必ず確認する。未ログインで社内文書が読めてはならない
    // ------------------------------------------------------------
    const supabase = createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
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

    // ------------------------------------------------------------
    // レート制限（Q-52）
    //
    // Gemini無料枠は毎分5回程度のため、1人の連打で全社員が
    // 「APIの利用制限に達しました」に遭遇する。先に本人へ返して原因を分かりやすくする。
    //
    // 【キーにユーザーIDを使う理由】
    // IPアドレスだと社内NAT経由で全員が同一IPになり、1人の連打で全員が止まる。
    // Supabaseが検証済みのユーザーIDなら詐称できず、対象も本人だけに限定できる。
    //
    // 【入力検証より前に置く理由】
    // 重い処理（Embedding生成・Gemini呼び出し）へ進む前に落とすため。
    // ------------------------------------------------------------
    const rateLimit = checkRateLimit(user.id);

    if (!rateLimit.allowed) {
      // Gemini側の制限と同じ文言を使う。利用者から見れば「待てば直る」で同じ状況のため、
      // ここだけ別の言い回しにすると混乱する
      return NextResponse.json(
        { error: RATE_LIMIT_MESSAGE },
        {
          status: 429,
          // いつ再試行してよいかを機械可読な形でも返す（HTTP標準のヘッダー）
          headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
        }
      );
    }

    // ------------------------------------------------------------
    // 2. リクエストの検証
    // ------------------------------------------------------------
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse('リクエストの形式が正しくありません。', 400);
    }

    const question = validateQuestion((body as { question?: unknown } | null)?.question);

    // ------------------------------------------------------------
    // 3. クエリEmbedding生成（TB-01）と類似検索（TB-02・TB-03）
    // ------------------------------------------------------------
    // 利用者設定（検索件数・回答の長さ）を反映する（TE-10）。
    // 【重要】類似度閾値は設定に含めない。ハルシネーション抑制の要であり
    // 利用者が緩められてはならないため 0.62 固定とする（Q-38・2026-08-18 決定）
    const settings = await loadUserSettings(supabase, user.id);

    const queryEmbedding = await generateQueryEmbedding(question);
    const chunks = await searchChunks(supabase, queryEmbedding, {
      matchCount: settings.match_count,
    });

    // 閾値を超えるチャンクが無い＝社内文書に根拠が無い（TB-10）
    if (chunks.length === 0) {
      return NextResponse.json({
        answer: NO_ANSWER_MESSAGE,
        citations: [],
        has_answer: false,
      });
    }

    // ------------------------------------------------------------
    // 4. 回答生成（TB-05〜TB-07）と出典組み立て（TB-08）
    // ------------------------------------------------------------
    const { answer, hasAnswer, usedChunks } = await generateAnswer(question, chunks, {
      answerLength: settings.answer_length,
    });

    // 根拠が無いと判断された場合は出典を表示しない（F-04・UIは出典エリアを非表示にする）
    return NextResponse.json({
      answer,
      citations: hasAnswer ? buildCitations(usedChunks) : [],
      has_answer: hasAnswer,
    });
  } catch (error) {
    // 入力が不正な場合は原因が分かるメッセージを返す
    if (error instanceof InvalidQuestionError) {
      return errorResponse(error.userMessage, 400);
    }

    // Embeddingのエラーメッセージは環境変数名など内部情報を含むため、
    // クライアントへは共通文言を返し、詳細はサーバーログにのみ残す
    if (error instanceof EmbeddingError) {
      console.error('[POST /api/chat] Embedding生成エラー', error.message, error.cause ?? '');
      return errorResponse(GENERIC_ERROR_MESSAGE, 502);
    }

    // API利用制限（429）は「待てば復旧する」ため、502ではなく429で返す。
    // UI側が恒久的な障害と区別できるようにするため
    if (error instanceof AnswerGenerationError && error.isRateLimit) {
      console.error('[POST /api/chat] Gemini APIの利用制限に到達', error.cause ?? '');
      return errorResponse(error.userMessage, 429);
    }

    // 検索・回答生成の想定内エラーはユーザー向け文言をそのまま返す
    if (error instanceof SearchError || error instanceof AnswerGenerationError) {
      // 原因調査のためサーバーログにのみ詳細を残す（クライアントへは返さない）
      console.error('[POST /api/chat]', error.message, error.cause ?? '');
      return errorResponse(error.userMessage, 502);
    }

    console.error('[POST /api/chat] 想定外のエラー', error);
    return errorResponse(GENERIC_ERROR_MESSAGE, 500);
  }
}
