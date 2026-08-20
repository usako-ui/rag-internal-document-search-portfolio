-- ============================================================
-- chat_histories：質問履歴
--
-- 対応タスク：TE-01（納品前改善フェーズ STEP 1-1）
-- 対応画面　：質問履歴画面 /histories（CLAUDE.md セクション10 サイドバー）
--
-- 【重要】このスキーマを変更できるのは Worktree A（Agent A）のみ。
--         Worktree B・C は参照のみで、変更してはいけない。
--
-- 【設計方針】
-- 質問履歴は「誰が何を聞いたか」が残る個人情報性の高いデータのため、
-- 他人の履歴が絶対に見えないよう RLS を user_id で厳密に縛る。
-- documents（全認証ユーザーが閲覧可）とは異なる扱いにしている。
-- ============================================================

create table if not exists public.chat_histories (
  id         uuid primary key default gen_random_uuid(),
  -- 質問した本人。ユーザー削除時は履歴も一緒に消す（個人データを残さない）
  user_id    uuid not null references auth.users(id) on delete cascade,
  question   text not null,
  answer     text not null,
  -- POST /api/chat が返す citations をそのまま保存する。
  -- 出典は0件（該当なし）もあり得るため、既定値を空配列にする
  citations  jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

comment on table  public.chat_histories           is '利用者ごとの質問・回答履歴。本人以外は参照できない';
comment on column public.chat_histories.user_id   is 'auth.users.id。RLSの絞り込みキー';
comment on column public.chat_histories.citations is 'POST /api/chat のcitationsをそのまま保持したJSON配列。該当なしの場合は空配列';

-- 履歴一覧は「本人の履歴を新しい順」で取得するため、その形の複合インデックスを張る
create index if not exists chat_histories_user_id_created_at_idx
  on public.chat_histories (user_id, created_at desc);

-- ------------------------------------------------------------
-- RLS：自分の履歴のみ読み書きできる
--
-- using       … 既存行を「見てよいか」の条件（SELECT・DELETE で評価される）
-- with check  … 新しい行が「書き込んでよいか」の条件（INSERT・UPDATE で評価される）
--
-- INSERT側に with check を付けないと、他人の user_id を詐称した履歴を
-- 書き込めてしまうため必須。
--
-- UPDATE ポリシーは意図的に作成しない。
-- 履歴は「いつ何を聞いたか」の記録であり、後から書き換えられるべきではないため。
-- ------------------------------------------------------------
alter table public.chat_histories enable row level security;

drop policy if exists "users_can_select_own_chat_histories" on public.chat_histories;
create policy "users_can_select_own_chat_histories"
  on public.chat_histories
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "users_can_insert_own_chat_histories" on public.chat_histories;
create policy "users_can_insert_own_chat_histories"
  on public.chat_histories
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "users_can_delete_own_chat_histories" on public.chat_histories;
create policy "users_can_delete_own_chat_histories"
  on public.chat_histories
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
