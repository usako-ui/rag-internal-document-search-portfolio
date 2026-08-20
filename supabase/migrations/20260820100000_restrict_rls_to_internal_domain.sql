-- ============================================================
-- RLSを社内メールドメインに限定する（Phase DEL・QAレビュー HIGH-1）
--
-- 対応要件：CLAUDE.md セクション7「社外への情報漏洩を絶対に避ける」/ 要件F-06
--
-- 【修正前に何が起きていたか】
-- documents / document_chunks のSELECTポリシーは `to authenticated using (true)` で、
-- 「Supabaseにログイン済みなら誰でも全文書を読める」状態だった。
--
-- 社内メールドメイン制限（ALLOWED_EMAIL_DOMAIN）は Next.js の Middleware と
-- 各API Routeにしか無く、**Supabaseへ直接アクセスされると一切効かない**。
-- anonキーは NEXT_PUBLIC_ でブラウザへ配られる公開値なので、
--
--   1. 攻撃者が任意のアドレス（例：attacker@gmail.com）でSupabaseへ直接サインアップし
--   2. 確認メールを自分で開いて認証済みトークンを取得し
--   3. https://<project>.supabase.co/rest/v1/document_chunks?select=* を直接叩く
--
-- という手順で、このアプリを一度も経由せずに社内文書の全文を取得できた。
-- 実際に社外ドメインのJWTでSELECTを試したところ、全5文書が読めることを確認済み。
--
-- 【この修正の方針】
-- ドメイン判定をDB側（RLS）にも置き、アプリを経由しない経路も塞ぐ。
-- 判定に使うドメインは public.app_config に保持し、
-- SECURITY DEFINER 関数 public.is_internal_user() から参照する。
--
-- アプリ側（Middleware・各API）のドメイン検証は残す。
-- どちらか一方が壊れても社内文書へ到達できないようにするため（多層防御）。
-- ============================================================

-- ------------------------------------------------------------
-- app_config：サーバー側だけが読む設定値の置き場
--
-- ポリシーを1つも作らないことで、anon・authenticated からは読めない
-- （RLS有効かつポリシー無し＝全拒否）。service_role のみが読み書きできる。
-- 許可ドメインを利用者に読ませないためにこの形にしている。
-- ------------------------------------------------------------
create table if not exists public.app_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

comment on table public.app_config is
  'サーバー側だけが参照する設定値。RLSでanon・authenticatedからの読み取りを全拒否している';

alter table public.app_config enable row level security;

-- ------------------------------------------------------------
-- 許可ドメインの初期値
--
-- 【重要】ここはシークレットではなくクライアントの社内ドメイン。
-- 環境変数 ALLOWED_EMAIL_DOMAIN と**必ず同じ値**にすること。
-- 値を変えるときは `npm run sync:allowed-domain` を実行する
-- （.env.local の ALLOWED_EMAIL_DOMAIN をこの表へ反映するスクリプト）。
--
-- 初期値を入れずに空のままにすると、この修正を適用した瞬間に
-- 全社員が文書を読めなくなるため、既存の設定値を初期値として登録する。
-- ------------------------------------------------------------
insert into public.app_config (key, value)
values ('allowed_email_domain', 'techbridge.co.jp')
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- is_internal_user()：ログイン中のユーザーが社内ドメインかを判定する
--
-- security definer にする理由：
--   app_config はRLSで全拒否しているため、呼び出したユーザーの権限では読めない。
--   関数の所有者権限で読ませる必要がある。
--
-- set search_path = '' にする理由：
--   security definer 関数は権限が強いため、検索パスを固定しないと
--   同名の悪意ある関数・テーブルを先に解決させられる恐れがある。
--   そのため中の参照はすべて完全修飾（public. / auth.）で書く。
--
-- 判定は完全一致。`endsWith` 相当の後方一致にすると
-- eviltechbridge.co.jp のような別ドメインを通してしまう
-- （src/lib/auth/emailDomain.ts と同じ考え方）。
--
-- 設定が無い・空・メールにドメインが無い場合はすべて false（fail-closed）。
-- ------------------------------------------------------------
create or replace function public.is_internal_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_config c
    where c.key = 'allowed_email_domain'
      and btrim(c.value) <> ''
      and split_part(lower(coalesce(auth.jwt() ->> 'email', '')), '@', 2) <> ''
      and split_part(lower(coalesce(auth.jwt() ->> 'email', '')), '@', 2) = lower(btrim(c.value))
  );
$$;

comment on function public.is_internal_user() is
  'JWTのメールアドレスが app_config.allowed_email_domain と完全一致するかを返す。RLSポリシーから使う';

-- 判定関数は認証済みユーザーとサーバーからのみ実行できればよい
revoke all on function public.is_internal_user() from public;
grant execute on function public.is_internal_user() to authenticated;
grant execute on function public.is_internal_user() to service_role;

-- ------------------------------------------------------------
-- documents / document_chunks のSELECTポリシーを差し替える
--
-- 旧ポリシー（using (true)）は必ず削除すること。
-- 残したままだとポリシーはOR結合され、新しい制限が意味を持たない。
-- ------------------------------------------------------------
drop policy if exists "authenticated_can_select_documents" on public.documents;
drop policy if exists "internal_users_can_select_documents" on public.documents;
create policy "internal_users_can_select_documents"
  on public.documents
  for select
  to authenticated
  using (public.is_internal_user());

drop policy if exists "authenticated_can_select_document_chunks" on public.document_chunks;
drop policy if exists "internal_users_can_select_document_chunks" on public.document_chunks;
create policy "internal_users_can_select_document_chunks"
  on public.document_chunks
  for select
  to authenticated
  using (public.is_internal_user());

-- match_chunks は security invoker（呼び出したユーザーの権限で動く）ため、
-- 上記ポリシーがそのまま効く。RPCを直接叩かれても社外ドメインには0件が返る。
