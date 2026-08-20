/**
 * アップロード処理の段階（F-07）
 *
 * requirements.md F-07 は以下4段階の表示を必須としている。
 *
 *   アップロード済み → テキスト抽出中 → 検索用データを作成中 → 検索可能
 *
 * 【段階と実処理の対応】
 * DBの `documents.status` は processing / ready / error の3値しか持たない。
 * そのため4段階は「サーバー側の実際の進行イベント」に対応付けて判定している。
 *
 * | 段階 | 判定に使う実イベント | サーバー側で起きていること |
 * |---|---|---|
 * | 送信中           | XHRのアップロード進捗 < 100% | ブラウザがPDFを送信中 |
 * | アップロード済み | XHRの送信完了イベント        | サーバーがファイルを受領 |
 * | テキスト抽出中   | 送信完了〜202レスポンス受領   | `prepareDocument`（PDF解析）実行中 |
 * | 検索用データを作成中 | 202レスポンス受領後       | `buildDocumentIndex`（チャンク化・Embedding）実行中 |
 * | 検索可能         | GET /api/documents で status=ready | 取り込み完了 |
 *
 * 時間経過で段階を「それらしく」進めているのではなく、
 * すべて実際の通信イベントを根拠にしている（推測表示にしないため）。
 */

export type UploadStage =
  | 'uploading' // 送信中
  | 'uploaded' // アップロード済み
  | 'extracting' // テキスト抽出中
  | 'indexing' // 検索用データを作成中
  | 'ready' // 検索可能
  | 'error'; // エラー

/**
 * 段階の進行順。`error` は順序を持たない（どの段階からでも遷移しうる）ため含めない。
 * この配列の順序で1段ずつ進めることで、処理が速すぎても段階が飛ばされない。
 */
export const UPLOAD_STAGE_ORDER: readonly UploadStage[] = [
  'uploading',
  'uploaded',
  'extracting',
  'indexing',
  'ready',
] as const;

/** 利用者へ表示する段階ラベル。内部の英語値をそのまま画面に出さないこと */
export const UPLOAD_STAGE_LABEL: Record<UploadStage, string> = {
  uploading: '送信中',
  uploaded: 'アップロード済み',
  extracting: 'テキスト抽出中',
  indexing: '検索用データを作成中',
  ready: '検索可能',
  error: 'エラー',
};

/** 進行状況バーの表示位置（％）。段階が進んでいることを視覚でも伝える */
export const UPLOAD_STAGE_PROGRESS: Record<UploadStage, number> = {
  uploading: 15,
  uploaded: 35,
  extracting: 60,
  indexing: 85,
  ready: 100,
  error: 100,
};

/** アップロード1件分の状態 */
export type UploadJob = {
  /** UI内での識別子（DBのidとは別。アップロード開始時点ではdocument_idが未確定のため） */
  id: string;
  fileName: string;
  /** 送信の進捗（0〜100）。stage が uploading のときのみ意味を持つ */
  progress: number;
  stage: UploadStage;
  /** POST /api/documents が返した documents.id。202受領後に設定される */
  documentId: string | null;
  /** stage が error のときに表示する具体的なメッセージ（F-07：原因と次の行動を示す） */
  errorMessage: string | null;
  /** 既存文書の更新操作から始まったジョブなら対象の文書名（F-08）。新規アップロードは null */
  replacesDocumentName: string | null;
};

/** 段階が完了・失敗して、これ以上変化しない状態か */
export function isUploadJobFinished(job: UploadJob): boolean {
  return job.stage === 'ready' || job.stage === 'error';
}
