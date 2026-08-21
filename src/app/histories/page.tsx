import { redirect } from 'next/navigation';
import { PageShell } from '@/components/layout/PageShell';
import { HistoryView } from '@/components/histories/HistoryView';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { buildLoginUrl } from '@/lib/auth/redirect';

/**
 * 質問履歴画面
 *
 * 【画面保護（要件F-06）】
 * 履歴は「誰が何を聞いたか」が分かる個人データのため、
 * Middlewareに加えて画面側でもセッションを確認する（多層防御）。
 */

// ログイン状態で表示が変わるため、静的に事前生成させない
export const dynamic = 'force-dynamic';

export default async function HistoriesPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(buildLoginUrl('/histories'));
  }

  return (
    <PageShell
      activeNav="history"
      userEmail={user.email ?? ''}
      title="質問履歴"
      sub="過去の質問を選ぶと、回答と出典を確認できます"
    >
      <HistoryView />
    </PageShell>
  );
}
