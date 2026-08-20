import styles from './ChatHeader.module.css';
import { BellIcon, SearchIcon } from '@/components/icons';
import { NAV_ROUTES } from '@/lib/navigation/routes';

type ChatHeaderProps = {
  /** 画面タイトル。文書一覧など他画面でも使い回すため差し替えられるようにしている */
  title?: string;
  sub?: string;
};

/**
 * 画面上部のヘッダー（TC-03）
 *
 * 左：画面タイトル＋サブテキスト
 * 右：文書を検索・通知
 *
 * 【2026-08-18 変更】
 * 右上のボタンは「検索フィルター」という名前で何も起きないボタンだった。
 * 絞り込み機能は `/search`（文書を検索）へ統合したため、そこへのリンクにしている。
 */
export function ChatHeader({
  title = 'チャット',
  sub = '社内文書について質問してください',
}: ChatHeaderProps) {
  return (
    <div className={styles.header}>
      <div className={styles.left}>
        <div>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.sub}>{sub}</p>
        </div>
      </div>

      <div className={styles.right}>
        {/* ページ遷移は <a> タグを使う（CLAUDE.md セクション8・ルーターキャッシュ回避） */}
        <a href={NAV_ROUTES.search} className={styles.filterButton}>
          <SearchIcon size={12} strokeWidth={2.2} />
          <span className={styles.filterButtonLabel}>文書を検索</span>
        </a>
        <button type="button" className={styles.iconButton} aria-label="通知">
          <BellIcon size={14} />
        </button>
      </div>
    </div>
  );
}
