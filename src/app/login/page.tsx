import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/auth/LoginForm';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { sanitizeRedirectPath } from '@/lib/auth/redirect';
import { DOMAIN_RESTRICTION_MESSAGE, checkEmailDomain } from '@/lib/auth/emailDomain';

/**
 * ログイン画面（TC-18・TS-06 / 要件F-06）
 *
 * Q-26（Worktree B確定）：未認証で画面へアクセスすると
 * `/login?redirectTo=元のURL` へリダイレクトされる。
 * ログイン後は redirectTo のページへ戻す。
 *
 * すでにログイン済みの場合はこの画面を出さず、そのまま戻り先へ送る
 * （ログイン済みなのにログインを求められる、という混乱を防ぐ）。
 *
 * 【ドメイン制限との関係：リダイレクトループの防止】
 * 社内ドメイン外のセッションが残っている状態でそのまま戻り先へ送ると、
 * Middlewareが再びこの画面へ弾き返し、無限ループになる。
 * そのため「ログイン済みでもドメイン外なら遷移させず、理由を表示して
 * セッションを破棄する」という分岐を必ず残すこと。
 */

// セッションの有無で表示が変わるため、静的に事前生成させない
export const dynamic = 'force-dynamic';

type LoginPageProps = {
  searchParams: { redirectTo?: string; error?: string };
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  // 外部サイトへ飛ばされないよう、必ず検証してから使う（オープンリダイレクト対策）
  const redirectTo = sanitizeRedirectPath(searchParams.redirectTo);

  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middlewareがドメイン制限で弾いて戻した場合の印
  const blockedByDomain = searchParams.error === 'domain';

  if (user) {
    const domainCheck = checkEmailDomain(user.email);

    if (domainCheck.allowed) {
      redirect(redirectTo);
    }

    // ドメイン外のセッション。遷移させず理由を表示し、セッションを破棄させる
    return (
      <LoginForm
        redirectTo={redirectTo}
        initialErrorMessage={domainCheck.message}
        shouldClearSession
      />
    );
  }

  return (
    <LoginForm
      redirectTo={redirectTo}
      initialErrorMessage={blockedByDomain ? DOMAIN_RESTRICTION_MESSAGE : null}
      shouldClearSession={blockedByDomain}
    />
  );
}
