'use client';

import type { ReactNode } from 'react';
import styles from './MobileNav.module.css';
import type { NavId } from '@/types/navigation';
import {
  FolderUpIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  MessageSquarePlusIcon,
  SearchIcon,
} from '@/components/icons';

type MobileNavItem = {
  id: NavId;
  label: string;
  icon: ReactNode;
};

/**
 * ボトムナビの5タブ。
 *
 * サイドバーと同じ構成にそろえている（2026-08-18の構成変更）。
 * 設定はここに入れず、ハンバーガーメニューのドロワー（＝サイドバー）から開く。
 * 利用頻度の高い操作をボトムナビへ残すため（設定は一度決めたら触らない項目）。
 */
const ITEMS: MobileNavItem[] = [
  // ラベルは4文字までにそろえる。5タブが横に並ぶため、
  // これより長いと360px幅の端末で文字が詰まって読めなくなる
  { id: 'dashboard', label: 'ホーム', icon: <LayoutDashboardIcon size={20} /> },
  { id: 'chat', label: '新規質問', icon: <MessageSquarePlusIcon size={20} /> },
  { id: 'documents', label: '文書管理', icon: <FolderUpIcon size={20} /> },
  { id: 'search', label: '文書検索', icon: <SearchIcon size={20} /> },
  { id: 'history', label: '質問履歴', icon: <HistoryIcon size={20} /> },
];

type MobileNavProps = {
  activeNav: NavId;
  onNavChange: (id: NavId) => void;
};

/** ボトムナビゲーション（≤640pxのみ表示） */
export function MobileNav({ activeNav, onNavChange }: MobileNavProps) {
  return (
    <nav className={styles.nav} aria-label="モバイルナビゲーション">
      <div className={styles.inner}>
        {ITEMS.map((item) => {
          const isActive = activeNav === item.id;

          return (
            <button
              key={item.id}
              type="button"
              className={`${styles.item} ${isActive ? styles.active : ''}`}
              onClick={() => onNavChange(item.id)}
              aria-current={isActive ? 'page' : undefined}
            >
              {item.icon}
              <span className={styles.label}>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
