import { redirect } from 'next/navigation';
import { PageShell } from '@/components/layout/PageShell';
import { DashboardView } from '@/components/dashboard/DashboardView';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { buildLoginUrl } from '@/lib/auth/redirect';

/**
 * ダッシュボード（`/dashboard`）
 *
 * ログイン後の初期画面。主要な入口・直近の質問履歴・文書の状態を1画面へ集約する。
 *
 * 【画面保護（要件F-06）】
 * 質問履歴（誰が何を聞いたか）と社内文書の件数を表示するため、
 * Middlewareに加えて画面側でもセッションを確認する（多層防御）。
 */

// ログイン状態で表示が変わるため、静的に事前生成させない
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(buildLoginUrl('/dashboard'));
  }

  return (
    <PageShell
      activeNav="dashboard"
      userEmail={user.email ?? ''}
      title="ダッシュボード"
      sub="よく使う操作と、現在の文書の状態を確認できます"
    >
      <DashboardView />
    </PageShell>
  );
}
