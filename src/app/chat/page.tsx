import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { buildLoginUrl } from '@/lib/auth/redirect';

/**
 * チャット画面（ログイン後のメイン画面）
 *
 * UX優先順位1位「質問しやすい」を満たすため、ログイン後の最初の画面をチャットにしている。
 *
 * 【`/` から `/chat` へ移した理由（BYOKデモ対応）】
 * `/` は未ログインでも開ける公開ランディングページになったため、
 * 認証が必要なチャットはこちらへ分けている。画面の内容自体は変更していない。
 *
 * 【画面保護（TC-19 / 要件F-06）】
 * 未ログインのアクセスは `/login?redirectTo=/` へ送る。
 * Worktree B の認証Middlewareでも同じ保護がかかるが、
 * Middlewareの設定漏れやマッチャの変更で素通りしても社内文書が表示されないよう、
 * 画面側でもセッションを確認している（多層防御）。
 */

// ログイン状態で表示が変わるため、静的に事前生成させない
export const dynamic = 'force-dynamic';

export default async function Home() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(buildLoginUrl('/chat'));
  }

  return <AppShell userEmail={user.email ?? ''} />;
}
