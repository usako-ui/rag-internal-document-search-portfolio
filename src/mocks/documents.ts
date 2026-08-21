import type { DocumentSummary } from '@/types/api';

/**
 * 文書一覧のモックデータ
 *
 * 【重要】GET /api/documents のレスポンス型（DocumentSummary[]）と完全に同じ形にすること。
 * 実装完了後に実APIへ差し替える。
 *
 * 内容は project-overview.md セクション8のサンプル5文書に合わせている。
 * status は3種類（ready / processing / error）すべてを含め、
 * 状態表示のUIが全パターンで確認できるようにしている。
 */
export const mockDocuments: DocumentSummary[] = [
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: '経費精算マニュアル.pdf',
    department: '経理部',
    status: 'ready',
    uploaded_at: '2026-08-16T10:15:00Z',
  },
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'リモートワーク規程.pdf',
    department: '人事部・情報システム部',
    status: 'ready',
    uploaded_at: '2026-08-15T14:22:00Z',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: '情報セキュリティ規程.pdf',
    department: '情報システム部',
    status: 'processing',
    uploaded_at: '2026-08-15T09:30:00Z',
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    name: '就業規則.pdf',
    department: '人事部',
    status: 'ready',
    uploaded_at: '2026-08-14T16:40:00Z',
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    name: '社内ITツール申請ガイド.pdf',
    department: '情報システム部',
    status: 'error',
    uploaded_at: '2026-08-13T11:05:00Z',
  },
];
