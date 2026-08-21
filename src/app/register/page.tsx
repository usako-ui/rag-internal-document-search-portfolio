import { redirect } from 'next/navigation';
import { RegisterForm } from '@/components/auth/RegisterForm';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { checkEmailDomain, getAllowedEmailDomain } from '@/lib/auth/emailDomain';
import { DEFAULT_REDIRECT_PATH } from '@/lib/auth/redirect';

/**
 * アカウント登録画面（要件F-06）
 *
 * 社内メールアドレスを持つ人が自分でアカウントを作れるようにする。
 * 登録後は確認メールのリンクを開いて初めてログインできる
 * （Supabaseの「Confirm email」を有効のまま維持しているため）。
 *
 * すでに社内アカウントでログイン済みの場合は、この画面を出さずチャット画面へ送る
 * （ログイン済みなのに登録を求められる、という混乱を防ぐ）。
 *
 * 【ドメイン外セッションのときは遷移させない】
 * ログイン画面（`/login`）と同じ理由。ドメイン外のセッションのまま
 * 保護画面へ送るとMiddlewareに弾き返され、リダイレクトが往復してしまう。
 * その場合は登録フォームをそのまま表示する。
 */

// セッションの有無で表示が変わるため、静的に事前生成させない
export const dynamic = 'force-dynamic';

export default async function RegisterPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user && checkEmailDomain(user.email).allowed) {
    redirect(DEFAULT_REDIRECT_PATH);
  }

  // 【重要】環境変数の読み取りはサーバー側でしか行えない。
  // ALLOWED_EMAIL_DOMAIN は NEXT_PUBLIC_ 接頭辞が無いため、
  // RegisterForm（'use client'）から直接読むと必ず undefined になる
  return <RegisterForm allowedDomain={getAllowedEmailDomain()} />;
}
