import { redirect } from 'next/navigation';
import { PageShell } from '@/components/layout/PageShell';
import { SearchView } from '@/components/search/SearchView';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { buildLoginUrl } from '@/lib/auth/redirect';

/**
 * 文書を検索する画面（`/search` / 要件F-09 ＋）
 *
 * 管轄部署・キーワードで登録済み文書を絞り込み、詳細を確認する。
 *
 * 【画面保護（要件F-06）】
 * 社内文書の名前・管轄部署が並ぶ画面のため、
 * Middlewareに加えて画面側でもセッションを確認する（多層防御）。
 */

// ログイン状態で表示が変わるため、静的に事前生成させない
export const dynamic = 'force-dynamic';

export default async function SearchPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(buildLoginUrl('/search'));
  }

  return (
    <PageShell
      activeNav="search"
      userEmail={user.email ?? ''}
      title="文書を検索"
      sub="管轄部署やキーワードで、AIが検索対象としている文書を絞り込めます"
    >
      <SearchView />
    </PageShell>
  );
}
