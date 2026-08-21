import type { DocumentSummary, UploadDocumentResponse } from '@/types/api';

/**
 * 文書APIのクライアント
 *
 * 呼び出し先は 文書取り込み側が実装した以下の2エンドポイント。
 * 仕様は requirements.md セクション7で確定済みのため、
 * リクエスト・レスポンスの形をここで勝手に変えないこと。
 *
 *   POST   /api/documents … multipart/form-data（フィールド名 `file`）→ { document_id, status }
 *   GET    /api/documents … DocumentSummary[]
 *   DELETE /api/documents?id=… → { document_id, deleted: true }
 *
 * 【エラー方針（F-07）】
 * 「アップロードに失敗しました」だけで終わらせない。
 * サーバーが返す `error` は利用者向けに書かれた具体的なメッセージなのでそのまま表示し、
 * サーバーへ到達できなかった場合はこのファイル側で原因と次の行動を補って返す。
 */

/** APIのエンドポイント。パスを各所へ散らさないためここで一元管理する */
const DOCUMENTS_ENDPOINT = '/api/documents';

/**
 * 文書一覧の絞り込み条件。
 * 空文字・未指定は「絞り込みなし」を意味する。
 */
export type DocumentFilters = {
  /** 管轄部署。部分一致でサーバー側が絞り込む */
  department?: string;
  /** 文書名のキーワード。部分一致・大文字小文字を区別しない */
  keyword?: string;
};

/**
 * 絞り込み条件付きの取得URLを組み立てる。
 *
 * 値が空のパラメータは付けない（`?department=` のような空条件を送ると、
 * サーバー側の「未指定＝絞り込みなし」判定に無駄な分岐を持ち込むため）。
 */
function buildDocumentsUrl(filters: DocumentFilters): string {
  const params = new URLSearchParams();

  const department = filters.department?.trim() ?? '';
  const keyword = filters.keyword?.trim() ?? '';

  if (department.length > 0) params.set('department', department);
  if (keyword.length > 0) params.set('keyword', keyword);

  const query = params.toString();
  return query.length > 0 ? `${DOCUMENTS_ENDPOINT}?${query}` : DOCUMENTS_ENDPOINT;
}

/** multipart/form-data のフィールド名（文書取り込み側の route.ts と一致させること） */
const FILE_FIELD_NAME = 'file';

/** 差し替え対象の文書IDを送るフィールド名（サーバー側 route.ts と一致させること） */
const REPLACE_FIELD_NAME = 'document_id';

/** アップロード可能な最大サイズ（50MB・requirements.md F-07） */
export const MAX_PDF_SIZE_BYTES = 50 * 1024 * 1024;

/**
 * 利用者へそのまま表示してよいメッセージを持つエラー。
 *
 * 通常の `Error.message` は内部事情（スタック・URL等）を含みうるため、
 * 画面表示には必ず `userMessage` を使うこと。
 */
export class DocumentApiError extends Error {
  readonly userMessage: string;

  constructor(userMessage: string, options?: { cause?: unknown }) {
    super(userMessage, options);
    this.name = 'DocumentApiError';
    this.userMessage = userMessage;
  }
}

/**
 * 送信前にブラウザ側で判定できる問題を返す（問題がなければ null）。
 *
 * サーバーでも同じ検証を行っているが、50MBのファイルを送りきってから
 * 「サイズ超過です」と言われるのは待ち時間が無駄になるため、手前で弾く。
 */
export function validatePdfFile(file: File): string | null {
  const isPdf =
    file.name.toLowerCase().endsWith('.pdf') || file.type.toLowerCase() === 'application/pdf';

  if (!isPdf) {
    return `PDF以外のファイルはアップロードできません（${file.name}）。拡張子が .pdf のファイルを選択してください。`;
  }

  if (file.size === 0) {
    return '選択したファイルが空です。内容のあるPDFを選択してください。';
  }

  if (file.size > MAX_PDF_SIZE_BYTES) {
    const actualMb = (file.size / 1024 / 1024).toFixed(1);
    return `ファイルサイズが50MBを超えています（${actualMb}MB）。ファイルを分割してからアップロードしてください。`;
  }

  return null;
}

/** どの操作で起きたエラーかによって文面を変えるための区分 */
type ErrorContext = 'upload' | 'list' | 'delete';

/**
 * JSONで返らなかった応答（HTMLのエラーページ等）を、利用者向けメッセージへ変換する。
 * HTTPステータスごとに「次に何をすればよいか」を変える。
 */
function buildFallbackErrorMessage(status: number, context: ErrorContext): string {
  const action =
    context === 'upload' ? 'アップロード' : context === 'delete' ? '文書の削除' : '文書一覧の取得';

  if (status === 401 || status === 403) {
    return `ログインの有効期限が切れている可能性があります。再度ログインしてから${action}をお試しください。`;
  }

  if (status === 413) {
    return 'ファイルサイズが50MBを超えています。ファイルを分割してからアップロードしてください。';
  }

  if (status === 404) {
    return `${action}の接続先が見つかりませんでした（404）。管理者へご連絡ください。`;
  }

  return `${action}に失敗しました（サーバー応答：${status}）。時間をおいてもう一度お試しください。`;
}

/** レスポンスボディから利用者向けメッセージを取り出す。JSONでなければステータスから補う */
function extractErrorMessage(rawBody: string, status: number, context: ErrorContext): string {
  try {
    const parsed = JSON.parse(rawBody) as { error?: unknown };
    if (typeof parsed.error === 'string' && parsed.error.length > 0) {
      // サーバー側（文書取り込み側）が利用者向けに用意したメッセージをそのまま使う
      return parsed.error;
    }
  } catch {
    // JSONでない場合はステータスから組み立てる（下へ抜ける）
  }

  return buildFallbackErrorMessage(status, context);
}

type UploadOptions = {
  /** 送信の進捗（0〜100）が変わるたびに呼ばれる */
  onProgress?: (percent: number) => void;
  /**
   * ファイルの送信が完了した時点で呼ばれる（サーバーの応答を待つ前）。
   * この瞬間からサーバー側のテキスト抽出が始まるため、段階表示の起点に使う（F-07）。
   */
  onUploadComplete?: () => void;
  /**
   * 差し替える対象の文書ID（資料更新 F-08）。
   *
   * 文書管理画面の「更新」から呼ぶときに渡す。
   * 渡さない場合、サーバーは「PDFの1行目から推定した文書名」が一致する
   * 既存文書だけを置き換えるため、改訂でタイトル行が変わると旧版が残ってしまう。
   */
  replacesDocumentId?: string | null;
};

/**
 * POST /api/documents
 *
 * fetch ではなく XMLHttpRequest を使っている。
 * fetch は「ファイルを送り終えた瞬間」を検知できず、F-07の
 * 「アップロード済み → テキスト抽出中」の切り替えを実イベントで判定できないため。
 */
export function uploadDocument(file: File, options: UploadOptions = {}): Promise<UploadDocumentResponse> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append(FILE_FIELD_NAME, file);

    // 更新対象が指定されている場合のみ送る（新規アップロードでは付けない）
    if (options.replacesDocumentId) {
      formData.append(REPLACE_FIELD_NAME, options.replacesDocumentId);
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', DOCUMENTS_ENDPOINT);
    // 認証Cookieを送る（認証Middleware導入後に必要）
    xhr.withCredentials = true;

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      options.onProgress?.(Math.round((event.loaded / event.total) * 100));
    };

    // ファイルの送信完了。ここから先はサーバー側の処理時間になる
    xhr.upload.onload = () => {
      options.onProgress?.(100);
      options.onUploadComplete?.();
    };

    xhr.onload = () => {
      // 202 Accepted（受理・処理は継続中）が正常系。200も許容する
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new DocumentApiError(extractErrorMessage(xhr.responseText, xhr.status, 'upload')));
        return;
      }

      try {
        const parsed = JSON.parse(xhr.responseText) as UploadDocumentResponse;

        if (typeof parsed.document_id !== 'string') {
          throw new Error('document_id がレスポンスに含まれていません');
        }

        resolve(parsed);
      } catch (error) {
        reject(
          new DocumentApiError(
            'サーバーからの応答を解釈できませんでした。時間をおいてもう一度お試しください。',
            { cause: error }
          )
        );
      }
    };

    xhr.onerror = () => {
      reject(
        new DocumentApiError(
          'サーバーへ接続できませんでした。ネットワーク接続を確認して、もう一度お試しください。'
        )
      );
    };

    xhr.onabort = () => {
      reject(new DocumentApiError('アップロードを中止しました。'));
    };

    xhr.send(formData);
  });
}

/**
 * GET /api/documents
 *
 * 取り込み状態（status）は刻々と変わるため、必ず `no-store` で最新を取得する
 * （コーディング規約）。
 */
export async function fetchDocuments(
  filters: DocumentFilters = {}
): Promise<DocumentSummary[]> {
  let response: Response;

  try {
    response = await fetch(buildDocumentsUrl(filters), {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch (error) {
    throw new DocumentApiError(
      'サーバーへ接続できませんでした。ネットワーク接続を確認して、もう一度お試しください。',
      { cause: error }
    );
  }

  if (!response.ok) {
    const rawBody = await response.text().catch(() => '');

    throw new DocumentApiError(extractErrorMessage(rawBody, response.status, 'list'));
  }

  try {
    const parsed: unknown = await response.json();

    if (!Array.isArray(parsed)) {
      throw new Error('配列以外が返された');
    }

    return parsed as DocumentSummary[];
  } catch (error) {
    throw new DocumentApiError(
      '文書一覧の内容を解釈できませんでした。時間をおいてもう一度お試しください。',
      { cause: error }
    );
  }
}

/**
 * DELETE /api/documents?id=…（要件F-09「削除」）
 *
 * 文書と、その検索用データ（チャンク・Embedding）をまとめて削除する。
 *
 * 【重要】この操作は取り消せない。
 * 呼び出し側では必ず確認ダイアログを挟むこと（F-08と同じ理由：誤操作防止）。
 */
export async function deleteDocument(documentId: string): Promise<void> {
  let response: Response;

  try {
    response = await fetch(`${DOCUMENTS_ENDPOINT}?id=${encodeURIComponent(documentId)}`, {
      method: 'DELETE',
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch (error) {
    throw new DocumentApiError(
      'サーバーへ接続できませんでした。ネットワーク接続を確認して、もう一度お試しください。',
      { cause: error }
    );
  }

  if (!response.ok) {
    const rawBody = await response.text().catch(() => '');
    throw new DocumentApiError(extractErrorMessage(rawBody, response.status, 'delete'));
  }
}
