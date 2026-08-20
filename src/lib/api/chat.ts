import type { ChatRequest, ChatResponse } from '@/types/api';

/**
 * チャットAPIのクライアント（TC-10・TC-12）
 *
 * 呼び出し先は Worktree B が実装した `POST /api/chat`。
 * 仕様は requirements.md セクション7で確定済みのため、
 * リクエスト・レスポンスの形をここで勝手に変えないこと。
 *
 *   リクエスト  : { question: string }
 *   正常レスポンス: { answer, citations, has_answer }
 *   エラー      : { error: string }
 *
 * 【エラー方針（F-05）】
 * 「失敗しました」だけで終わらせず、原因と次に取るべき行動が分かる文言を返す。
 */

const CHAT_ENDPOINT = '/api/chat';

/** 仕様で定められた既定のエラーメッセージ（requirements.md セクション7） */
export const DEFAULT_CHAT_ERROR_MESSAGE =
  '回答の取得に失敗しました。もう一度お試しください。';

/** 利用者へそのまま表示してよいメッセージを持つエラー */
export class ChatApiError extends Error {
  readonly userMessage: string;

  constructor(userMessage: string, options?: { cause?: unknown }) {
    super(userMessage, options);
    this.name = 'ChatApiError';
    this.userMessage = userMessage;
  }
}

/**
 * エラーレスポンスから利用者向けメッセージを取り出す。
 *
 * Q-26（Worktree B確定）：未認証のAPIアクセスには 401 が返る。
 * この場合は「もう一度お試しください」では解決しないため、
 * 再ログインが必要であることを明示する。
 */
function toChatErrorMessage(rawBody: string, status: number): string {
  if (status === 401 || status === 403) {
    return 'ログインの有効期限が切れています。ログインし直してから、もう一度質問してください。';
  }

  try {
    const parsed = JSON.parse(rawBody) as { error?: unknown };
    if (typeof parsed.error === 'string' && parsed.error.length > 0) {
      // Worktree B が利用者向けに用意したメッセージをそのまま使う
      return parsed.error;
    }
  } catch {
    // JSONでない場合は既定のメッセージを使う（下へ抜ける）
  }

  return DEFAULT_CHAT_ERROR_MESSAGE;
}

/** レスポンスが ChatResponse の形をしているかを確認する */
function isChatResponse(value: unknown): value is ChatResponse {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Partial<ChatResponse>;

  return (
    typeof candidate.answer === 'string' &&
    typeof candidate.has_answer === 'boolean' &&
    Array.isArray(candidate.citations)
  );
}

/**
 * POST /api/chat（TC-10）
 *
 * 質問を送り、回答・出典・`has_answer` を受け取る。
 * 回答生成には時間がかかる（非機能要件3-1：通常10秒以内）ため、
 * 呼び出し側でローディング表示を必ず出すこと。
 */
export async function postChat(question: string): Promise<ChatResponse> {
  const body: ChatRequest = { question };

  let response: Response;

  try {
    response = await fetch(CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // 回答は毎回生成されるものなのでキャッシュしない（CLAUDE.md セクション8）
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch (error) {
    throw new ChatApiError(
      'サーバーへ接続できませんでした。ネットワーク接続を確認して、もう一度お試しください。',
      { cause: error }
    );
  }

  if (!response.ok) {
    const rawBody = await response.text().catch(() => '');
    throw new ChatApiError(toChatErrorMessage(rawBody, response.status));
  }

  let parsed: unknown;

  try {
    parsed = await response.json();
  } catch (error) {
    throw new ChatApiError(DEFAULT_CHAT_ERROR_MESSAGE, { cause: error });
  }

  // 想定外の形が返ったまま画面へ渡すと、回答が空欄で表示されるなど
  // 「AIが答えたように見えるのに中身がない」状態になるため、ここで弾く
  if (!isChatResponse(parsed)) {
    throw new ChatApiError(DEFAULT_CHAT_ERROR_MESSAGE);
  }

  return parsed;
}
