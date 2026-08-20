'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './DemoChat.module.css';
import { MessageList } from '@/components/chat/MessageList';
import { InputBar } from '@/components/chat/InputBar';
import { DemoChatError, askDemo } from '@/lib/demo/gemini';
import { clearDemoData, loadApiKey, loadMessages, saveMessages } from '@/lib/demo/storage';
import { formatTime } from '@/lib/format';
import type { ChatMessage } from '@/types/chat';
import { BookOpenIcon, LoaderIcon, MessageSquareIcon, SettingsIcon } from '@/components/icons';

/**
 * デモ用チャット画面（BYOKデモ STEP C）
 *
 * 本番との違い：
 *  - 認証なし・Supabase不使用。すべてブラウザ内で完結する
 *  - Gemini APIをブラウザから直接呼ぶ（APIキーはサーバーへ送らない）
 *  - 会話履歴はブラウザ内に保存し、タブを閉じると消える
 *
 * 吹き出し（MessageList・AiMessage）と入力バー（InputBar）は本番と同じものを流用する。
 * 出典モーダル（TE-06）もそのまま動くため、デモでも根拠の原文を確認できる。
 */

/** APIキー入力画面のパス */
const DEMO_KEY_PATH = '/demo';

export function DemoChat() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  /** APIキーの確認が終わるまでチャットを描画しない */
  const [isReady, setIsReady] = useState(false);

  const messageCountRef = useRef(0);
  const isMountedRef = useRef(true);

  // APIキーと会話履歴の復元。
  // sessionStorage はサーバー側に存在しないため、マウント後に読む
  useEffect(() => {
    isMountedRef.current = true;

    const storedKey = loadApiKey();

    if (!storedKey) {
      // キー未設定でチャットを触らせない（呼び出しが必ず失敗するため）
      window.location.href = DEMO_KEY_PATH;
      return;
    }

    setApiKey(storedKey);
    setMessages(loadMessages());
    setIsReady(true);

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /** 会話履歴をブラウザ内へ保存する */
  useEffect(() => {
    if (!isReady) return;
    saveMessages(messages);
  }, [messages, isReady]);

  const createMessageId = () => {
    messageCountRef.current += 1;
    return `demo-msg-${messageCountRef.current}`;
  };

  /**
   * 質問を送信する。
   *
   * 本番のAppShellと同じ流れ（質問を即表示 → ローディング → 回答 or エラー）にして、
   * デモと本番で操作感が変わらないようにする。
   */
  const handleSend = async (question: string) => {
    // 連投で応答が混ざらないよう、回答生成中は新しい送信を受け付けない
    if (isLoading || !apiKey) return;

    setMessages((previous) => [
      ...previous,
      { role: 'user', id: createMessageId(), text: question, time: formatTime(new Date()) },
    ]);
    setIsLoading(true);

    try {
      const response = await askDemo(question, apiKey);
      if (!isMountedRef.current) return;

      setMessages((previous) => [
        ...previous,
        { role: 'assistant', id: createMessageId(), time: formatTime(new Date()), response },
      ]);
    } catch (error) {
      if (!isMountedRef.current) return;

      setMessages((previous) => [
        ...previous,
        {
          role: 'error',
          id: createMessageId(),
          time: formatTime(new Date()),
          text:
            error instanceof DemoChatError
              ? error.userMessage
              : '回答の取得に失敗しました。もう一度お試しください。',
          question,
        },
      ]);
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  };

  /** APIキーを変更する。今のキーと履歴を消してから入力画面へ戻す */
  const handleChangeApiKey = () => {
    clearDemoData();
    window.location.href = DEMO_KEY_PATH;
  };

  if (!isReady) {
    return (
      <div className={styles.screen}>
        <div className={styles.loading}>
          <LoaderIcon size={16} />
          読み込み中です…
        </div>
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.logo}>
            <BookOpenIcon size={16} strokeWidth={2.2} />
          </span>

          <div className={styles.titleGroup}>
            <div className={styles.title}>
              社内文書検索AI
              <span className={styles.badge}>
                <MessageSquareIcon size={11} strokeWidth={2.2} />
                デモモード
              </span>
            </div>
            <div className={styles.sub}>サンプル社内文書5件を対象に検索します</div>
          </div>
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.actionLink} onClick={handleChangeApiKey}>
            <SettingsIcon size={13} />
            <span className={styles.actionLabel}>APIキーを変更する</span>
          </button>
        </div>
      </header>

      <div className={styles.content}>
        <MessageList
          messages={messages}
          isLoading={isLoading}
          onSend={(question) => void handleSend(question)}
        />

        <div className={styles.disclaimer}>
          ※ AIの回答は参考情報です。デモの文書はサンプルであり、実在の規程ではありません。
        </div>

        <InputBar onSend={(question) => void handleSend(question)} disabled={isLoading} />
      </div>
    </div>
  );
}
