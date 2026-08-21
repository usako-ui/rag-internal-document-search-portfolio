'use client';

import { useEffect, useRef } from 'react';
import styles from './MessageList.module.css';
import messageStyles from './Message.module.css';
import { UserMessage } from './UserMessage';
import { AiMessage } from './AiMessage';
import type { ChatMessage, ErrorMessage } from '@/types/chat';
import { AlertCircleIcon, BookOpenIcon, LoaderIcon, RefreshIcon } from '@/components/icons';

/**
 * 会話がまだ無いときに出す質問例。
 * UX優先順位1位「質問しやすい」に対応し、押すとそのまま送信できるようにする。
 * project-overview.md セクション8のサンプル5文書に沿った内容にしている。
 */
const EXAMPLE_QUESTIONS = [
  '在宅勤務手当はいくらですか？',
  '経費精算の申請期限を教えてください',
  '社内ITツールの利用申請はどうすればよいですか？',
];

/**
 * 回答取得に失敗したときの表示。
 * 「失敗しました」だけで終わらせず、次に取るべき行動（再送信）まで示す。
 */
function ErrorMessageCard({
  message,
  onRetry,
}: {
  message: ErrorMessage;
  onRetry: (question: string) => void;
}) {
  return (
    <div className={messageStyles.errorRow} role="alert">
      <div className={messageStyles.errorBubble}>
        <span className={messageStyles.errorIcon}>
          <AlertCircleIcon size={16} />
        </span>
        <span className={messageStyles.errorBody}>
          {message.text}
          <button
            type="button"
            className={messageStyles.retryButton}
            onClick={() => onRetry(message.question)}
          >
            <RefreshIcon size={12} strokeWidth={2.2} />
            同じ質問をもう一度送信
          </button>
        </span>
      </div>
    </div>
  );
}

/** 回答生成中のローディング表示 */
function LoadingMessage() {
  return (
    <div className={messageStyles.aiRow} aria-live="polite">
      <div className={messageStyles.loadingBubble}>
        <span className={messageStyles.spinner}>
          <LoaderIcon size={14} />
        </span>
        回答を作成しています...
      </div>
    </div>
  );
}

/**
 * 会話が空のときの表示。
 * 実際の回答が無い状態でサンプル会話を見せると
 * 「AIが答えた」と誤解させるため、質問例の提示にとどめる。
 */
function EmptyState({ onSelectExample }: { onSelectExample: (question: string) => void }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon}>
        <BookOpenIcon size={22} strokeWidth={2.2} />
      </span>
      <h2 className={styles.emptyTitle}>社内文書について質問してください</h2>
      <p className={styles.emptyText}>
        登録済みの社内文書を根拠に回答します。文書に記載がない内容は推測せず、
        「該当する情報を社内文書から確認できませんでした。」とお答えします。
      </p>

      <div className={styles.exampleLabel}>質問例</div>
      <div className={styles.examples}>
        {EXAMPLE_QUESTIONS.map((question) => (
          <button
            key={question}
            type="button"
            className={styles.exampleButton}
            onClick={() => onSelectExample(question)}
          >
            {question}
          </button>
        ))}
      </div>
    </div>
  );
}

type MessageListProps = {
  messages: ChatMessage[];
  /** 回答生成中かどうか */
  isLoading: boolean;
  /** 質問例の選択・エラー後の再送信で質問を送る */
  onSend: (question: string) => void;
};

/**
 * チャットのメッセージ一覧。
 * 新しいメッセージが追加されたら最下部へ自動スクロールする
 * （質問直後に自分でスクロールさせないことが「質問しやすい」に直結するため）。
 */
export function MessageList({ messages, isLoading, onSend }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isLoading]);

  const isEmpty = messages.length === 0 && !isLoading;

  return (
    <div className={styles.messages}>
      {isEmpty && <EmptyState onSelectExample={onSend} />}

      {messages.map((message) => {
        switch (message.role) {
          case 'user':
            return <UserMessage key={message.id} message={message} />;
          case 'assistant':
            return <AiMessage key={message.id} message={message} />;
          case 'error':
            return <ErrorMessageCard key={message.id} message={message} onRetry={onSend} />;
          default:
            return null;
        }
      })}

      {isLoading && <LoadingMessage />}

      <div ref={bottomRef} />
    </div>
  );
}
