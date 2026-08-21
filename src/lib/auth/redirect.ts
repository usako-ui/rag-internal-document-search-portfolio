/**
 * ログイン後の戻り先（redirectTo）の取り扱い（要件F-06）
 *
 * 検索API側の仕様（2026-08-17 確定）：
 * 未認証で画面へアクセスすると `/login?redirectTo=元のURL` へリダイレクトされる。
 * ログイン成功後はこの値を使って元のページへ戻す。
 *
 * 【セキュリティ上の注意】
 * redirectTo はURLクエリ経由で外部から自由に指定できる。
 * 検証せずに遷移すると「オープンリダイレクト」となり、
 * 正規のログインURLを踏ませて外部の偽サイトへ飛ばす攻撃に使われる。
 * そのため **同一サイト内の絶対パスだけ** を許可する。
 */

/**
 * 戻り先が指定されていない・不正だった場合の遷移先＝ログイン後の初期画面。
 *
 * `/` は未ログインでも開ける公開ランディングページのため、ログイン後は別画面へ送る。
 *
 * 【2026-08-18 変更：チャット（`/chat`）→ ダッシュボード（`/dashboard`）】
 * ログイン直後がチャットだと、質問する以外の操作（文書の追加・状態の確認）へ
 * 行くにはサイドバーを読む必要があった。
 * 主要な入口を1画面にまとめたダッシュボードを初期画面にする。
 * 質問へは、ダッシュボードのクイックアクション「新しい質問」から1クリックで入れる。
 */
export const DEFAULT_REDIRECT_PATH = '/dashboard';

/** 未ログイン時に遷移させるログイン画面のパス */
export const LOGIN_PATH = '/login';

/**
 * redirectTo として安全に使える値かどうかを判定し、安全なパスだけを返す。
 *
 * 許可するのは `/documents` のような自サイト内の絶対パスのみ。
 * - `https://evil.example.com` … 外部サイトのため拒否
 * - `//evil.example.com`       … プロトコル相対URL（外部へ飛ぶ）ため拒否
 * - `/\evil.example.com`       … ブラウザによっては `//` と解釈されるため拒否
 */
export function sanitizeRedirectPath(value: string | null | undefined): string {
  if (!value) return DEFAULT_REDIRECT_PATH;
  if (!value.startsWith('/')) return DEFAULT_REDIRECT_PATH;
  if (value.startsWith('//') || value.startsWith('/\\')) return DEFAULT_REDIRECT_PATH;

  // ログイン画面へ戻すと無限ループになるため、その場合は既定の遷移先にする
  if (value === LOGIN_PATH || value.startsWith(`${LOGIN_PATH}?`)) return DEFAULT_REDIRECT_PATH;

  return value;
}

/** 未ログイン時の遷移先URLを組み立てる（元のページへ戻れるようにする） */
export function buildLoginUrl(currentPath: string): string {
  return `${LOGIN_PATH}?redirectTo=${encodeURIComponent(currentPath)}`;
}
