-- ============================================================
-- user_settings：利用者ごとの表示・検索設定
--
-- 対応タスク：TE-09（納品前改善フェーズ STEP 2-4）
-- 対応画面　：設定画面 /settings
--
-- 【重要】このスキーマを変更できるのは Worktree A（Agent A）のみ。
--
-- 【設計方針】
-- 1ユーザー1行とし、user_id を主キーにする。
-- 「設定が無い＝初期値」として扱うため、行が無くても画面が成立する設計にしている
-- （ログインしただけのユーザーに空行を作らない）。
--
-- 【類似度閾値を設定項目に含めない理由（Q-38）】
-- 閾値はハルシネーション抑制の要であり、クライアントの最重要要件に直結する。
-- Phase VALの実測では文書外の質問の最高類似度が0.646、文書ありの最小が0.677で、
-- 閾値を0.55まで下げると文書外の質問が検索を通過してしまう。
-- 利用者が個別に変更できてはならないため、0.62固定（コード側の定数）とし、
-- このテーブルには持たせない（2026-08-18 決定）。
-- ============================================================

create table if not exists public.user_settings (
  -- 1ユーザー1行。ユーザー削除時は設定も消す
  user_id       uuid primary key references auth.users(id) on delete cascade,

  -- 表示言語。UIの表示切り替えに使う
  language      text not null default 'ja',

  -- 質問履歴画面で一度に表示する件数
  history_limit int  not null default 20,

  -- 回答の長さの目安。回答生成プロンプトの指示に反映する
  answer_length text not null default 'standard',

  -- 検索で取得するチャンク数（match_count）。多いほど材料は増えるが無関係な文脈も混ざる
  match_count   int  not null default 5,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- 画面の選択肢以外の値が入ると、UIが選択状態を復元できなくなるため制約で縛る
  constraint user_settings_language_check      check (language in ('ja', 'en')),
  constraint user_settings_history_limit_check check (history_limit in (10, 20, 50)),
  constraint user_settings_answer_length_check check (answer_length in ('short', 'standard', 'detailed')),
  constraint user_settings_match_count_check   check (match_count in (3, 5, 10))
);

comment on table  public.user_settings               is '利用者ごとの表示・検索設定。行が無い場合は既定値として扱う';
comment on column public.user_settings.language      is 'ja:日本語 / en:英語';
comment on column public.user_settings.history_limit is '質問履歴画面の表示件数（10 / 20 / 50）';
comment on column public.user_settings.answer_length is 'short:短め / standard:標準 / detailed:詳しく。回答生成プロンプトへ反映する';
comment on column public.user_settings.match_count   is '検索で取得するチャンク数（3 / 5 / 10）。類似度閾値は安全のため設定項目に含めない（Q-38）';

-- ------------------------------------------------------------
-- RLS：自分の設定のみ読み書きできる
--
-- 他人の設定を読み書きできると、検索件数を勝手に変えられるなどの影響が出るため、
-- documents（全認証ユーザーが閲覧可）とは別扱いで user_id により厳密に絞る。
--
-- DELETE ポリシーは作成しない。
-- 設定を初期値へ戻す操作は「既定値でのUPDATE」で表現でき、行を消す必要がないため。
-- ------------------------------------------------------------
alter table public.user_settings enable row level security;

drop policy if exists "users_can_select_own_settings" on public.user_settings;
create policy "users_can_select_own_settings"
  on public.user_settings
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "users_can_insert_own_settings" on public.user_settings;
create policy "users_can_insert_own_settings"
  on public.user_settings
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- using（既存行を見てよいか）と with check（更新後の行を書いてよいか）の両方が必要。
-- with check が無いと、更新時に user_id を他人へ書き換えられてしまう
drop policy if exists "users_can_update_own_settings" on public.user_settings;
create policy "users_can_update_own_settings"
  on public.user_settings
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ------------------------------------------------------------
-- updated_at の自動更新
-- アプリ側で入れ忘れても必ず更新日時が残るようにする
-- ------------------------------------------------------------
create or replace function public.set_user_settings_updated_at()
returns trigger
language plpgsql
-- 検索パスを固定し、悪意あるスキーマの関数が呼ばれないようにする
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row
  execute function public.set_user_settings_updated_at();
