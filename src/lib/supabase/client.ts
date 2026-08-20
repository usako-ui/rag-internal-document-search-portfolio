import { createBrowserClient } from '@supabase/ssr';

/**
 * ブラウザ（Client Component）から使用するSupabaseクライアントを生成する。
 *
 * 使用するのは anon キーのみ。RLS（行レベルセキュリティ）が効くため、
 * ログインしていないユーザーは documents / document_chunks を参照できない。
 */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // 環境変数が未設定のまま起動すると原因の分かりにくい実行時エラーになるため、
  // 何が足りないかを明示して落とす
  if (!url || !anonKey) {
    throw new Error(
      'Supabaseの環境変数が設定されていません。.env.local に NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_ANON_KEY を設定してください。'
    );
  }

  return createBrowserClient(url, anonKey);
}
