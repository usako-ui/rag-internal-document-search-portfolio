-- ============================================================
-- pgvector 拡張機能の有効化
--
-- 目的：document_chunks.embedding でベクトル型を扱い、
--       コサイン類似度による近傍検索（HNSWインデックス）を可能にする
--
-- 注意：Supabaseの推奨に従い public ではなく extensions スキーマへ導入する。
--       public スキーマへ拡張機能を入れるとセキュリティ警告の対象になるため。
--       以降のSQLでは `extensions.vector(768)` のように完全修飾で参照する。
-- ============================================================

create extension if not exists vector with schema extensions;
