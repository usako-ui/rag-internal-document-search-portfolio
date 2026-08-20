'use client';

import { useEffect, useRef } from 'react';
import styles from './CitationModal.module.css';
import type { Citation } from '@/types/api';
import { FileIcon, XIcon } from '@/components/icons';

/**
 * 出典モーダル（TE-06）
 *
 * 出典リンク・関連文書カードを押したときに、
 * 文書名・ページ・該当箇所の本文を表示する。
 *
 * UX優先順位4位「AI回答の根拠を確認しやすい」に対応する機能。
 * 回答だけを見せて根拠を確認できない状態にしないため、原文をそのまま提示する。
 *
 * アクセシビリティ：
 *  - role="dialog" + aria-modal でダイアログであることを伝える
 *  - 開いた直後に閉じるボタンへフォーカスを移す
 *  - Escapeキー・背面クリックで閉じられる
 */

type CitationModalProps = {
  /** 表示する出典。null なら閉じた状態 */
  citation: Citation | null;
  onClose: () => void;
};

export function CitationModal({ citation, onClose }: CitationModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // 開いたら閉じるボタンへフォーカスし、Escapeで閉じられるようにする
  useEffect(() => {
    if (!citation) return;

    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [citation, onClose]);

  if (!citation) return null;

  // 該当箇所の本文。TE-06より前に保存された履歴には content が無いため、
  // 空のときは「表示できない」ことと理由が分かる案内を出す（空欄のまま見せない）
  const hasContent = citation.content.trim().length > 0;

  return (
    <div className={styles.overlay} onClick={onClose} role="presentation">
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="citation-modal-title"
        // 背面クリックでの閉じる動作が、ダイアログ内のクリックで発火しないようにする
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <span className={styles.headerIcon}>
            <FileIcon size={16} strokeWidth={2.2} />
          </span>

          <div className={styles.headerText}>
            <div className={styles.title} id="citation-modal-title">
              {citation.document_name}
            </div>
            <div className={styles.subtitle}>回答の根拠になった箇所</div>
          </div>

          <button
            type="button"
            ref={closeButtonRef}
            className={styles.closeButton}
            onClick={onClose}
            aria-label="閉じる"
          >
            <XIcon size={16} />
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.sectionLabel}>該当箇所</div>

          {hasContent ? (
            <div className={styles.content}>{citation.content}</div>
          ) : (
            <div className={styles.empty}>
              この履歴には該当箇所の本文が保存されていません。
              文書一覧から対象の文書を開いて内容をご確認ください。
            </div>
          )}

          {/* Q-25：page / section は null になり得るため、値があるものだけ表示する */}
          {(citation.page || citation.section) && (
            <div className={styles.meta}>
              {citation.page && (
                <span className={styles.metaItem}>
                  ページ
                  <span className={styles.metaValue}>{citation.page}</span>
                </span>
              )}
              {citation.section && (
                <span className={styles.metaItem}>
                  参照箇所
                  <span className={styles.metaValue}>{citation.section}</span>
                </span>
              )}
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.closeAction} onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
