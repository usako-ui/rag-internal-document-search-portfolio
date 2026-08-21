'use client';

import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import styles from './DocumentsView.module.css';
import { UploadArea } from './UploadArea';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useDocumentLibrary } from '@/hooks/useDocumentLibrary';
import { DocumentApiError } from '@/lib/api/documents';
import type { DocumentStatus, DocumentSummary } from '@/types/api';
import { formatDateTime, getDocumentStatusLabel } from '@/lib/format';
import {
  AlertCircleIcon,
  CheckCircleIcon,
  FileIcon,
  LoaderIcon,
  RefreshIcon,
  SearchIcon,
  TrashIcon,
  UploadIcon,
} from '@/components/icons';

/**
 * 文書管理画面（`/documents` / 要件F-07・F-08・F-09）
 *
 * 「PDFを追加する」と「登録済み文書を管理する」を1つの画面にまとめている。
 * 以前はアップロードパネル（チャット画面の右カラム）と文書一覧が別々で、
 * 追加した文書がどうなったかを確認するのに画面を移動する必要があった。
 *
 * 上部：PDFアップロード（ドラッグ＆ドロップ・ファイル選択・4段階の処理状況・最近3件）
 * 下部：登録済み文書一覧（キーワード検索・更新・削除）
 *
 * 【更新について】
 * MVPで確定しているAPIは POST /api/documents（PDFを取り込む）のみで、
 * 「既存文書を差し替える」専用エンドポイントは定義されていない。
 * そのため更新は「確認ダイアログ → PDFを選び直す → 取り込み直す」形にしている。
 *
 * 【削除について】
 * DELETE /api/documents で文書とチャンク（検索用データ）をまとめて消す。
 * 取り消せない操作のため、確認ダイアログを必ず挟む（F-08と同じ理由）。
 */

/** 確認待ちの操作 */
type PendingAction =
  | { type: 'replace'; document: DocumentSummary }
  | { type: 'delete'; document: DocumentSummary };

/** 登録状態バッジの見た目とアイコン */
function getStatusPresentation(status: DocumentStatus) {
  switch (status) {
    case 'ready':
      return { className: styles.statusReady, icon: <CheckCircleIcon size={11} /> };
    case 'processing':
      return { className: styles.statusProcessing, icon: <LoaderIcon size={11} /> };
    case 'error':
      return { className: styles.statusError, icon: <AlertCircleIcon size={11} /> };
    default:
      return { className: '', icon: null };
  }
}

export function DocumentsView() {
  const library = useDocumentLibrary();

  // キーワードは画面側で絞り込む。
  // サーバー側（GET /api/documents）で絞ると「最近のアップロード」まで
  // 絞り込み結果に置き換わり、直前に追加した文書が消えたように見えるため
  const [keyword, setKeyword] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  /** 削除に失敗したときの利用者向けメッセージ */
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);
  /** 削除中の文書ID。二重押しを防ぐ */
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // 確認後にファイル選択へ進むため、対象文書をダイアログを閉じたあとも保持する
  const replacingDocumentRef = useRef<DocumentSummary | null>(null);

  const visibleDocuments = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    if (normalized.length === 0) return library.documents;

    return library.documents.filter((document) =>
      document.name.toLowerCase().includes(normalized)
    );
  }, [library.documents, keyword]);

  /** 「更新」の確認後、差し替えるPDFの選択へ進む */
  const handleConfirmReplace = () => {
    if (pendingAction?.type !== 'replace') return;

    replacingDocumentRef.current = pendingAction.document;
    setPendingAction(null);
    fileInputRef.current?.click();
  };

  const handleFileSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const target = replacingDocumentRef.current;

    // 同じファイルを選び直したときにも change が発火するよう値をリセットする
    event.target.value = '';
    replacingDocumentRef.current = null;

    if (!file || !target) return;

    // IDも渡す。名前だけだと、改訂でPDFのタイトル行が変わったときに
    // 別文書として登録され、旧版が残ってしまう
    library.startUpload(file, {
      replacesDocumentName: target.name,
      replacesDocumentId: target.id,
    });
  };

  /** 「削除」の確認後、実際に削除する */
  const handleConfirmDelete = async () => {
    if (pendingAction?.type !== 'delete') return;

    const target = pendingAction.document;
    setPendingAction(null);
    setDeleteErrorMessage(null);
    setDeletingId(target.id);

    try {
      await library.removeDocument(target.id);
    } catch (error) {
      // 「削除に失敗しました」だけで終わらせない（UI/UX仕様）。
      // APIが返す利用者向けメッセージには、次に取るべき行動が書かれている
      setDeleteErrorMessage(
        error instanceof DocumentApiError
          ? `${target.name}：${error.userMessage}`
          : `${target.name} を削除できませんでした。時間をおいてもう一度お試しください。`
      );
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className={styles.screen}>
      <div className={styles.body}>
        {/* ─── 上部：PDFアップロード ─── */}
        <UploadArea
          documents={library.documents}
          uploadJobs={library.uploadJobs}
          onUpload={(file) => library.startUpload(file)}
          onDismissJob={library.dismissJob}
        />

        {/* ─── 下部：登録済み文書一覧 ─── */}
        <section className={styles.card} aria-label="登録済み文書">
          <div className={styles.cardHeader}>
            <span className={styles.cardIcon}>
              <FileIcon size={14} />
            </span>
            <div className={styles.cardHeaderText}>
              <h2 className={styles.cardTitle}>登録済み文書</h2>
              <p className={styles.cardSub}>
                {library.isLoading
                  ? '文書一覧を読み込んでいます...'
                  : `${visibleDocuments.length}件を表示中（登録 ${library.documents.length}件）`}
              </p>
            </div>

            <button type="button" className={styles.refreshButton} onClick={library.refresh}>
              <RefreshIcon size={13} strokeWidth={2.2} />
              最新の状態に更新
            </button>
          </div>

          <div className={styles.cardBody}>
            <div className={styles.searchField}>
              <span className={styles.searchIcon}>
                <SearchIcon size={13} />
              </span>
              <input
                type="search"
                className={styles.searchInput}
                placeholder="文書名で絞り込む"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                aria-label="文書名で絞り込む"
              />
            </div>

            {/* 取得に失敗したときは原因と次の行動を示す */}
            {library.errorMessage && (
              <div className={styles.errorNotice} role="alert">
                <span className={styles.noticeIcon}>
                  <AlertCircleIcon size={15} strokeWidth={2.2} />
                </span>
                <span>
                  {library.errorMessage}
                  <br />
                  解消しない場合は「最新の状態に更新」を押すか、管理者へご連絡ください。
                </span>
              </div>
            )}

            {deleteErrorMessage && (
              <div className={styles.errorNotice} role="alert">
                <span className={styles.noticeIcon}>
                  <AlertCircleIcon size={15} strokeWidth={2.2} />
                </span>
                <span>{deleteErrorMessage}</span>
              </div>
            )}

            <div className={styles.table} role="table" aria-label="登録済み文書一覧">
              <div className={styles.headRow} role="row">
                <span role="columnheader">文書名</span>
                <span role="columnheader">管轄部署</span>
                <span role="columnheader">登録日時</span>
                <span role="columnheader">登録状態</span>
                <span role="columnheader">操作</span>
              </div>

              {visibleDocuments.length === 0 && !library.isLoading && (
                <p className={styles.emptyText}>
                  {library.documents.length === 0
                    ? 'まだ文書が登録されていません。上のアップロードエリアからPDFを追加してください。'
                    : '条件に一致する文書がありません。キーワードを変えてお試しください。'}
                </p>
              )}

              {visibleDocuments.map((document) => {
                const presentation = getStatusPresentation(document.status);
                const isDeleting = deletingId === document.id;

                return (
                  <div className={styles.row} role="row" key={document.id}>
                    <span className={styles.nameCell} role="cell">
                      <span className={styles.pdfIcon}>
                        <FileIcon size={15} />
                      </span>
                      <span className={styles.name}>{document.name}</span>
                    </span>

                    <span className={styles.cell} role="cell">
                      <span className={styles.cellLabel}>管轄部署</span>
                      {document.department ?? '未設定'}
                    </span>

                    <span className={styles.cell} role="cell">
                      <span className={styles.cellLabel}>登録日時</span>
                      {formatDateTime(document.uploaded_at)}
                    </span>

                    <span className={styles.cell} role="cell">
                      <span className={styles.cellLabel}>登録状態</span>
                      <span className={`${styles.statusBadge} ${presentation.className}`}>
                        {presentation.icon}
                        {getDocumentStatusLabel(document.status)}
                      </span>
                    </span>

                    <span className={styles.actionCell} role="cell">
                      <button
                        type="button"
                        className={styles.actionButton}
                        onClick={() => setPendingAction({ type: 'replace', document })}
                        disabled={isDeleting}
                      >
                        <UploadIcon size={12} strokeWidth={2.2} />
                        更新
                      </button>
                      <button
                        type="button"
                        className={styles.deleteButton}
                        onClick={() => setPendingAction({ type: 'delete', document })}
                        disabled={isDeleting}
                      >
                        <TrashIcon size={12} strokeWidth={2.2} />
                        {isDeleting ? '削除中...' : '削除'}
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      {/* 確認後に差し替えるPDFを選ぶための入力。見た目はボタン側で作る */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className={styles.fileInput}
        onChange={handleFileSelected}
        aria-label="更新するPDFファイルを選択"
      />

      {/* 更新の確認ダイアログ（F-08：誤操作防止のため確認ステップを必ず入れる） */}
      <ConfirmDialog
        open={pendingAction?.type === 'replace'}
        title="資料を更新しますか？"
        description={
          <>
            既存文書を新しいPDFで更新しますか？
            <br />
            対象：<strong>{pendingAction?.document.name}</strong>
            <ul>
              <li>続けて新しいPDFを選択します</li>
              <li>古い内容は新しいPDFの内容で置き換えられます（別文書として増えません）</li>
              <li>作り直しが終わるまで、この文書は一時的に検索対象から外れます（数分かかる場合があります）</li>
            </ul>
          </>
        }
        confirmLabel="PDFを選択して更新"
        onConfirm={handleConfirmReplace}
        onCancel={() => setPendingAction(null)}
      />

      {/* 削除の確認ダイアログ。取り消せないことを明記する */}
      <ConfirmDialog
        open={pendingAction?.type === 'delete'}
        title="この文書を削除しますか？"
        description={
          <>
            対象：<strong>{pendingAction?.document.name}</strong>
            <ul>
              <li>文書と検索用データ（Embedding）をまとめて削除します</li>
              <li>削除後はこの文書を根拠にした回答ができなくなります</li>
              <li>この操作は取り消せません。元に戻すには同じPDFを再度アップロードしてください</li>
            </ul>
          </>
        }
        confirmLabel="削除する"
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setPendingAction(null)}
      />
    </div>
  );
}
