-- ============================================================
-- match_chunks：ベクトル類似検索のRPC関数
--
-- 対応要件：F-02（ベクトル検索）・F-04（出典表示）
--
-- 【重要】この関数は 検索API側が呼び出す。
--         シグネチャ・戻り値を変更する場合は必ず 検索API側へ共有すること。
--
-- 呼び出し例（supabase-js）:
--   const { data } = await supabase.rpc('match_chunks', {
--     query_embedding: JSON.stringify(queryVector),  -- 768次元
--     match_threshold: 0.62,
--     match_count: 5,
--   });
--
-- 設計意図：
--   出典表示に必要な文書名・ページ番号・参照箇所をこの関数で一緒に返す。
--   検索API側が documents テーブルを別途引く必要がなくなり、
--   往復が1回で済む（回答生成の10秒以内という性能要件に効く）。
-- ============================================================

create or replace function public.match_chunks(
  query_embedding extensions.vector(768),
  match_threshold float default 0.62,
  match_count int default 5
)
returns table (
  chunk_id uuid,
  document_id uuid,
  document_name text,
  department text,
  content text,
  chunk_index int,
  page_number int,
  section text,
  similarity float
)
language sql
stable
-- 検索は認証済みユーザーの操作として実行するため security invoker（既定）のまま。
-- RLSが効き、未ログインでは結果が返らない。
set search_path = public, extensions
as $$
  select
    c.id as chunk_id,
    c.document_id,
    d.name as document_name,
    d.department,
    c.content,
    c.chunk_index,
    c.page_number,
    c.section,
    -- コサイン距離（<=>）を類似度へ変換する。1に近いほど類似
    1 - (c.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  where
    c.embedding is not null
    -- 取り込み処理中・失敗した文書は検索対象にしない
    and d.status = 'ready'
    and 1 - (c.embedding operator(extensions.<=>) query_embedding) >= match_threshold
  order by c.embedding operator(extensions.<=>) query_embedding
  limit match_count;
$$;

comment on function public.match_chunks is
  '質問ベクトルに近いチャンクを類似度順で返す。出典表示に必要な文書名・ページ番号・参照箇所を含む。検索API側の /api/chat が使用する';

-- 認証済みユーザーのみ実行できるようにする（未ログインからの検索を防ぐ）
revoke all on function public.match_chunks(extensions.vector(768), float, int) from public;
grant execute on function public.match_chunks(extensions.vector(768), float, int) to authenticated;
grant execute on function public.match_chunks(extensions.vector(768), float, int) to service_role;
