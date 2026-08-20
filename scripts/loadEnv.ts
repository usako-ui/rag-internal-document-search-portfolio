import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * スクリプト実行用の環境変数読み込み
 *
 * Next.jsのAPI Routeは `.env.local` を自動で読み込むが、
 * tsx で直接実行するスクリプトは読み込まれないため、ここで明示的に読む。
 *
 * 【重要】読み込んだ値をログへ出力しないこと（APIキーが端末履歴に残るため）。
 */
export function loadEnv(): void {
  const envPath = resolve(process.cwd(), '.env.local');

  if (!existsSync(envPath)) {
    throw new Error(
      '.env.local が見つかりません。.env.example をコピーして値を設定してください。'
    );
  }

  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    // 既に設定済みの環境変数は上書きしない
    if (process.env[key] === undefined && value.length > 0) {
      process.env[key] = value;
    }
  }
}

/**
 * 必須の環境変数を取得する。未設定なら分かりやすいエラーで止める。
 */
export function requireEnv(key: string): string {
  const value = process.env[key];

  if (!value || value.trim().length === 0) {
    throw new Error(`環境変数 ${key} が設定されていません。.env.local を確認してください。`);
  }

  return value.trim();
}
