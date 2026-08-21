-- ============================================================
-- 初期DBスキーマ：documents / document_chunks
--
-- 対応要件：requirements.md セクション7（実装境界の定義）
--
-- 【重要】このスキーマを変更できるのは 文書取り込み担当のみ。
--         検索API側・UI側は参照のみで、変更してはいけない。
-- ============================================================

-- ------------------------------------------------------------
-- documents：検索対象の社内文書（MVPはPDFのみ）
-- ------------------------------------------------------------
create table if not exists public.documents (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                        -- ファイル名
  file_path   text,                                 -- Supabase Storage のパス
  department  text,                                 -- 管轄部署（Phase 2アクセス制御に備えたメタデータ）
  status      text not null default 'processing',   -- processing / ready / error
  uploaded_at timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- 登録状態は3値に限定する
  -- （UI側の処理ステータス表示 F-07・文書一覧の登録状態 F-09 がこの値に依存するため、
  --   想定外の値が入ると画面表示が壊れる）
  constraint documents_status_check check (status in ('processing', 'ready', 'error'))
);

comment on table  public.documents            is '検索対象の社内文書。MVPではPDFのみを扱う';
comment on column public.documents.department is '管轄部署。MVPでは絞り込みに使用せず、Phase 2の部署別アクセス制御に備えて保持するメタデータ';
comment on column public.documents.status     is 'processing:処理中 / ready:検索可能 / error:エラー';

-- ------------------------------------------------------------
-- document_chunks：文書を分割したテキスト片とそのEmbedding
-- ------------------------------------------------------------
create table if not exists public.document_chunks (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  content     text not null,                        -- チャンクテキスト
  embedding   extensions.vector(768),               -- Gemini Embedding（768次元で確定）
  chunk_index int  not null,                        -- 文書内でのチャンク順序（0始まり）
  created_at  timestamptz not null default now()
);

comment on table  public.document_chunks             is '文書をチャンク分割したテキストとEmbeddingベクトル';
comment on column public.document_chunks.embedding   is 'Gemini Embeddingの出力（output_dimensionality=768 を明示指定すること。省略すると3072次元が返り不一致になる）';
comment on column public.document_chunks.chunk_index is '同一文書内でのチャンクの並び順。出典の参照箇所特定に使用する';

-- 同一文書内でチャンク順序が重複しないようにする
create unique index if not exists document_chunks_document_id_chunk_index_key
  on public.document_chunks (document_id, chunk_index);

-- 文書削除・文書単位の取得を高速化する
create index if not exists document_chunks_document_id_idx
  on public.document_chunks (document_id);

-- ベクトル類似検索用のHNSWインデックス（コサイン距離）
-- 補足：pgvectorのインデックスは最大2000次元までのため、768次元を採用している
create index if not exists document_chunks_embedding_idx
  on public.document_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

-- ------------------------------------------------------------
-- RLS（行レベルセキュリティ）の基本設定
--
-- 方針（セキュリティ要件）：
--   - 本格的な部署別アクセス制御は Phase 2。MVPでは「基本設定」のみ行う
--   - 未ログインユーザーは文書・チャンクを一切参照できない
--   - 書き込み（取り込み処理）はサーバーサイドで SUPABASE_SERVICE_ROLE_KEY を使う。
--     service_role は RLS を迂回するため、INSERT/UPDATE/DELETE ポリシーは意図的に作成しない
--
-- これを外すと anon キーだけで社内文書が読める状態になり、
-- クライアントの最重要要件「社外への情報漏洩を避ける」に反する。
-- ------------------------------------------------------------
alter table public.documents       enable row level security;
alter table public.document_chunks enable row level security;

drop policy if exists "authenticated_can_select_documents" on public.documents;
create policy "authenticated_can_select_documents"
  on public.documents
  for select
  to authenticated
  using (true);

drop policy if exists "authenticated_can_select_document_chunks" on public.document_chunks;
create policy "authenticated_can_select_document_chunks"
  on public.document_chunks
  for select
  to authenticated
  using (true);
