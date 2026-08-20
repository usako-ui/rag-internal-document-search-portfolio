import type { ChatHistory, Citation } from '@/types/api';

/**
 * 質問履歴APIのクライアント（TE-07）
 *
 * 呼び出し先は Phase ENH STEP 1 で追加した以下の2エンドポイント。
 *
 *   GET  /api/histories … ChatHistory[]（作成日時の降順）
 *   POST /api/histories … { question, answer, citations } → 保存した1件
 *
 * 【エラー方針】
 * 「失敗しました」だけで終わらせず、原因と次に取るべき行動が分かる文言を返す
 * （CLAUDE.md セクション10）。
 */

const HISTORIES_ENDPOINT = '/api/histories';

/** 利用者へそのまま表示してよいメッセージを持つエラー */
export class HistoryApiError extends Error {
  readonly userMessage: string;

  constructor(userMessage: string, options?: { cause?: unknown }) {
    super(userMessage, options);
    this.name = 'HistoryApiError';
    this.userMessage = userMessage;
  }
}

/** エラーレスポンスから利用者向けメッセージを取り出す */
function toErrorMessage(rawBody: string, status: number): string {
  if (status === 401 || status === 403) {
    return 'ログインの有効期限が切れています。ログインし直してから、もう一度お試しください。';
  }

  try {
    const parsed = JSON.parse(rawBody) as { error?: unknown };
    if (typeof parsed.error === 'string' && parsed.error.length > 0) {
      return parsed.error;
    }
  } catch {
    // JSONでない場合は既定のメッセージを使う
  }

  return '質問履歴を取得できませんでした。時間をおいてもう一度お試しください。';
}

/**
 * GET /api/histories
 *
 * 件数を指定しない場合は、設定画面の「履歴表示件数」がサーバー側で適用される。
 */
export async function fetchHistories(limit?: number): Promise<ChatHistory[]> {
  const url = limit ? `${HISTORIES_ENDPOINT}?limit=${limit}` : HISTORIES_ENDPOINT;

  let response: Response;

  try {
    response = await fetch(url, {
      // 履歴は保存直後に最新が見えないと困るためキャッシュしない（CLAUDE.md セクション8）
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch (error) {
    throw new HistoryApiError(
      'サーバーへ接続できませんでした。ネットワーク接続を確認して、もう一度お試しください。',
      { cause: error }
    );
  }

  if (!response.ok) {
    const rawBody = await response.text().catch(() => '');
    throw new HistoryApiError(toErrorMessage(rawBody, response.status));
  }

  const parsed = (await response.json().catch(() => null)) as unknown;

  if (!Array.isArray(parsed)) {
    throw new HistoryApiError('質問履歴を取得できませんでした。時間をおいてもう一度お試しください。');
  }

  return parsed as ChatHistory[];
}

/**
 * POST /api/histories（回答受領後の自動保存・Q-39）
 *
 * 【重要】保存の失敗で質問体験を止めないこと。
 * 履歴は補助機能であり、保存に失敗しても回答自体は表示できているため、
 * 呼び出し側では例外を握りつぶしてよい（UX優先順位1位「質問しやすい」を守る）。
 */
export async function saveHistory(input: {
  question: string;
  answer: string;
  citations: Citation[];
}): Promise<void> {
  const response = await fetch(HISTORIES_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    cache: 'no-store',
    credentials: 'same-origin',
  });

  if (!response.ok) {
    const rawBody = await response.text().catch(() => '');
    throw new HistoryApiError(toErrorMessage(rawBody, response.status));
  }
}
