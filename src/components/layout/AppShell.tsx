'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './AppShell.module.css';
import { Sidebar } from './Sidebar';
import { MobileHeader } from './MobileHeader';
import { MobileNav } from './MobileNav';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { MessageList } from '@/components/chat/MessageList';
import { InputBar } from '@/components/chat/InputBar';
import type { NavId } from '@/types/navigation';
import type { ChatMessage } from '@/types/chat';
import { formatTime } from '@/lib/format';
import { ChatApiError, DEFAULT_CHAT_ERROR_MESSAGE, postChat } from '@/lib/api/chat';
import { saveHistory } from '@/lib/api/histories';
import { CHAT_PATH, NEW_CHAT_PARAM, getNavRoute } from '@/lib/navigation/routes';

/**
 * チャット画面のレイアウトと会話状態を束ねるコンポーネント。
 *
 * チャットは `POST /api/chat`（Worktree B実装）を呼び出す（TC-10）。
 * 受け取った ChatResponse はそのまま AssistantMessage として保持し、
 * 表示（回答→出典→関連文書→フィードバックの順）は AiMessage が担当する。
 *
 * 【2026-08-18 構成変更】
 * 文書一覧・アップロードパネルはこの画面から `/documents`（文書管理）へ移した。
 * 1つの画面が「質問」と「文書の管理」の両方を抱えていて、
 * どちらの操作をしているのかがURLからも見た目からも分からなかったため。
 * この画面の責務は「質問して回答を読む」だけに絞っている。
 */
type AppShellProps = {
  /** ログイン中ユーザーのメールアドレス。page.tsx がサーバー側のセッションから渡す */
  userEmail: string;
};

export function AppShell({ userEmail }: AppShellProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isMenuDrawerOpen, setIsMenuDrawerOpen] = useState(false);

  // メッセージIDの採番用。描画のたびに値が変わらないようrefで保持する
  const messageCountRef = useRef(0);
  // アンマウント後にstateを更新しないためのフラグ
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /**
   * 「新しい質問」で遷移してきたときの会話リセット（`/chat?new=1`）。
   *
   * 他画面から遷移してきた直後は会話が空なので実害はないが、
   * 「リセットを要求された」という意図を画面側で必ず受け取る形にしておく。
   * 処理後はURLからパラメータを取り除く。残したままだとリロードのたびに
   * リセット扱いになり、ブックマークした人が意図しない挙動に出会うため。
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get(NEW_CHAT_PARAM) !== '1') return;

    setMessages([]);
    setIsLoading(false);
    window.history.replaceState(null, '', CHAT_PATH);
  }, []);

  const createMessageId = () => {
    messageCountRef.current += 1;
    return `msg-${messageCountRef.current}`;
  };

  /**
   * 質問を送信する（TC-10・TC-11・TC-12）。
   *
   * 1. 質問を吹き出しとして即座に追加する（送信できたことをすぐ伝える）
   * 2. ローディングを出し、入力を無効化する（TC-11）
   * 3. `POST /api/chat` の応答を AI 吹き出しとして追加する
   * 4. 失敗したらエラー吹き出しを出し、同じ質問を再送信できるようにする（TC-12）
   *
   * `has_answer: false` のときの出典エリア非表示は AiMessage 側で判定している。
   */
  const handleSend = async (question: string) => {
    // 連投で応答が混ざらないよう、回答生成中は新しい送信を受け付けない
    if (isLoading) return;

    setMessages((previous) => [
      ...previous,
      { role: 'user', id: createMessageId(), text: question, time: formatTime(new Date()) },
    ]);
    setIsLoading(true);

    try {
      const response = await postChat(question);
      if (!isMountedRef.current) return;

      setMessages((previous) => [
        ...previous,
        {
          role: 'assistant',
          id: createMessageId(),
          time: formatTime(new Date()),
          response,
        },
      ]);

      // 履歴の自動保存（TE-03・Q-39）。
      // 保存に失敗しても回答は表示できているため、質問体験は止めない
      // （UX優先順位1位「質問しやすい」を守る）。原因追跡のためログには残す。
      void saveHistory({
        question,
        answer: response.answer,
        citations: response.citations,
      }).catch((error: unknown) => {
        console.error('[質問履歴] 保存に失敗:', error);
      });
    } catch (error) {
      if (!isMountedRef.current) return;

      setMessages((previous) => [
        ...previous,
        {
          role: 'error',
          id: createMessageId(),
          time: formatTime(new Date()),
          text: error instanceof ChatApiError ? error.userMessage : DEFAULT_CHAT_ERROR_MESSAGE,
          // 再送信ボタンで同じ質問をやり直せるよう保持する
          question,
        },
      ]);
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  };

  /**
   * 「新しい質問」：会話をリセットして質問しやすい状態に戻す。
   *
   * すでにチャット画面にいるため、画面遷移せずその場でリセットする
   * （ページを読み込み直すより速く、入力欄にすぐ書き始められる）。
   */
  const handleNewQuestion = () => {
    setMessages([]);
    setIsLoading(false);
    setIsMenuDrawerOpen(false);
  };

  /**
   * ナビ選択時の処理。
   *
   * 「新しい質問」だけはこの画面での操作なのでその場でリセットし、
   * それ以外は各画面へ遷移する。
   * `window.location.href` を使うのはNext.jsのルーターキャッシュ回避のため
   * （CLAUDE.md セクション8）。
   */
  const handleNavChange = (id: NavId) => {
    if (id === 'chat') {
      handleNewQuestion();
      return;
    }

    window.location.href = getNavRoute(id);
  };

  return (
    <div className={styles.app}>
      <Sidebar
        activeNav="chat"
        onNavChange={handleNavChange}
        onNewQuestion={handleNewQuestion}
        userEmail={userEmail}
        isDrawerOpen={isMenuDrawerOpen}
        onCloseDrawer={() => setIsMenuDrawerOpen(false)}
      />

      <MobileHeader onOpenMenu={() => setIsMenuDrawerOpen(true)} title="チャット" />

      <main className={styles.main}>
        <ChatHeader title="チャット" sub="社内文書について質問してください" />

        <div className={styles.content}>
          <div className={styles.chatColumn}>
            <MessageList
              messages={messages}
              isLoading={isLoading}
              onSend={(question) => void handleSend(question)}
            />

            {/* 免責テキスト：入力バーの直上に固定する */}
            <div className={styles.disclaimer}>
              ※ AIの回答は参考情報です。必ず文書の内容をご確認ください。
            </div>

            <InputBar onSend={(question) => void handleSend(question)} disabled={isLoading} />
          </div>
        </div>
      </main>

      <MobileNav activeNav="chat" onNavChange={handleNavChange} />
    </div>
  );
}
