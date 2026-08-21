-- ============================================================
-- Before User Created Hook：社外アドレスでのアカウント作成を拒否する
--
-- 対応要件：F-06（基本認証・社内メールドメイン制限）
--
-- 【なぜ必要か】
-- これまでのドメイン制限は3層あったが、いずれも「作られたアカウントに
-- 何もさせない」ための防御で、**アカウント作成そのものは止められなかった**。
--
--   1. ログイン・登録API … このアプリを経由した登録だけを弾く
--   2. Middleware        … 社外セッションの画面・API利用を弾く
--   3. RLS               … Supabaseを直接叩かれても文書を返さない
--
-- anonキーは NEXT_PUBLIC_ で公開されるため、このアプリを経由せず
-- Supabaseの認証エンドポイントへ直接 signUp すればアカウントは作れてしまう。
-- 実害（文書の閲覧）は3で止まるが、無関係なアカウントが増え続ける。
--
-- このフックは Supabase Auth がユーザーを作成する**直前**に呼ばれ、
-- error を返すと作成そのものが中止される。これで入口を塞ぐ。
--
-- 【重要】このSQLを適用しただけでは有効になりません。
-- Supabaseダッシュボードでの有効化が必要です（README「セットアップ手順」参照）。
--   Authentication > Hooks > Before User Created
--   → Postgres function を選び、public.before_user_created_domain_check を指定
--
-- 【判定に使うドメイン】
-- app_config.allowed_email_domain（migration 20260820100000 で作成）を参照する。
-- アプリ側の環境変数 ALLOWED_EMAIL_DOMAIN と同じ値にすること。
-- 同期は `npm run sync:allowed-domain` で行う。
-- ============================================================

create or replace function public.before_user_created_domain_check(event jsonb)
returns jsonb
language plpgsql
stable
-- app_config はRLSで全拒否しているため、関数の所有者権限で読む必要がある
security definer
-- security definer は権限が強い。検索パスを固定し、同名の悪意ある関数・テーブルを
-- 先に解決されないようにする（中の参照はすべて完全修飾で書く）
set search_path = ''
as $$
declare
  allowed_domain text;
  email_domain   text;
begin
  select lower(btrim(c.value))
    into allowed_domain
    from public.app_config c
   where c.key = 'allowed_email_domain';

  -- 設定漏れは拒否側へ倒す（fail-closed）。
  -- 「未設定なら制限しない」にすると、設定を忘れただけで
  -- 社外アドレスの登録が素通りし、しかも誰も気付けない
  if allowed_domain is null or allowed_domain = '' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 500,
        'message', '登録設定が未完了のため登録できません。管理者へご連絡ください。'
      )
    );
  end if;

  -- event は { "user": { "email": "..." }, "metadata": {...} } の形で渡される
  email_domain := split_part(lower(coalesce(event -> 'user' ->> 'email', '')), '@', 2);

  -- 判定は完全一致。後方一致にすると evilcompany.co.jp のような
  -- 攻撃者が取得可能な別ドメインを通してしまう
  -- （src/lib/auth/emailDomain.ts と同じ考え方）
  if email_domain = '' or email_domain <> allowed_domain then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', '社内メールアドレスでのみ登録できます。'
      )
    );
  end if;

  -- 空オブジェクトを返すと登録が続行される
  return '{}'::jsonb;
end;
$$;

comment on function public.before_user_created_domain_check(jsonb) is
  'Supabase Auth の Before User Created Hook。社内メールドメイン以外のアカウント作成を拒否する';

-- ------------------------------------------------------------
-- 実行権限
--
-- フックを呼ぶのは Supabase Auth（supabase_auth_admin ロール）のみ。
-- 一般ユーザーが直接実行できる必要はないため、明示的に取り上げる
-- ------------------------------------------------------------
grant usage on schema public to supabase_auth_admin;
grant execute on function public.before_user_created_domain_check(jsonb) to supabase_auth_admin;

revoke execute on function public.before_user_created_domain_check(jsonb) from public;
revoke execute on function public.before_user_created_domain_check(jsonb) from anon;
revoke execute on function public.before_user_created_domain_check(jsonb) from authenticated;
