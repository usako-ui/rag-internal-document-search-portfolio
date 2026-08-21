import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { checkEmailDomain } from '@/lib/auth/emailDomain';
import { buildDocumentIndex, prepareDocument } from '@/lib/ingest/ingestDocument';
import { EmbeddingError } from '@/lib/gemini/embedding';
import {
  MAX_PDF_SIZE_BYTES,
  PdfProcessingError,
  createInvalidFormError,
  createNoFileError,
  createSizeExceededError,
  createUnsupportedTypeError,
} from '@/lib/pdf/errors';

/**
 * 文書API（要件F-01・F-07・F-09）
 *
 * - POST   /api/documents … PDFアップロードを受け取り、取り込みパイプラインを起動する
 * - GET    /api/documents … 登録済み文書の一覧を返す（文書一覧画面 F-09）
 * - DELETE /api/documents … 登録済み文書を削除する（文書管理画面 F-09）
 *
 * レスポンス形式は requirements.md セクション7で確定済み。
 * UI側がこの形に依存して実装するため、
 * **フィールドの追加・削除・リネームを勝手に行ってはいけない**。
 *
 * 【認証について】多層防御にしている。**guardRequest() を外さないこと。**
 *
 * Middlewareが /api 全体を一次防御するが、このルートは POST・DELETE で
 * service_role を使うためRLSが効かない。Middlewareの公開パス設定を
 * 1行間違えるだけで、社内文書の書き込み口・削除口が開いてしまう。
 * そのため各メソッドの先頭で guardRequest() を呼び、
 * 認証と社内メールドメインをこのルート単体でも確認している。
 *
 * GETもanonキー＋RLSだけなら未ログインでは0件が返るが、
 * それでは「該当0件」と「見せてはいけない」を区別できないため同様に確認する。
 */

// pdf-parse は Node.js のAPIに依存するため Edge Runtime では動作しない
export const runtime = 'nodejs';

// 文書一覧・取り込み状態は常に最新を返す必要があるためキャッシュしない
// （コーディング規約：Supabaseクエリは no-store）
export const dynamic = 'force-dynamic';

/** レスポンスをキャッシュさせないための共通ヘッダー */
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

/**
 * 想定内のエラーを利用者向けメッセージ付きのレスポンスへ変換する。
 *
 * requirements.md F-07：「アップロードに失敗しました」だけで終わらせず、
 * 原因と次に取るべき行動が分かるメッセージを返すこと。
 */
function toErrorResponse(error: unknown): NextResponse {
  // 想定内のエラーは userMessage をそのまま利用者へ返す
  if (error instanceof PdfProcessingError) {
    // サーバー側の障害（DB接続不良など）は原因を追えるようログへ残す。
    // 利用者向けメッセージには内部情報を含めない方針のため、ここで記録しないと原因が消える
    if (error.httpStatus >= 500) {
      console.error('[POST /api/documents] サーバー側エラー:', error.message, error.cause);
    }

    return NextResponse.json(
      { error: error.userMessage },
      { status: error.httpStatus, headers: NO_STORE_HEADERS }
    );
  }

  // Embedding生成の失敗はGemini API側の問題のため 502 とする
  if (error instanceof EmbeddingError) {
    return NextResponse.json(
      { error: error.userMessage },
      { status: 502, headers: NO_STORE_HEADERS }
    );
  }

  // 想定外のエラーは内部情報を漏らさない。詳細はサーバーログにのみ残す
  console.error('[POST /api/documents] 想定外のエラー:', error);
  return NextResponse.json(
    { error: 'アップロードに失敗しました。時間をおいてもう一度お試しください。' },
    { status: 500, headers: NO_STORE_HEADERS }
  );
}

/**
 * ログイン状態と社内メールドメインを確認する（要件F-06）
 *
 * 未認証拒否は Middlewareが全 `/api` に対して行っているが、
 * このルートは POST が service_role で書き込むためRLSが効かない。
 * Middlewareの公開パス設定を誤った瞬間に社内文書の書き込み口が開くため、
 * ここでも独立して確認する（多層防御）。
 *
 * @returns 問題があればそのまま返すレスポンス。問題なければ null
 */
async function guardRequest(): Promise<NextResponse | null> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json(
      { error: 'ログインが必要です。ログインしてから再度お試しください。' },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }

  const domainCheck = checkEmailDomain(user.email);

  if (!domainCheck.allowed) {
    return NextResponse.json(
      { error: domainCheck.message },
      { status: 403, headers: NO_STORE_HEADERS }
    );
  }

  return null;
}

/** 送信されたファイルがPDFかどうかを判定する */
function isPdfFile(file: File): boolean {
  // ブラウザによっては type が空文字で送られてくるため、拡張子を主に判定する
  return (
    file.name.toLowerCase().endsWith('.pdf') || file.type.toLowerCase() === 'application/pdf'
  );
}

/**
 * POST /api/documents（要件F-01・F-07）
 *
 * PDFを受け取り、`{ document_id, status: "processing" }` を即座に返す。
 * Embedding生成は応答後にバックグラウンドで継続し、完了後に status が ready になる。
 * UI側は GET /api/documents をポーリングして段階表示を行う。
 *
 * ステータスコードは 202 Accepted（受理したが処理は未完了）。
 *
 * PDFが読めない・サイズ超過などは応答前に判明するため、
 * その場で具体的なエラーメッセージを返す（F-07）。
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    // 0. 認証・社内ドメイン確認
    //    service_role で書き込むためRLSが効かない。ここを通さない経路を作らないこと
    const denied = await guardRequest();
    if (denied) return denied;

    // 1. multipart/form-data として解釈する
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (error) {
      throw createInvalidFormError(error);
    }

    // 2. ファイルの存在確認
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      throw createNoFileError();
    }

    // 3. 種別確認（MVPの対象はPDFのみ。Word・ConfluenceはPhase 2）
    if (!isPdfFile(file)) {
      throw createUnsupportedTypeError(file.name);
    }

    // 4. サイズ確認（バイナリを読み込む前に弾く。大きなファイルでメモリを消費しないため）
    if (file.size > MAX_PDF_SIZE_BYTES) {
      throw createSizeExceededError(file.size);
    }

    // 5. 差し替え対象の指定を受け取る（資料更新 F-08）
    //
    //    文書管理画面の「更新」は、どの文書を差し替えるかを利用者が選んでいる。
    //    その意思をIDで受け取らないと、改訂でPDFのタイトル行が変わったときに
    //    別文書として登録され、旧版が残ったまま2件並んでしまう（AIが旧版で回答する）。
    //
    //    UUID以外は無視して新規登録として扱う。ここで失敗させると、
    //    値が壊れているだけで更新操作そのものが何も残らずに終わってしまうため
    const rawReplaceId = formData.get('document_id');
    const replaceDocumentId =
      typeof rawReplaceId === 'string' && isUuid(rawReplaceId.trim())
        ? rawReplaceId.trim()
        : null;

    // 6. テキスト抽出と documents レコードの登録（status = processing）
    //    PDFが読めない・テキストが無い場合はここで例外になり、利用者へ原因を返せる
    const buffer = Buffer.from(await file.arrayBuffer());
    const prepared = await prepareDocument({
      fileName: file.name,
      data: buffer,
      replaceDocumentId,
    });

    // 7. チャンキング・Embedding生成はレスポンス送出後に継続する
    //    ここで await すると数秒〜数十秒ブロックされ、F-07の段階表示が成立しない。
    //    失敗時は buildDocumentIndex 内で status が error へ更新されるため、
    //    UI（F-09）は文書一覧で「エラー」を確認できる。
    void buildDocumentIndex({
      documentId: prepared.documentId,
      document: prepared.document,
    }).catch((error: unknown) => {
      const message =
        error instanceof PdfProcessingError || error instanceof EmbeddingError
          ? error.userMessage
          : error;
      console.error(`[取り込み失敗] document_id=${prepared.documentId}:`, message);
    });

    return NextResponse.json(
      { document_id: prepared.documentId, status: 'processing' },
      { status: 202, headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * LIKE パターンの特殊文字を打ち消す（エスケープする）。
 *
 * `%` は「任意の文字列」、`_` は「任意の1文字」としてSQL側に解釈されるため、
 * 利用者が「%」とだけ入力すると全件ヒットしてしまう。
 * 検索キーワードは自由入力なので、必ずここを通してから ilike へ渡すこと。
 *
 * バックスラッシュ自身もエスケープ文字なので最初に置換する
 * （順番を逆にすると、後から足したバックスラッシュを二重に処理してしまう）。
 */
function escapeLikePattern(keyword: string): string {
  return keyword
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

/**
 * GET /api/documents（要件F-09 ＋ 納品前改善フェーズ STEP 1-4）
 *
 * 登録済み文書の一覧を返す。レスポンスは配列（requirements.md セクション7）。
 * `status` は processing / ready / error のいずれかで、
 * UI側は「処理中 / 検索可能 / エラー」として表示する。
 *
 * クエリパラメータ（いずれも任意・省略時は絞り込みなし）：
 *   department … 管轄部署の部分一致（例：人事部）
 *   keyword    … 文書名の部分一致・大文字小文字を区別しない（例：規程）
 * 例：/api/documents?department=人事部&keyword=規程
 *
 * 両方指定した場合はAND条件になる（部署が人事部 かつ 文書名に「規程」を含む）。
 *
 * anonキー＋RLSで読むため、未ログインでは0件が返る（社内文書を外部へ出さない）。
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    // 認証・社内ドメイン確認。
    // anonキー＋RLSでも未ログインでは0件になるが、
    // 「0件」と「見せてはいけない」を区別できるよう明示的に拒否する
    const denied = await guardRequest();
    if (denied) return denied;

    const supabase = createSupabaseServerClient();
    const searchParams = new URL(request.url).searchParams;

    const department = searchParams.get('department')?.trim() ?? '';
    const keyword = searchParams.get('keyword')?.trim() ?? '';

    let query = supabase
      .from('documents')
      // requirements.md セクション7で確定した5フィールドのみを返す
      .select('id, name, department, status, uploaded_at');

    // 空文字は「絞り込みなし」として扱う（UIで選択を解除した状態）
    //
    // 完全一致ではなく部分一致にしている理由：
    // department には「人事部・情報システム部」のように複数部署が入る文書があり、
    // 完全一致にすると、その文書がどの部署を選んでも一覧に出てこなくなるため。
    // 実データでは「リモートワーク規程」が該当する。
    if (department.length > 0) {
      query = query.ilike('department', `%${escapeLikePattern(department)}%`);
    }

    if (keyword.length > 0) {
      query = query.ilike('name', `%${escapeLikePattern(keyword)}%`);
    }

    const { data, error } = await query
      // 新しく追加した文書を上に表示する
      .order('uploaded_at', { ascending: false });

    if (error) {
      console.error('[GET /api/documents] 文書一覧の取得に失敗:', error);
      return NextResponse.json(
        { error: '文書一覧を取得できませんでした。時間をおいてもう一度お試しください。' },
        { status: 500, headers: NO_STORE_HEADERS }
      );
    }

    return NextResponse.json(data ?? [], { headers: NO_STORE_HEADERS });
  } catch (error) {
    // 環境変数未設定などはここに来る
    console.error('[GET /api/documents] 想定外のエラー:', error);
    return NextResponse.json(
      { error: '文書一覧を取得できませんでした。時間をおいてもう一度お試しください。' },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

/** UUID（v4想定）の形式かどうかを判定する */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * DELETE /api/documents?id=<document_id>（要件F-09「削除」）
 *
 * 登録済み文書を1件削除する。
 * `document_chunks.document_id` は `on delete cascade` のため、
 * この1回の削除でチャンクとEmbeddingも一緒に消える
 * （チャンクだけが残ると、消したはずの文書が検索結果に出続けてしまう）。
 *
 * 【service_role を使う理由】
 * documents の RLS には DELETE ポリシーを作っていない（migration 20260817000200）。
 * anonキーでは1件も消せず、消したつもりで消えていない状態になるため、
 * 削除はサーバー側で service_role を使って実行する。
 *
 * 【service_role を使うがゆえの注意】
 * RLSを迂回するので、認証・社内ドメインの確認をここで必ず通すこと。
 * guardRequest を外すと、ログインしていない相手が社内文書を削除できてしまう。
 *
 * 【取り消しについて】
 * 削除は取り消せない。UI側（文書管理画面）で確認ダイアログを必ず挟むこと。
 */
export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    // 認証・社内ドメイン確認。service_role で消すためRLSが効かない
    const denied = await guardRequest();
    if (denied) return denied;

    const id = new URL(request.url).searchParams.get('id')?.trim() ?? '';

    // 形式を先に確認する。UUID以外を渡すとPostgres側が型エラーになり、
    // 利用者には原因の分からない500が返ってしまう
    if (!isUuid(id)) {
      return NextResponse.json(
        { error: '削除する文書を特定できませんでした。文書一覧を再読み込みしてからお試しください。' },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const admin = createSupabaseAdminClient();

    // 削除した行を返させることで「対象が存在したか」を判定する。
    // 存在しないIDを消して成功を返すと、UI上は消えたのに実際は別物が残る事故に気づけない
    const { data, error } = await admin
      .from('documents')
      .delete()
      .eq('id', id)
      .select('id, name');

    if (error) {
      console.error('[DELETE /api/documents] 削除に失敗:', error);
      return NextResponse.json(
        { error: '文書を削除できませんでした。時間をおいてもう一度お試しください。' },
        { status: 500, headers: NO_STORE_HEADERS }
      );
    }

    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: '対象の文書が見つかりませんでした。すでに削除されている可能性があります。文書一覧を再読み込みしてください。' },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    return NextResponse.json(
      { document_id: data[0].id, deleted: true },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    // 環境変数未設定（SUPABASE_SERVICE_ROLE_KEY 未設定など）はここに来る
    console.error('[DELETE /api/documents] 想定外のエラー:', error);
    return NextResponse.json(
      { error: '文書を削除できませんでした。時間をおいてもう一度お試しください。' },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
