import type { DocumentStatus } from '@/types/api';

/**
 * 表示用の整形ユーティリティ
 */

/**
 * ISO8601の日時文字列を「2026/08/16 10:15」形式へ整形する。
 *
 * 日本時間（UTC+9）に固定して計算している。
 * `toLocaleString` を使うとサーバー（UTC）とブラウザ（JST）で結果が変わり、
 * Next.jsのハイドレーション不一致エラーになるため。
 */
export function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';

  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');

  return `${jst.getUTCFullYear()}/${pad(jst.getUTCMonth() + 1)}/${pad(jst.getUTCDate())} ${pad(
    jst.getUTCHours()
  )}:${pad(jst.getUTCMinutes())}`;
}

/**
 * 現在時刻を「10:30」形式へ整形する。チャットの発言時刻表示に使用する。
 * クライアント側でのみ呼ぶこと（サーバーとブラウザで時刻がずれるため）。
 */
export function formatTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 文書の登録状態を利用者向けの日本語ラベルへ変換する。
 * 「ready」のような内部の値をそのまま画面に出さないこと。
 */
export function getDocumentStatusLabel(status: DocumentStatus): string {
  switch (status) {
    case 'ready':
      return '検索可能';
    case 'processing':
      return '処理中';
    case 'error':
      return 'エラー';
    default:
      return '不明';
  }
}
