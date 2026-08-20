-- ============================================================
-- document_chunks に出典情報のカラムを追加
--
-- 対応タスク：TA-05（TA-10の前提）
-- 対応要件：F-04（出典表示）・requirements.md セクション7のAPI仕様
--
-- 追加理由：
--   `POST /api/chat` のレスポンス citations は page と section を返す仕様だが、
--   初期スキーマ（20260817000200）には出典のページ番号を保持するカラムが無く、
--   仕様どおりの出典を返せなかったため追加する。
--
--   {"document_name": "リモートワーク規程", "page": "p.3", "section": "第3条", ...}
--
-- 【重要】このスキーマを変更できるのは Worktree A（Agent A）のみ。
-- ============================================================

alter table public.document_chunks
  add column if not exists page_number int,
  add column if not exists section text;

comment on column public.document_chunks.page_number is
  '出典のページ番号（1始まり）。APIレスポンスの citations.page に使用する';
comment on column public.document_chunks.section is
  'チャンク内の最初の見出し（例：第3条（在宅勤務手当））。APIレスポンスの citations.section に使用する';

-- 出典を特定する検索で使うためインデックスを張る
create index if not exists document_chunks_page_number_idx
  on public.document_chunks (document_id, page_number);
