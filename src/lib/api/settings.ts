import type { UserSettings } from '@/types/api';
import { DEFAULT_USER_SETTINGS, parseUserSettings } from '@/lib/settings/userSettings';

/**
 * 利用者設定APIのクライアント
 *
 *   GET /api/settings … UserSettings（未保存なら既定値）
 *   PUT /api/settings … UserSettings → 保存後の値
 */

const SETTINGS_ENDPOINT = '/api/settings';

/** 利用者へそのまま表示してよいメッセージを持つエラー */
export class SettingsApiError extends Error {
  readonly userMessage: string;

  constructor(userMessage: string, options?: { cause?: unknown }) {
    super(userMessage, options);
    this.name = 'SettingsApiError';
    this.userMessage = userMessage;
  }
}

/** エラーレスポンスから利用者向けメッセージを取り出す */
function toErrorMessage(rawBody: string, status: number, fallback: string): string {
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

  return fallback;
}

/**
 * GET /api/settings
 *
 * 設定が読めなくても画面は開けるべきなので、想定外の形が返った場合は既定値へ倒す。
 */
export async function fetchSettings(): Promise<UserSettings> {
  let response: Response;

  try {
    response = await fetch(SETTINGS_ENDPOINT, {
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch (error) {
    throw new SettingsApiError(
      'サーバーへ接続できませんでした。ネットワーク接続を確認して、もう一度お試しください。',
      { cause: error }
    );
  }

  if (!response.ok) {
    const rawBody = await response.text().catch(() => '');
    throw new SettingsApiError(
      toErrorMessage(rawBody, response.status, '設定を読み込めませんでした。')
    );
  }

  const parsed = parseUserSettings(await response.json().catch(() => null));
  return parsed.ok ? parsed.value : DEFAULT_USER_SETTINGS;
}

/** PUT /api/settings */
export async function saveSettings(settings: UserSettings): Promise<UserSettings> {
  let response: Response;

  try {
    response = await fetch(SETTINGS_ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch (error) {
    throw new SettingsApiError(
      'サーバーへ接続できませんでした。ネットワーク接続を確認して、もう一度お試しください。',
      { cause: error }
    );
  }

  if (!response.ok) {
    const rawBody = await response.text().catch(() => '');
    throw new SettingsApiError(
      toErrorMessage(
        rawBody,
        response.status,
        '設定を保存できませんでした。時間をおいてもう一度お試しください。'
      )
    );
  }

  const parsed = parseUserSettings(await response.json().catch(() => null));
  return parsed.ok ? parsed.value : settings;
}
