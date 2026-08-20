/**
 * API型定義
 *
 * requirements.md セクション7 / agent-brief.md「5. API仕様」に厳密に一致させること。
 * Worktree B・A が実装するレスポンスとこの型がずれると、
 * モックから実APIへ差し替えたときに手戻りが発生する。
 *
 * 【重要】この型を勝手に変更しないこと。変更が必要な場合は3Agent全員へ共有し、
 * requirements.md の変更履歴を更新すること。
 */

// ────────────────────────────────
// POST /api/chat
// ────────────────────────────────

/**
 * 回答の根拠となった出典1件
 *
 * 【Q-25（2026-08-17 Worktree B確定）】
 * `page` / `section` は PDF から取得できないことがあり null が返る。
 * 「p.」だけのラベルや空の参照箇所を出さないよう、null の項目は表示しないこと。
 */
export type Citation = {
  /** 文書名（例：リモートワーク規程）。必ず値がある */
  document_name: string;
  /** ページ番号（例：p.3）。取得できない場合は null */
  page: string | null;
  /** 参照箇所（例：第3条）。取得できない場合は null */
  section: string | null;
  /** documents.id */
  document_id: string;
  /**
   * 回答の根拠になった該当箇所の本文（Phase ENH TE-06で追加）。
   *
   * 出典クリック時のモーダルで「どの記述を根拠にしたのか」を原文で示すために使う。
   * 追加のみの変更のため、既存の表示（出典ラベル・関連文書カード）には影響しない。
   */
  content: string;
};

/** POST /api/chat のリクエストボディ */
export type ChatRequest = {
  question: string;
};

/** POST /api/chat の正常レスポンス */
export type ChatResponse = {
  /** 回答本文。該当情報がない場合は「該当する情報を社内文書から確認できませんでした。」 */
  answer: string;
  /** 出典一覧。該当情報がない場合は空配列 */
  citations: Citation[];
  /** 社内文書を根拠に回答できたかどうか。false の場合はUIで出典エリアを表示しない */
  has_answer: boolean;
};

// ────────────────────────────────
// /api/documents
// ────────────────────────────────

/** 文書の登録状態（DBの documents.status と一致させる） */
export type DocumentStatus = 'processing' | 'ready' | 'error';

/** GET /api/documents のレスポンス要素 */
export type DocumentSummary = {
  id: string;
  /** ファイル名（例：就業規則.pdf） */
  name: string;
  /** 管轄部署。MVPでは表示のみに使用する */
  department: string | null;
  status: DocumentStatus;
  /** ISO8601形式の日時文字列 */
  uploaded_at: string;
};

/** POST /api/documents のレスポンス */
export type UploadDocumentResponse = {
  document_id: string;
  status: DocumentStatus;
};

// ────────────────────────────────
// /api/histories
// ────────────────────────────────

/**
 * 質問履歴1件（GET /api/histories のレスポンス要素）
 *
 * 本人の履歴のみが返る（RLSで user_id により絞り込まれる）。
 */
export type ChatHistory = {
  id: string;
  question: string;
  answer: string;
  /** 回答時の出典。該当なしだった場合は空配列 */
  citations: Citation[];
  /** ISO8601形式の日時文字列 */
  created_at: string;
};

/** POST /api/histories のリクエストボディ */
export type CreateChatHistoryRequest = {
  question: string;
  answer: string;
  citations: Citation[];
};

// ────────────────────────────────
// /api/settings
// ────────────────────────────────

/** 質問履歴画面の表示件数 */
export type SettingHistoryLimit = 10 | 20 | 50;

/** 回答の長さの目安 */
export type SettingAnswerLength = 'short' | 'standard' | 'detailed';

/** 検索で取得するチャンク数 */
export type SettingMatchCount = 3 | 5 | 10;

/**
 * 利用者ごとの設定（GET/PUT /api/settings）
 *
 * 【類似度閾値を含めない理由（Q-38・2026-08-18 決定）】
 * 閾値はハルシネーション抑制の要であり、利用者が変更できてはならない。
 * 0.62固定（`SIMILARITY_THRESHOLD`）とし、設定項目に含めない。
 *
 * 【表示言語を含めない理由（Q-40・2026-08-18 決定）】
 * UIの英語化（i18n）が未実装のため、選んでも表示が変わらず利用者への誤案内になる。
 * 日本語のみ対応とし、設定項目から削除した。
 */
export type UserSettings = {
  history_limit: SettingHistoryLimit;
  answer_length: SettingAnswerLength;
  match_count: SettingMatchCount;
};

// ────────────────────────────────
// 共通
// ────────────────────────────────

/** APIのエラーレスポンス（例：「回答の取得に失敗しました。もう一度お試しください。」） */
export type ApiErrorResponse = {
  error: string;
};
