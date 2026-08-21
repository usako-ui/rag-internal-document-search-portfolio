'use client';

import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import styles from './InputBar.module.css';
import { PaperclipIcon, SendIcon } from '@/components/icons';

/** textareaの最大の高さ（px）。これを超えたら内部スクロールに切り替える */
const MAX_TEXTAREA_HEIGHT = 100;

type InputBarProps = {
  onSend: (question: string) => void;
  /** 回答生成中は true。入力と送信を無効化する */
  disabled?: boolean;
};

/**
 * 質問入力バー
 *
 * - Enterで送信・Shift+Enterで改行
 * - 入力量に応じてtextareaが自動伸長する（最大100px）
 * - 回答生成中は入力・送信を無効化する
 */
export function InputBar({ onSend, disabled = false }: InputBarProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /** 入力内容に合わせてtextareaの高さを調整する */
  const adjustHeight = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setValue(event.target.value);
    adjustHeight();
  };

  /** 質問を送信して入力欄をリセットする */
  const handleSend = () => {
    const question = value.trim();
    if (!question || disabled) return;

    onSend(question);
    setValue('');

    // 高さを初期状態へ戻す
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Shift+Enterは改行として扱い、Enterのみで送信する
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const canSend = value.trim().length > 0 && !disabled;

  return (
    <div className={styles.wrap}>
      <div className={`${styles.row} ${disabled ? styles.rowDisabled : ''}`}>
        <button
          type="button"
          className={styles.clipButton}
          aria-label="ファイルを添付"
          disabled={disabled}
        >
          <PaperclipIcon size={16} />
        </button>

        <textarea
          ref={textareaRef}
          className={styles.input}
          placeholder="質問を入力してください..."
          rows={1}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-label="質問を入力"
        />

        <button
          type="button"
          className={styles.sendButton}
          onClick={handleSend}
          disabled={!canSend}
          aria-label="質問を送信"
        >
          <SendIcon size={15} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  );
}
