-- ============================================================
-- chat_histories / user_settings のRLSを社内メールドメインに限定する
--
-- 対応：セキュリティレビューの指摘（MEDIUM）
-- 前提：20260820100000_restrict_rls_to_internal_domain.sql
--       （public.is_internal_user() と public.app_config を作成済み）
--
-- 【修正前の状態】
-- 両テーブルのポリシーは `auth.uid() = user_id` のみだった。
-- 「本人の行しか触れない」という点は満たしているため、
-- 他人の履歴が読まれる・社内文書が漏れるといった事故は起きない。
--
-- 一方で、社外ドメインのアカウント（Supabaseへ直接サインアップしたもの）でも
-- 自分用の履歴・設定の行を作成できてしまう。
-- documents / document_chunks は 20260820100000 で社内ドメインに限定済みなので
-- 文書は読めないが、利用資格の無いアカウントのデータがDBに残り続ける。
--
-- 【この修正の方針】
-- 既存条件（本人の行であること）に、社内ドメインであることをAND条件で追加する。
-- 「本人であること」と「社内の人であること」は別の条件なので、両方を要求する。
--
-- 【既存データへの影響】
-- 社内ドメインの利用者の履歴・設定は、これまでどおり読み書きできる（条件が増えるだけ）。
-- ALLOWED_EMAIL_DOMAIN を変更した場合は `npm run sync:allowed-domain` の実行が必要。
-- 実行しないと app_config が古い値のままとなり、
-- 全利用者が履歴・設定を読めなくなる（fail-closed）。
-- ============================================================

-- ------------------------------------------------------------
-- chat_histories
--
-- UPDATEポリシーは引き続き作成しない。
-- 履歴は「いつ何を聞いたか」の記録であり、後から書き換えられるべきではないため。
-- ------------------------------------------------------------
drop policy if exists "users_can_select_own_chat_histories" on public.chat_histories;
create policy "users_can_select_own_chat_histories"
  on public.chat_histories
  for select
  to authenticated
  using ((select auth.uid()) = user_id and public.is_internal_user());

drop policy if exists "users_can_insert_own_chat_histories" on public.chat_histories;
create policy "users_can_insert_own_chat_histories"
  on public.chat_histories
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id and public.is_internal_user());

drop policy if exists "users_can_delete_own_chat_histories" on public.chat_histories;
create policy "users_can_delete_own_chat_histories"
  on public.chat_histories
  for delete
  to authenticated
  using ((select auth.uid()) = user_id and public.is_internal_user());

-- ------------------------------------------------------------
-- user_settings
--
-- UPDATEは using（既存行を見てよいか）と with check（更新後の行を書いてよいか）の
-- 両方に条件が必要。with check を欠くと、更新時に user_id を他人へ書き換えられる。
-- ------------------------------------------------------------
drop policy if exists "users_can_select_own_settings" on public.user_settings;
create policy "users_can_select_own_settings"
  on public.user_settings
  for select
  to authenticated
  using ((select auth.uid()) = user_id and public.is_internal_user());

drop policy if exists "users_can_insert_own_settings" on public.user_settings;
create policy "users_can_insert_own_settings"
  on public.user_settings
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id and public.is_internal_user());

drop policy if exists "users_can_update_own_settings" on public.user_settings;
create policy "users_can_update_own_settings"
  on public.user_settings
  for update
  to authenticated
  using ((select auth.uid()) = user_id and public.is_internal_user())
  with check ((select auth.uid()) = user_id and public.is_internal_user());
