'use client';

import styles from './MobileHeader.module.css';
import { BellIcon, BookOpenIcon, MenuIcon } from '@/components/icons';

type MobileHeaderProps = {
  /** ハンバーガー押下時。サイドバーをドロワーとして開く */
  onOpenMenu: () => void;
  /** 中央に出す画面名。どの画面にいるかがスマホでも分かるようにする */
  title: string;
};

/**
 * モバイルヘッダー（TC-09・≤640pxのみ表示）
 *
 * 左：ハンバーガーメニュー（低頻度操作をまとめたドロワーを開く）
 * 中：システムロゴ＋画面名
 * 右：通知
 */
export function MobileHeader({ onOpenMenu, title }: MobileHeaderProps) {
  return (
    <header className={styles.header}>
      <button
        type="button"
        className={styles.iconButton}
        onClick={onOpenMenu}
        aria-label="メニューを開く"
      >
        <MenuIcon size={20} />
      </button>

      <div className={styles.center}>
        <div className={styles.logoIcon}>
          <BookOpenIcon size={14} strokeWidth={2.2} />
        </div>
        <div className={styles.title}>{title}</div>
      </div>

      <button type="button" className={styles.iconButton} aria-label="通知">
        <BellIcon size={19} />
      </button>
    </header>
  );
}
