/**
 * ログインエラーの文言変換（要件F-06 / UI/UX仕様）
 *
 * Supabaseが返す英語メッセージを、利用者が次に何をすればよいか分かる日本語へ変換する。
 * ログインAPI（サーバー側）とログイン画面（クライアント側）の両方から使うため、
 * 文言を1か所へ集約している（同じ失敗で違う案内が出るのを防ぐ）。
 */

/** 原因を特定できなかった場合の共通メッセージ */
const FALLBACK_MESSAGE =
  'ログインできませんでした。時間をおいてもう一度お試しください。解消しない場合は管理者へご連絡ください。';

/**
 * Supabaseが返すエラーを利用者向けメッセージへ変換する。
 *
 * 「ログインに失敗しました」だけにせず、原因と次に取るべき行動を示す。
 *
 * 【重要】どのメッセージも「そのメールアドレスが存在するか」を明かさない表現にする。
 * 存在の有無が分かると、総当たりでアカウントの一覧を作られてしまう。
 */
export function toLoginErrorMessage(message: string): string {
  const normalized = message.toLowerCase();

  if (normalized.includes('invalid login credentials')) {
    return 'メールアドレスまたはパスワードが正しくありません。入力内容をご確認のうえ、もう一度お試しください。';
  }

  if (normalized.includes('email not confirmed')) {
    return 'メールアドレスの確認が完了していません。届いている確認メールのリンクを開いてから、もう一度ログインしてください。';
  }

  if (normalized.includes('too many requests') || normalized.includes('rate limit')) {
    return 'ログインの試行回数が上限に達しました。しばらく待ってからもう一度お試しください。';
  }

  if (normalized.includes('failed to fetch') || normalized.includes('network')) {
    return 'サーバーへ接続できませんでした。ネットワーク接続を確認して、もう一度お試しください。';
  }

  return FALLBACK_MESSAGE;
}

/**
 * Supabaseのエラーに対応するHTTPステータスを決める。
 *
 * 認証失敗を一律500にすると、UI側が「入力ミス」と「障害」を区別できない。
 */
export function toLoginErrorStatus(message: string): number {
  const normalized = message.toLowerCase();

  if (normalized.includes('invalid login credentials')) return 401;
  if (normalized.includes('email not confirmed')) return 401;
  if (normalized.includes('too many requests') || normalized.includes('rate limit')) return 429;

  return 500;
}
