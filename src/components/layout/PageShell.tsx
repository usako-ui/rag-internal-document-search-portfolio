'use client';

import { useState, type ReactNode } from 'react';
import styles from './AppShell.module.css';
import { Sidebar } from './Sidebar';
import { MobileHeader } from './MobileHeader';
import { MobileNav } from './MobileNav';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { NEW_CHAT_PATH, getNavRoute } from '@/lib/navigation/routes';
import type { NavId } from '@/types/navigation';

/**
 * チャット以外の独立ページ（ダッシュボード・文書管理・文書を検索・質問履歴・設定）用のレイアウト
 *
 * サイドバー・モバイルヘッダー・ボトムナビをチャット画面と共通にして、
 * どの画面にいても同じ操作でどこへでも行けるようにする。
 *
 * チャットの状態（メッセージ・送信中フラグ）を持たないため、
 * AppShell とは別のコンポーネントにしている。
 */

type PageShellProps = {
  /** サイドバー・ボトムナビで現在地として強調するナビ */
  activeNav: NavId;
  userEmail: string;
  /** ヘッダーのタイトル */
  title: string;
  /** ヘッダーの補足説明 */
  sub: string;
  children: ReactNode;
};

export function PageShell({ activeNav, userEmail, title, sub, children }: PageShellProps) {
  const [isMenuDrawerOpen, setIsMenuDrawerOpen] = useState(false);

  /**
   * ナビ選択時の遷移。
   *
   * 現在地と同じナビを押したときは遷移しない（同じページを読み込み直すだけになるため）。
   * `window.location.href` を使うのはNext.jsのルーターキャッシュ回避のため
   * （コーディング規約）。
   */
  const handleNavChange = (id: NavId) => {
    if (id === activeNav) {
      setIsMenuDrawerOpen(false);
      return;
    }

    window.location.href = getNavRoute(id);
  };

  return (
    <div className={styles.app}>
      <Sidebar
        activeNav={activeNav}
        onNavChange={handleNavChange}
        // 「新しい質問」はチャット画面での操作。
        // `?new=1` を付けて、チャット画面側が会話のリセットを検知できるようにする
        onNewQuestion={() => {
          window.location.href = NEW_CHAT_PATH;
        }}
        userEmail={userEmail}
        isDrawerOpen={isMenuDrawerOpen}
        onCloseDrawer={() => setIsMenuDrawerOpen(false)}
      />

      <MobileHeader onOpenMenu={() => setIsMenuDrawerOpen(true)} title={title} />

      <main className={styles.main}>
        <ChatHeader title={title} sub={sub} />

        <div className={styles.content}>{children}</div>
      </main>

      <MobileNav activeNav={activeNav} onNavChange={handleNavChange} />
    </div>
  );
}
