import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * サーバーサイド（Server Component・Route Handler）から使用するSupabaseクライアントを生成する。
 *
 * Cookieからログインセッションを読み取るため、認証済みユーザーとして動作する。
 * anon キーを使うのでRLSが適用される（＝未ログインなら文書を読めない）。
 */
export function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Supabaseの環境変数が設定されていません。.env.local に NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_ANON_KEY を設定してください。'
    );
  }

  const cookieStore = cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Componentからは Cookie を書き込めない（Next.jsの仕様）。
          // セッション更新はMiddleware側で行うため、ここでは無視して問題ない。
        }
      },
    },
  });
}
