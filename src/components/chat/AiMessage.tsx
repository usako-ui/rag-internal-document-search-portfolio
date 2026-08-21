'use client';

import { useState } from 'react';
import styles from './Message.module.css';
import { CitationModal } from './CitationModal';
import type { AssistantMessage } from '@/types/chat';
import type { Citation } from '@/types/api';
import {
  BookOpenIcon,
  BookmarkIcon,
  FileIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from '@/components/icons';

/**
 * 出典1件の表示ラベルを組み立てる（例：リモートワーク規程 第3条（p.3））
 *
 * 補足：`page` / `section` は null が返ることがある。
 * null のときは項目ごと省き、「（p.）」のような中身のないラベルを出さない。
 */
function formatCitationLabel(citation: Citation): string {
  const section = citation.section ? ` ${citation.section}` : '';
  const page = citation.page ? `（${citation.page}）` : '';
  return `${citation.document_name}${section}${page}`;
}

/**
 * AIの回答吹き出し
 *
 * 表示順序はUI/UX仕様で厳守と定められている：
 *   1. 回答本文 → 2. 根拠・出典 → 3. 関連文書カード → 4. フィードバック
 *
 * has_answer が false（社内文書に根拠がない）場合は、
 * 出典エリアと関連文書カードを表示しない。
 * 空の「出典：」ラベルを出すと、根拠があるかのように誤解させるため。
 */
export function AiMessage({ message }: { message: AssistantMessage }) {
  const { response, time } = message;

  // フィードバックは押下状態の表示のみを保持する（保存機能はMVP範囲外）
  const [feedback, setFeedback] = useState<'helpful' | 'not-helpful' | null>(null);
  const [bookmarked, setBookmarked] = useState(false);

  // 出典モーダルで表示中の出典。null なら閉じている
  const [openCitation, setOpenCitation] = useState<Citation | null>(null);

  // 出典を表示するのは「根拠あり」かつ「出典が1件以上ある」場合のみ
  const showCitations = response.has_answer && response.citations.length > 0;

  return (
    <div className={styles.aiRow}>
      <div className={styles.aiAvatar}>
        <BookOpenIcon size={15} strokeWidth={2.2} />
      </div>

      <div className={styles.aiBody}>
        {/* 1. 回答本文 */}
        <div
          className={`${styles.aiBubble} ${response.has_answer ? '' : styles.aiBubbleNotFound}`}
        >
          {response.answer}
        </div>

        {/* 2. 根拠・出典 */}
        {showCitations && (
          <div className={styles.citations}>
            <div className={styles.citationsLabel}>出典：</div>
            {response.citations.map((citation) => (
              <button
                key={`${citation.document_id}-${citation.page}-${citation.section}`}
                type="button"
                className={styles.citationLink}
                onClick={() => setOpenCitation(citation)}
              >
                <FileIcon size={12} />
                {formatCitationLabel(citation)}
              </button>
            ))}
          </div>
        )}

        {/* 3. 関連文書カード */}
        {showCitations && (
          <div className={styles.docCards}>
            {response.citations.map((citation) => (
              <button
                key={`card-${citation.document_id}-${citation.page}-${citation.section}`}
                type="button"
                className={styles.docCard}
                onClick={() => setOpenCitation(citation)}
              >
                <span className={styles.docPdfIcon}>
                  <FileIcon size={14} />
                </span>
                <span>
                  <span className={styles.docName}>
                    {citation.document_name}
                    {citation.section ? ` ${citation.section}` : ''}
                  </span>
                  {/* page が null のときは参照箇所の行ごと出さない */}
                  {citation.page && <span className={styles.docRef}>{citation.page}</span>}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* 4. フィードバック */}
        <div className={styles.feedback}>
          <div className={styles.feedbackRow}>
            <button
              type="button"
              className={`${styles.feedbackButton} ${
                feedback === 'helpful' ? styles.feedbackButtonActive : ''
              }`}
              aria-pressed={feedback === 'helpful'}
              onClick={() => setFeedback(feedback === 'helpful' ? null : 'helpful')}
            >
              <ThumbsUpIcon size={11} />
              役に立った
            </button>
            <button
              type="button"
              className={`${styles.feedbackButton} ${
                feedback === 'not-helpful' ? styles.feedbackButtonActive : ''
              }`}
              aria-pressed={feedback === 'not-helpful'}
              onClick={() => setFeedback(feedback === 'not-helpful' ? null : 'not-helpful')}
            >
              <ThumbsDownIcon size={11} />
              役に立たなかった
            </button>
          </div>

          <button
            type="button"
            className={`${styles.bookmarkButton} ${
              bookmarked ? styles.bookmarkButtonActive : ''
            }`}
            aria-label={bookmarked ? 'ブックマークを解除' : 'ブックマークに追加'}
            aria-pressed={bookmarked}
            onClick={() => setBookmarked(!bookmarked)}
          >
            <BookmarkIcon size={14} filled={bookmarked} />
          </button>
        </div>

        <div className={styles.time}>{time}</div>
      </div>

      {/* 出典モーダル。出典リンク・関連文書カードのどちらからでも開く */}
      <CitationModal citation={openCitation} onClose={() => setOpenCitation(null)} />
    </div>
  );
}
