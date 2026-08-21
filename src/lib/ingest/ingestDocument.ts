import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { extractTextFromPdf, type ExtractedDocument } from '@/lib/pdf/extractText';
import { chunkDocument, DEFAULT_CHUNK_OPTIONS, type ChunkOptions } from '@/lib/pdf/chunkText';
import { extractDepartment, extractDocumentTitle } from '@/lib/pdf/metadata';
import { generateEmbeddings } from '@/lib/gemini/embedding';
import { PdfProcessingError } from '@/lib/pdf/errors';

/**
 * PDF取り込みパイプライン（要件F-01）
 *
 * PDF → テキスト抽出 → チャンキング → Embedding生成 → Supabase保存
 *
 * 処理状態は documents.status で管理する（processing / ready / error）。
 * UI側（F-07・F-09）はこの値を見て「検索可能」「処理中」「エラー」を表示するため、
 * 途中で失敗した場合も必ず status を error へ更新して放置しないこと。
 *
 * 処理を2段階に分けている理由：
 * `POST /api/documents` は仕様上 `{ document_id, status: "processing" }` を即座に返す。
 * Embedding生成の完了を待つとレスポンスが数秒〜数十秒ブロックされ、
 * F-07の段階表示（アップロード済み→抽出中→作成中→検索可能）が成立しない。
 * そのため「即座に返せるところまで」（prepareDocument）と
 * 「時間のかかる索引作成」（buildDocumentIndex）を分離している。
 */

export type IngestResult = {
  documentId: string;
  /** DBへ保存した文書名 */
  name: string;
  department: string | null;
  pageCount: number;
  chunkCount: number;
  /** 既存文書を置き換えた場合は true */
  replaced: boolean;
};

export type IngestParams = {
  /** 元のファイル名（例：employment-rules.pdf） */
  fileName: string;
  data: Buffer | Uint8Array;
  /** 文書名を明示する場合。省略時はPDFの1行目から推定する */
  name?: string;
  /** 管轄部署を明示する場合。省略時はPDFの「管轄:」行から推定する */
  department?: string;
  /** Supabase Storage 等に保存した場合のパス */
  filePath?: string | null;
  chunkOptions?: ChunkOptions;
  /**
   * 差し替える対象の文書ID（資料更新 F-08）。
   *
   * 【なぜ文書名ではなくIDで指定できる必要があるか】
   * 既定では「PDFの1行目から推定した文書名」が一致する場合のみ置き換える。
   * ところが改訂時にタイトル行が変わると（例：「就業規則」→「就業規則 2026年改訂版」）
   * 別文書として登録され、**旧版が残ったまま2件並ぶ**。
   * その状態ではAIが旧版を根拠に回答してしまう。
   *
   * 文書管理画面の「更新」は「どの文書を差し替えるか」を利用者が明示しているので、
   * その意思をIDで受け取り、タイトル行の変化に関係なく同じ行を置き換える。
   */
  replaceDocumentId?: string | null;
};

/** prepareDocument の結果。buildDocumentIndex へそのまま渡す */
export type PreparedDocument = {
  documentId: string;
  name: string;
  department: string | null;
  /** 抽出済みテキスト。再抽出を避けるため索引作成へ引き渡す */
  document: ExtractedDocument;
  /** 既存文書を置き換えた場合は true */
  replaced: boolean;
};

/**
 * 取り込みの前半：テキスト抽出と documents レコードの登録（status = processing）。
 *
 * PDFとして読めない・テキストが無い・サイズ超過は**この段階で例外になる**。
 * 呼び出し元（`POST /api/documents`）はこれを利用者向けエラーとして
 * その場で返せる（F-07：原因が分かるメッセージを返す）。
 *
 * @throws PdfProcessingError PDFが読めない・テキストなし・サイズ超過・DB登録失敗
 */
export async function prepareDocument(params: IngestParams): Promise<PreparedDocument> {
  const supabase = createSupabaseAdminClient();

  // 1. テキスト抽出（PDFが読めない場合はここで失敗するため、DB登録より先に行う）
  const document = await extractTextFromPdf(params.data);

  const name = params.name ?? extractDocumentTitle(document) ?? params.fileName;
  const department = params.department ?? extractDepartment(document);

  // ------------------------------------------------------------
  // 2. 置き換え対象の文書を特定する
  //
  //    優先順位は以下のとおり。
  //      (1) replaceDocumentId … 利用者が「この文書を更新する」と明示した場合
  //      (2) 同名の既存文書     … スクリプト実行・同じPDFの再アップロード
  //      (3) どちらも無ければ新規登録
  //
  //    【maybeSingle を使わない理由】
  //    maybeSingle は2件以上ヒットすると例外になる。
  //    過去に同名文書が2件できてしまっている環境では、
  //    更新しようとするたびに原因の分からない500が返ってしまう。
  //    ここでは「最も新しい1件」を対象にして処理を続けられるようにする。
  // ------------------------------------------------------------
  let existing: { id: string } | null = null;

  if (params.replaceDocumentId) {
    const { data, error } = await supabase
      .from('documents')
      .select('id')
      .eq('id', params.replaceDocumentId)
      .maybeSingle();

    if (error) {
      throw new PdfProcessingError(
        '文書情報の取得に失敗しました。時間をおいてもう一度お試しください。',
        { cause: error, httpStatus: 500 }
      );
    }

    // 指定されたIDが見つからない場合（別の端末で既に削除された等）は
    // 新規登録として続行する。ここで失敗させると、更新のつもりの操作が
    // 何も残らずに終わってしまうため
    existing = data ?? null;
  }

  if (!existing) {
    const { data, error: selectError } = await supabase
      .from('documents')
      .select('id')
      .eq('name', name)
      .order('uploaded_at', { ascending: false })
      .limit(1);

    if (selectError) {
      // DB障害は利用者に非がないため500。詳細（selectError）はcauseへ入れてログにのみ残す
      throw new PdfProcessingError(
        '文書情報の取得に失敗しました。時間をおいてもう一度お試しください。',
        { cause: selectError, httpStatus: 500 }
      );
    }

    existing = data?.[0] ?? null;
  }

  let documentId: string;
  const replaced = existing !== null;

  if (existing) {
    documentId = existing.id;

    // 再インデックスのため、いったん処理中へ戻す
    const { error } = await supabase
      .from('documents')
      .update({
        // 改訂でタイトル行が変わることがあるため、文書名も新しいPDFの内容へ合わせる。
        // 更新しないと一覧に旧タイトルが残り、どちらが最新か分からなくなる
        name,
        department,
        file_path: params.filePath ?? null,
        status: 'processing',
        updated_at: new Date().toISOString(),
      })
      .eq('id', documentId);

    if (error) {
      throw new PdfProcessingError(
        '文書情報の更新に失敗しました。時間をおいてもう一度お試しください。',
        { cause: error, httpStatus: 500 }
      );
    }

    // 古いチャンクを削除する（残すと更新前後の内容が混在して検索結果が矛盾する）
    const { error: deleteError } = await supabase
      .from('document_chunks')
      .delete()
      .eq('document_id', documentId);

    if (deleteError) {
      throw new PdfProcessingError(
        '既存の検索データの削除に失敗しました。時間をおいてもう一度お試しください。',
        { cause: deleteError, httpStatus: 500 }
      );
    }
  } else {
    const { data, error } = await supabase
      .from('documents')
      .insert({
        name,
        department,
        file_path: params.filePath ?? null,
        status: 'processing',
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new PdfProcessingError(
        '文書の登録に失敗しました。時間をおいてもう一度お試しください。',
        { cause: error, httpStatus: 500 }
      );
    }

    documentId = data.id;
  }

  return { documentId, name, department, document, replaced };
}

/**
 * 取り込みの後半：チャンキング → Embedding生成 → 保存 → status を ready にする。
 *
 * 数秒〜数十秒かかる処理のため、`POST /api/documents` からはレスポンス送出後に実行する。
 * 失敗した場合は status を error へ更新し、例外を再送出する。
 * 呼び出し元が例外を握りつぶしても、DB上は error として残るため
 * UI（F-07・F-09）が「エラー」を表示できる。
 */
export async function buildDocumentIndex(params: {
  documentId: string;
  document: ExtractedDocument;
  chunkOptions?: ChunkOptions;
}): Promise<{ chunkCount: number }> {
  const supabase = createSupabaseAdminClient();
  const { documentId, document } = params;

  // ここから先で失敗した場合は status を error にして終える
  try {
    const chunks = chunkDocument(document, params.chunkOptions ?? DEFAULT_CHUNK_OPTIONS);

    if (chunks.length === 0) {
      throw new PdfProcessingError(
        'PDFからチャンクを作成できませんでした。テキストが極端に少ない可能性があります。'
      );
    }

    // 4. Embedding生成（文書側は RETRIEVAL_DOCUMENT を使う）
    const vectors = await generateEmbeddings(
      chunks.map((chunk) => chunk.content),
      'RETRIEVAL_DOCUMENT'
    );

    // 5. チャンクとベクトルを保存する
    const rows = chunks.map((chunk, index) => ({
      document_id: documentId,
      content: chunk.content,
      // pgvectorへは配列ではなく "[0.1,0.2,...]" 形式の文字列で渡す
      embedding: JSON.stringify(vectors[index]),
      chunk_index: chunk.chunkIndex,
      // 出典表示（F-04）で「文書名＋ページ番号＋参照箇所」を返すために保持する
      page_number: chunk.pageNumber,
      section: chunk.heading,
    }));

    const { error: insertError } = await supabase.from('document_chunks').insert(rows);

    if (insertError) {
      throw new PdfProcessingError(`チャンクの保存に失敗しました：${insertError.message}`, {
        cause: insertError,
      });
    }

    // 6. 検索可能な状態にする
    const { error: updateError } = await supabase
      .from('documents')
      .update({ status: 'ready', updated_at: new Date().toISOString() })
      .eq('id', documentId);

    if (updateError) {
      throw new PdfProcessingError(
        `文書ステータスの更新に失敗しました：${updateError.message}`,
        { cause: updateError }
      );
    }

    return { chunkCount: chunks.length };
  } catch (error) {
    // 失敗を放置すると「処理中」のまま止まって見えるため、必ずエラー状態へ落とす
    await supabase
      .from('documents')
      .update({ status: 'error', updated_at: new Date().toISOString() })
      .eq('id', documentId);

    throw error;
  }
}

/**
 * PDFを取り込み、チャンクとEmbeddingをSupabaseへ保存する（前半＋後半の一括実行）。
 *
 * 完了まで待つ同期版。スクリプト（`npm run ingest`）から使用する。
 * APIからは応答を待たせないため、prepareDocument と buildDocumentIndex を個別に呼ぶこと。
 *
 * 同じ文書名の既存レコードがある場合は置き換える（チャンクを削除して作り直す）。
 * 資料更新（F-08）の再インデックスもこの経路を通る。
 */
export async function ingestPdf(params: IngestParams): Promise<IngestResult> {
  const prepared = await prepareDocument(params);

  const { chunkCount } = await buildDocumentIndex({
    documentId: prepared.documentId,
    document: prepared.document,
    chunkOptions: params.chunkOptions,
  });

  return {
    documentId: prepared.documentId,
    name: prepared.name,
    department: prepared.department,
    pageCount: prepared.document.pages.length,
    chunkCount,
    replaced: prepared.replaced,
  };
}
