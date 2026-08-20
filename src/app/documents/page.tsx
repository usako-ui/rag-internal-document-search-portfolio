import { redirect } from 'next/navigation';
import { PageShell } from '@/components/layout/PageShell';
import { DocumentsView } from '@/components/documents/DocumentsView';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { buildLoginUrl } from '@/lib/auth/redirect';

/**
 * 文書管理画面（`/documents` / 要件F-07・F-08・F-09）
 *
 * PDFのアップロードと、登録済み文書の更新・削除を1つの画面で行う。
 *
 * 【画面保護（要件F-06）】
 * 社内文書の名前・管轄部署が並ぶ画面であり、削除操作も持つため、
 * Middlewareに加えて画面側でもセッションを確認する（多層防御）。
 */

// ログイン状態で表示が変わるため、静的に事前生成させない
export const dynamic = 'force-dynamic';

export default async function DocumentsPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(buildLoginUrl('/documents'));
  }

  return (
    <PageShell
      activeNav="documents"
      userEmail={user.email ?? ''}
      title="文書管理"
      sub="PDFの追加と、登録済み文書の更新・削除ができます"
    >
      <DocumentsView />
    </PageShell>
  );
}
