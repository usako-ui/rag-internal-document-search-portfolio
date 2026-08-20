import { redirect } from 'next/navigation';
import { PageShell } from '@/components/layout/PageShell';
import { SettingsView } from '@/components/settings/SettingsView';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { buildLoginUrl } from '@/lib/auth/redirect';

/**
 * 設定画面（TE-10）
 *
 * 【画面保護（要件F-06）】
 * 設定は本人のみが変更できるべきものなので、
 * Middlewareに加えて画面側でもセッションを確認する（多層防御）。
 */

// ログイン状態で表示が変わるため、静的に事前生成させない
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(buildLoginUrl('/settings'));
  }

  return (
    <PageShell
      activeNav="settings"
      userEmail={user.email ?? ''}
      title="設定"
      sub="表示や検索の動作を変更できます"
    >
      <SettingsView userEmail={user.email ?? ''} />
    </PageShell>
  );
}
