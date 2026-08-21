'use client';

import { useState, type ReactNode } from 'react';
import styles from './Sidebar.module.css';
import type { NavId } from '@/types/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { LOGIN_PATH } from '@/lib/auth/redirect';
import {
  BookOpenIcon,
  FolderUpIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MessageSquarePlusIcon,
  PlusCircleIcon,
  SearchIcon,
  SettingsIcon,
} from '@/components/icons';

/** ナビ1項目の定義 */
type NavItem = {
  id: NavId;
  /** PC表示のラベル */
  name: string;
  /** タブレット（80px幅）表示の短縮ラベル */
  tabletLabel: string;
  /** 操作の補足説明。何がまとまっている画面かが分かりにくい項目のみ設定する */
  sub?: string;
  icon: ReactNode;
};

/**
 * ナビゲーションゾーン。
 *
 * UX優先順位1〜4位（質問しやすい・PDFを追加しやすい・資料を更新しやすい・
 * 根拠を確認しやすい）に対応する画面を、すべてこの4項目で入口を1つにまとめている。
 * この4項目をメニューの奥に隠してはいけない（UI/UX仕様）。
 *
 * 【2026-08-18 構成変更】
 * 以前は「PDFアップロード」「資料更新」「検索フィルター」「文書一覧」が
 * 別々のナビになっていたが、同じ目的の操作が分散していて入口が分かりにくかった。
 *   PDFアップロード + 資料更新 → 文書管理
 *   検索フィルター + 文書一覧   → 文書を検索
 * お気に入りはMVPで機能を実装していないため削除した（押しても何も起きないナビを残さない）。
 */
const NAV_ITEMS: NavItem[] = [
  {
    id: 'chat',
    name: '新しい質問',
    tabletLabel: '質問',
    icon: <MessageSquarePlusIcon />,
  },
  {
    id: 'documents',
    name: '文書管理',
    tabletLabel: '文書',
    sub: 'アップロード・更新',
    icon: <FolderUpIcon />,
  },
  {
    id: 'search',
    name: '文書を検索',
    tabletLabel: '検索',
    sub: 'フィルター・文書一覧',
    icon: <SearchIcon />,
  },
  {
    id: 'history',
    name: '質問履歴',
    tabletLabel: '履歴',
    icon: <HistoryIcon />,
  },
];

/** 管理ゾーン（下部・区切り線で分離する） */
const ADMIN_ITEMS: NavItem[] = [
  { id: 'dashboard', name: 'ダッシュボード', tabletLabel: '概要', icon: <LayoutDashboardIcon /> },
  { id: 'settings', name: '設定', tabletLabel: '設定', icon: <SettingsIcon /> },
];

type SidebarProps = {
  activeNav: NavId;
  onNavChange: (id: NavId) => void;
  /** 「新しい質問」ボタン押下時。会話をリセットする */
  onNewQuestion: () => void;
  /** ログイン中ユーザーのメールアドレス（サーバー側でセッションから取得した値） */
  userEmail: string;
  /** スマホでドロワーとして開いているか */
  isDrawerOpen?: boolean;
  onCloseDrawer?: () => void;
};

/**
 * メールアドレスからアバターの2文字を作る（例：qa-tester@… → QA）。
 * 画像を持たないため、識別できる文字列を機械的に生成する。
 */
function getAvatarInitials(email: string): string {
  const localPart = email.split('@')[0] ?? '';
  const letters = localPart.replace(/[^a-zA-Z0-9]/g, '');
  return (letters.slice(0, 2) || 'US').toUpperCase();
}

/**
 * サイドバー（PC・タブレット共通）
 *
 * PC（>1024px）：240px・全ラベル表示
 * タブレット（≤1024px）：80px・アイコン＋短縮ラベル縦並び
 * スマホ（≤640px）：非表示（ボトムナビへ切り替え）
 */
export function Sidebar({
  activeNav,
  onNavChange,
  onNewQuestion,
  userEmail,
  isDrawerOpen = false,
  onCloseDrawer,
}: SidebarProps) {
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  /**
   * ログアウト（要件F-06）
   *
   * セッションCookieを破棄してからログイン画面へ遷移する。
   * 遷移に `window.location.href` を使うのは、Next.jsのルーターキャッシュに
   * ログイン中の画面が残らないようにするため（コーディング規約）。
   */
  const handleLogout = async () => {
    setIsLoggingOut(true);

    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
    } catch (error) {
      // 通信に失敗してもログイン画面へは送る（ログアウト操作を空振りさせない）。
      // 原因追跡のためコンソールには残す
      console.error('[ログアウト] セッションの破棄に失敗:', error);
    }

    window.location.href = LOGIN_PATH;
  };

  /** ナビ項目1件を描画する */
  const renderItem = (item: NavItem) => {
    const isActive = activeNav === item.id;

    return (
      <button
        key={item.id}
        type="button"
        className={`${styles.item} ${isActive ? styles.active : ''}`}
        onClick={() => {
          onNavChange(item.id);
          onCloseDrawer?.();
        }}
        aria-current={isActive ? 'page' : undefined}
      >
        <span className={styles.itemIcon}>{item.icon}</span>
        <span className={styles.itemText}>
          <span className={styles.itemName}>{item.name}</span>
          {item.sub && <span className={styles.itemSub}>{item.sub}</span>}
        </span>
        <span className={styles.itemTabletLabel}>{item.tabletLabel}</span>
      </button>
    );
  };

  return (
    <>
      {/* スマホでドロワーを開いたときの背面オーバーレイ */}
      <button
        type="button"
        className={isDrawerOpen ? styles.overlayVisible : styles.overlay}
        onClick={onCloseDrawer}
        aria-label="メニューを閉じる"
        tabIndex={isDrawerOpen ? 0 : -1}
      />

      <aside className={`${styles.sidebar} ${isDrawerOpen ? styles.drawerOpen : ''}`}>
      <div className={styles.logo}>
        <div className={styles.logoIcon}>
          <BookOpenIcon size={18} />
        </div>
        <div className={styles.logoText}>
          社内文書
          <br />
          検索AI
        </div>
      </div>

      {/* クイック操作ゾーン：質問への導線を最上位に置く（UX優先順位1位） */}
      <div className={styles.sectionLabel}>クイック操作</div>

      <button
        type="button"
        className={styles.newButton}
        onClick={() => {
          onNewQuestion();
          onCloseDrawer?.();
        }}
      >
        <PlusCircleIcon size={15} strokeWidth={2.2} />
        <span className={styles.newButtonText}>新しい質問</span>
      </button>

      <nav className={styles.nav} aria-label="メインナビゲーション">
        <div className={styles.sectionLabel}>メニュー</div>

        {NAV_ITEMS.map(renderItem)}

        <div className={styles.divider} />
        <div className={styles.sectionLabel} style={{ paddingTop: 4 }}>
          管理
        </div>

        {ADMIN_ITEMS.map(renderItem)}
      </nav>

      {/* ユーザーフッター：ログイン中のアカウントとログアウト（F-05・F-06） */}
      <div className={styles.user}>
        <span className={styles.avatar}>{getAvatarInitials(userEmail)}</span>
        <span className={styles.userInfo}>
          <span className={styles.userName}>ログイン中</span>
          <span className={styles.userEmail} title={userEmail}>
            {userEmail}
          </span>
        </span>
        <button
          type="button"
          className={styles.logoutButton}
          onClick={handleLogout}
          disabled={isLoggingOut}
          aria-label="ログアウト"
          title="ログアウト"
        >
          <LogOutIcon size={14} />
        </button>
      </div>
      </aside>
    </>
  );
}
