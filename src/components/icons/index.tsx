import type { ReactNode } from 'react';

/**
 * アイコン集（Lucide Icons をインラインSVGとして実装）
 *
 * UI/UX仕様の規約：
 *  - アイコンはLucide Iconsのみ・stroke-width は 2〜2.2
 *  - 絵文字・イラストは使用しない
 *
 * ライブラリを追加せずインラインSVGで持つことで、デザインリファレンスと
 * 完全に同じ描画になり、バンドルサイズも増えない。
 *
 * ------------------------------------------------------------
 * 【第三者著作物の表示】
 *
 * このファイルのSVGパスデータは Lucide（https://lucide.dev/）のものです。
 * Lucide は ISC License、Feather 由来の部分は MIT License で提供されており、
 * いずれも**著作権表示を保持すること**が利用条件です。
 *
 *   Copyright (c) 2026 Lucide Icons and Contributors        (ISC License)
 *   Copyright (c) 2013-present Cole Bemis                   (MIT License / Feather)
 *
 * ライセンス全文は、リポジトリ直下の NOTICE.md に記載しています。
 * **アイコンを追加・変更する場合も、この表示を削除しないこと。**
 * ------------------------------------------------------------
 */

export type IconProps = {
  /** 一辺のピクセル数（正方形） */
  size?: number;
  strokeWidth?: number;
  className?: string;
};

/** 全アイコン共通のSVGラッパー。色は currentColor で親から継承する */
function IconBase({
  size = 15,
  strokeWidth = 2,
  className,
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** システムロゴ・AIアバターに使用 */
export function BookOpenIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </IconBase>
  );
}

/** 「新しい質問」ボタン */
export function PlusCircleIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </IconBase>
  );
}

/** チャット・質問 */
export function MessageSquareIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </IconBase>
  );
}

/** PDFアップロード */
export function UploadIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </IconBase>
  );
}

/** 資料更新・再インデックス */
export function RefreshIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </IconBase>
  );
}

/** 質問履歴 */
export function HistoryIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </IconBase>
  );
}

/** 文書一覧（本文行あり） */
export function FileTextIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </IconBase>
  );
}

/** 出典リンク・PDFカード（本文行なし） */
export function FileIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </IconBase>
  );
}

/** 設定（歯車） */
export function SettingsIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </IconBase>
  );
}

/** 通知 */
export function BellIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </IconBase>
  );
}

/** モバイルのハンバーガーメニュー */
export function MenuIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </IconBase>
  );
}

/** 閉じる */
export function XIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </IconBase>
  );
}

/** フィードバック：役に立った */
export function ThumbsUpIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z" />
      <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
    </IconBase>
  );
}

/** フィードバック：役に立たなかった */
export function ThumbsDownIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z" />
      <path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
    </IconBase>
  );
}

/** ブックマーク */
export function BookmarkIcon(props: IconProps & { filled?: boolean }) {
  const { filled, ...rest } = props;
  return (
    <svg
      width={rest.size ?? 15}
      height={rest.size ?? 15}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={rest.strokeWidth ?? 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={rest.className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/** 添付（入力バー） */
export function PaperclipIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </IconBase>
  );
}

/** 送信 */
export function SendIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </IconBase>
  );
}

/** ヘルプ */
export function HelpCircleIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </IconBase>
  );
}

/** エラー表示 */
export function AlertCircleIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </IconBase>
  );
}

/** 処理完了（検索可能） */
export function CheckCircleIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </IconBase>
  );
}

/** 処理中（回転させて使う） */
export function LoaderIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </IconBase>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <polyline points="6 9 12 15 18 9" />
    </IconBase>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <polyline points="9 18 15 12 9 6" />
    </IconBase>
  );
}

/** ログアウト */
export function LogOutIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </IconBase>
  );
}

/** 検索（ランディングのフィーチャーカード用） */
export function SearchIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </IconBase>
  );
}

/** 鍵（ランディングのフィーチャーカード用） */
export function LockIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </IconBase>
  );
}

/** 再生（ランディングのCTAボタン用） */
export function PlayIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <polygon points="5 3 19 12 5 21 5 3" />
    </IconBase>
  );
}

/** ログイン（ランディングのCTAボタン用） */
export function LogInIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </IconBase>
  );
}

/** 新しい質問（サイドバーのナビ項目・ダッシュボードのクイックアクション） */
export function MessageSquarePlusIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <line x1="9" y1="10" x2="15" y2="10" />
      <line x1="12" y1="7" x2="12" y2="13" />
    </IconBase>
  );
}

/** 文書管理（アップロード・更新をまとめた画面へのナビ） */
export function FolderUpIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
      <path d="M12 10v6" />
      <path d="m9 13 3-3 3 3" />
    </IconBase>
  );
}

/** ダッシュボード（管理ゾーンのナビ・ログイン後の初期画面） */
export function LayoutDashboardIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </IconBase>
  );
}

/** 削除（文書管理の削除操作） */
export function TrashIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </IconBase>
  );
}
