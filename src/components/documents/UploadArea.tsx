'use client';

import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import styles from './UploadArea.module.css';
import { UploadJobList } from '@/components/upload/UploadJobList';
import type { DocumentStatus, DocumentSummary } from '@/types/api';
import type { UploadJob } from '@/types/upload';
import { formatDateTime, getDocumentStatusLabel } from '@/lib/format';
import {
  AlertCircleIcon,
  CheckCircleIcon,
  FileIcon,
  LoaderIcon,
  UploadIcon,
} from '@/components/icons';

/**
 * PDFアップロードエリア（要件F-07）
 *
 * 文書管理画面（`/documents`）の上部に置く。
 * UX優先順位2位「PDFを追加しやすい」に対応するため、画面を開いた瞬間に
 * ドロップ先が見えている状態にすること（折りたたみやタブの奥へ入れない）。
 *
 * 【2026-08-18 構成変更】
 * 以前はチャット画面の右カラム（UploadPanel）にあり、文書一覧とは別画面だった。
 * 「PDFを追加する」と「追加した文書を確認する」が別の場所にあると、
 * アップロード後に結果を見に行く導線が必要になる。同じ画面へ統合して解消した。
 *
 * 処理状況の4段階（アップロード済み → テキスト抽出中 → 検索用データを作成中 → 検索可能）は
 * UploadJobList が表示する。ここでは表示しない判断をしてはいけない（F-07で必須）。
 */

/** 登録状態に応じたバッジのスタイルとアイコンを返す */
function getStatusPresentation(status: DocumentStatus) {
  switch (status) {
    case 'ready':
      return { className: styles.statusReady, icon: <CheckCircleIcon size={10} /> };
    case 'processing':
      return { className: styles.statusProcessing, icon: <LoaderIcon size={10} /> };
    case 'error':
      return { className: styles.statusError, icon: <AlertCircleIcon size={10} /> };
    default:
      return { className: '', icon: null };
  }
}

/** 「最近のアップロード」に出す件数 */
const RECENT_COUNT = 3;

type UploadAreaProps = {
  /** 登録済み文書（登録日時の降順）。先頭3件を「最近のアップロード」に出す */
  documents: DocumentSummary[];
  /** 進行中・完了直後のアップロード（F-07の段階表示に使う） */
  uploadJobs: UploadJob[];
  /** ファイルが選択・ドロップされたときに呼ぶ */
  onUpload: (file: File) => void;
  onDismissJob: (jobId: string) => void;
};

export function UploadArea({ documents, uploadJobs, onUpload, onDismissJob }: UploadAreaProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  /** ファイル選択ダイアログを開く */
  const openFileDialog = () => {
    fileInputRef.current?.click();
  };

  /** 選択・ドロップされたファイルをまとめてアップロードへ渡す */
  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => onUpload(file));
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    handleFiles(event.target.files);
    // 同じファイルを選び直したときにも change が発火するよう値をリセットする
    event.target.value = '';
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    handleFiles(event.dataTransfer.files);
  };

  const recentDocuments = documents.slice(0, RECENT_COUNT);

  return (
    <section className={styles.card} aria-label="PDFアップロード">
      <div className={styles.cardHeader}>
        <span className={styles.cardIcon}>
          <UploadIcon size={14} />
        </span>
        <div>
          <h2 className={styles.cardTitle}>PDFアップロード</h2>
          <p className={styles.cardSub}>
            追加したPDFは、検索用データの作成が終わると質問の対象になります
          </p>
        </div>
      </div>

      <div className={styles.cardBody}>
        <div
          className={`${styles.dropzone} ${isDragActive ? styles.dropzoneActive : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={openFileDialog}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              openFileDialog();
            }
          }}
        >
          <div className={styles.dropzoneIcon}>
            <UploadIcon size={38} strokeWidth={1.4} />
          </div>
          <div className={styles.dropzoneText}>
            <strong>PDFをドラッグ＆ドロップ</strong>
            <br />
            または
          </div>
          <span className={styles.selectButton}>
            <FileIcon size={12} strokeWidth={2.2} />
            ファイルを選択
          </span>
          <div className={styles.note}>対応形式：PDF（最大50MB）</div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className={styles.fileInput}
          onChange={handleInputChange}
          aria-label="PDFファイルを選択"
        />

        {/* 処理状況：アップロード済み → テキスト抽出中 → 検索用データを作成中 → 検索可能 */}
        {uploadJobs.length > 0 && (
          <div className={styles.jobSection}>
            <UploadJobList jobs={uploadJobs} onDismiss={onDismissJob} />
          </div>
        )}

        <div className={styles.recentSection}>
          <div className={styles.recentLabel}>最近のアップロード</div>

          {recentDocuments.length === 0 ? (
            <p className={styles.emptyText}>
              まだ文書が登録されていません。上のエリアからPDFを追加してください。
            </p>
          ) : (
            recentDocuments.map((document) => {
              const presentation = getStatusPresentation(document.status);

              return (
                <div className={styles.recentItem} key={document.id}>
                  <span className={styles.recentPdfIcon}>
                    <FileIcon size={14} />
                  </span>
                  <span className={styles.recentInfo}>
                    <span className={styles.recentName}>{document.name}</span>
                    <span className={styles.recentMeta}>
                      {formatDateTime(document.uploaded_at)}
                      <span className={`${styles.statusBadge} ${presentation.className}`}>
                        {presentation.icon}
                        {getDocumentStatusLabel(document.status)}
                      </span>
                    </span>
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
