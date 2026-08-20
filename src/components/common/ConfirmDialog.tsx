'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import styles from './ConfirmDialog.module.css';
import { AlertCircleIcon, XIcon } from '@/components/icons';

/**
 * 確認ダイアログ（TC-17 / 要件F-08）
 *
 * 資料更新・再インデックスは既存の検索データを作り直す操作のため、
 * 誤操作を防ぐ確認ステップを必ず挟む（F-08：「誤操作防止のため確認ステップを必ず入れる」）。
 *
 * アクセシビリティ：
 *  - role="dialog" + aria-modal でダイアログであることを伝える
 *  - 開いた直後に実行ボタンへフォーカスを移す
 *  - Escapeキー・背面クリックで取り消せる
 */

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  /** 何が起きるかの説明。取り消せない操作かどうかも必ず書くこと */
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'キャンセル',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  // 開いたら実行ボタンへフォーカスし、Escapeで閉じられるようにする
  useEffect(() => {
    if (!open) return;

    confirmButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={onCancel} role="presentation">
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        // 背面クリックの取り消しがダイアログ内クリックで発火しないようにする
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <span className={styles.headerIcon}>
            <AlertCircleIcon size={16} strokeWidth={2.2} />
          </span>
          <h2 className={styles.title} id="confirm-dialog-title">
            {title}
          </h2>
          <button type="button" className={styles.closeButton} onClick={onCancel} aria-label="閉じる">
            <XIcon size={15} />
          </button>
        </div>

        <div className={styles.description} id="confirm-dialog-description">
          {description}
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.cancelButton} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={styles.confirmButton}
            onClick={onConfirm}
            ref={confirmButtonRef}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
