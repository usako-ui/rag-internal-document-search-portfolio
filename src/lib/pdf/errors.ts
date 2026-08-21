/**
 * PDF取り込み処理のエラー定義
 *
 * requirements.md F-07：エラー時は「失敗しました」だけで終わらせず、
 * 原因と次に取るべき行動が分かるメッセージを利用者へ返すこと。
 * ここで定義した userMessage をそのままAPIレスポンス・UI表示に使う。
 */

/** アップロード可能な最大ファイルサイズ（50MB・requirements.md F-07） */
export const MAX_PDF_SIZE_BYTES = 50 * 1024 * 1024;

/** PDF取り込みで発生する想定内のエラー */
export class PdfProcessingError extends Error {
  /** 利用者にそのまま表示してよいメッセージ */
  readonly userMessage: string;

  /**
   * APIで返すHTTPステータスコード（`POST /api/documents` が使用する）。
   * 既定は400（リクエスト内容の問題）。DB障害など利用者に非がないものは500を指定する。
   */
  readonly httpStatus: number;

  constructor(userMessage: string, options?: { cause?: unknown; httpStatus?: number }) {
    super(userMessage, options);
    this.name = 'PdfProcessingError';
    this.userMessage = userMessage;
    this.httpStatus = options?.httpStatus ?? 400;
  }
}

/** ファイルサイズ超過 */
export function createSizeExceededError(actualBytes: number): PdfProcessingError {
  const actualMb = (actualBytes / 1024 / 1024).toFixed(1);
  return new PdfProcessingError(
    `ファイルサイズが50MBを超えています（${actualMb}MB）。ファイルを分割してからアップロードしてください。`,
    // 413 Payload Too Large：サイズ超過であることをHTTP上も区別できるようにする
    { httpStatus: 413 }
  );
}

/**
 * ファイルが送信されていない場合。
 * multipart/form-data の `file` フィールドが無い・空のときに使う。
 */
export function createNoFileError(): PdfProcessingError {
  return new PdfProcessingError(
    'PDFファイルが選択されていません。アップロードするファイルを選択してください。'
  );
}

/**
 * PDF以外のファイルが送信された場合。
 * MVPの対象はPDFのみ（Word・ConfluenceはPhase 2）。
 */
export function createUnsupportedTypeError(fileName: string): PdfProcessingError {
  return new PdfProcessingError(
    `PDF以外のファイルはアップロードできません（${fileName}）。拡張子が .pdf のファイルを選択してください。`
  );
}

/** リクエストが multipart/form-data として解釈できなかった場合 */
export function createInvalidFormError(cause?: unknown): PdfProcessingError {
  return new PdfProcessingError(
    'アップロードの形式が正しくありません。ファイルを選択し直して、もう一度お試しください。',
    { cause }
  );
}

/** PDFとして解析できなかった場合（破損・暗号化・PDF以外のファイル等） */
export function createUnreadableError(cause?: unknown): PdfProcessingError {
  return new PdfProcessingError(
    'PDFを読み取れませんでした。ファイルを確認してください。パスワード付き・破損したPDFの可能性があります。',
    { cause }
  );
}

/**
 * PDFは読めたがテキストが含まれていなかった場合。
 * 紙をスキャンしただけのPDFは画像しか持たないため、この状態になる。
 * 検索対象にできないので、取り込みを成功扱いにしてはいけない。
 */
export function createNoTextError(): PdfProcessingError {
  return new PdfProcessingError(
    'PDFからテキストを抽出できませんでした。スキャン画像のみのPDFは検索対象にできません。テキスト付きのPDFをアップロードしてください。'
  );
}
