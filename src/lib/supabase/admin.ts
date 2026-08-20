import { createClient } from '@supabase/supabase-js';

/**
 * 管理操作用のSupabaseクライアントを生成する（service_role キーを使用）。
 *
 * 【重要】このクライアントはRLSを迂回し、全データへアクセスできる。
 * 文書の取り込み（documents / document_chunks へのINSERT・UPDATE）など、
 * サーバーサイドの書き込み処理でのみ使用すること。
 *
 * 【厳禁】Client Componentからimportしないこと。
 * import した時点で service_role キーがブラウザへバンドルされ、
 * 社内文書の全データが外部から読み書き可能になる。
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      'Supabaseの環境変数が設定されていません。.env.local に NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください。'
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      // サーバー側の処理ではセッションを保持しない
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
