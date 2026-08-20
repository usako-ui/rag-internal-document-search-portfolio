'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from './HistoryView.module.css';
import { CitationModal } from '@/components/chat/CitationModal';
import { HistoryApiError, fetchHistories } from '@/lib/api/histories';
import { NO_ANSWER_TEXT } from '@/lib/chat/constants';
import type { ChatHistory, Citation } from '@/types/api';
import { FileIcon, HistoryIcon, LoaderIcon, RefreshIcon } from '@/components/icons';

/**
 * 質問履歴画面（TE-07）
 *
 * 左に履歴一覧、右に選択した履歴の質問・回答・出典を表示する。
 * 出典をクリックすると、チャット画面と同じ出典モーダル（TE-06）で
 * 該当箇所の本文を確認できる。
 *
 * 表示件数は設定画面の「履歴表示件数」がサーバー側で適用される（TE-10）。
 */

/** 日時を「2026/08/18 14:30」の形にする */
function formatDateTime(isoString: string): string {
  const date = new Date(isoString);

  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 出典1件の表示ラベルを組み立てる（Q-25：null の項目は出さない） */
function formatCitationLabel(citation: Citation): string {
  const section = citation.section ? ` ${citation.section}` : '';
  const page = citation.page ? `（${citation.page}）` : '';
  return `${citation.document_name}${section}${page}`;
}

export function HistoryView() {
  const [histories, setHistories] = useState<ChatHistory[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [openCitation, setOpenCitation] = useState<Citation | null>(null);

  /** 履歴を読み込む。件数はサーバー側の設定に任せる */
  const load = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const rows = await fetchHistories();
      setHistories(rows);

      // 一覧の先頭（最新）を自動で開く。
      // 空の詳細を見せるより、最新の質問がすぐ読める方が確認しやすいため
      setSelectedId((current) => {
        if (current && rows.some((row) => row.id === current)) return current;
        return rows[0]?.id ?? null;
      });
    } catch (error) {
      setErrorMessage(
        error instanceof HistoryApiError
          ? error.userMessage
          : '質問履歴を取得できませんでした。時間をおいてもう一度お試しください。'
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = histories.find((item) => item.id === selectedId) ?? null;

  return (
    <div className={styles.wrap}>
      <div className={styles.list}>
        <div className={styles.listHeader}>
          <span className={styles.listTitle}>質問履歴</span>

          <span className={styles.count}>{histories.length}件</span>

          <button
            type="button"
            className={styles.refreshButton}
            onClick={() => void load()}
            disabled={isLoading}
          >
            <RefreshIcon size={12} />
            更新
          </button>
        </div>

        <div className={styles.listBody}>
          {isLoading && (
            <div className={styles.state}>
              <LoaderIcon size={16} />
              <div>読み込み中です…</div>
            </div>
          )}

          {!isLoading && errorMessage && (
            <div className={`${styles.state} ${styles.stateError}`}>
              {errorMessage}
              <div>
                <button type="button" className={styles.retryButton} onClick={() => void load()}>
                  再読み込み
                </button>
              </div>
            </div>
          )}

          {!isLoading && !errorMessage && histories.length === 0 && (
            <div className={styles.state}>
              まだ質問履歴がありません。
              <br />
              チャット画面で質問すると、ここに記録されます。
            </div>
          )}

          {!isLoading &&
            !errorMessage &&
            histories.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`${styles.item} ${item.id === selectedId ? styles.itemActive : ''}`}
                onClick={() => setSelectedId(item.id)}
                aria-current={item.id === selectedId}
              >
                <span className={styles.itemQuestion}>{item.question}</span>
                <span className={styles.itemMeta}>
                  {formatDateTime(item.created_at)}
                  {item.citations.length > 0 && (
                    <span className={styles.itemBadge}>
                      <FileIcon size={10} />
                      出典{item.citations.length}件
                    </span>
                  )}
                </span>
              </button>
            ))}
        </div>
      </div>

      <div className={styles.detail}>
        {selected ? (
          <>
            <div className={styles.detailQuestionLabel}>質問</div>
            <div className={styles.detailQuestion}>{selected.question}</div>
            <div className={styles.detailTime}>{formatDateTime(selected.created_at)}</div>

            <div className={styles.divider} />

            <div className={styles.detailAnswerLabel}>回答</div>
            <div
              className={`${styles.detailAnswer} ${
                selected.answer === NO_ANSWER_TEXT ? styles.detailAnswerNotFound : ''
              }`}
            >
              {selected.answer}
            </div>

            {/* 出典が無い場合は出典エリアごと表示しない（CLAUDE.md セクション10） */}
            {selected.citations.length > 0 && (
              <div className={styles.citations}>
                <div className={styles.citationsLabel}>出典：</div>
                <div className={styles.citationList}>
                  {selected.citations.map((citation, index) => (
                    <button
                      key={`${citation.document_id}-${citation.page}-${citation.section}-${index}`}
                      type="button"
                      className={styles.citationLink}
                      onClick={() => setOpenCitation(citation)}
                    >
                      <FileIcon size={12} />
                      {formatCitationLabel(citation)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className={styles.emptyDetail}>
            <span className={styles.emptyIcon}>
              <HistoryIcon size={32} />
            </span>
            左の一覧から質問を選ぶと、回答と出典を確認できます。
          </div>
        )}
      </div>

      {/* 出典モーダル（TE-06）。履歴からも根拠の原文を確認できる */}
      <CitationModal citation={openCitation} onClose={() => setOpenCitation(null)} />
    </div>
  );
}
