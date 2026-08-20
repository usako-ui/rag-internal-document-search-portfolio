import type { NavId } from '@/types/navigation';

/**
 * ナビゲーションと画面URLの対応
 *
 * すべてのナビが独立した画面を持つ（2026-08-18の構成変更）。
 * 以前は「チャット画面の中で表示を切り替えるナビ」と「ページ遷移するナビ」が
 * 混在していて、現在地がURLに現れないものがあった。
 * 全ナビをURLで表せるようにしたことで、ブラウザの戻る／進む・ブックマーク・
 * 直接リンクがすべての画面で使えるようになる。
 *
 * 【遷移方法について】
 * 画面遷移は `window.location.href` を使う（CLAUDE.md セクション8）。
 * Next.jsのルーターキャッシュにログイン中の画面が残らないようにするため。
 */

/** チャット画面のパス（`/` は公開ランディングページのため別パス） */
export const CHAT_PATH = '/chat';

/**
 * 「新しい質問」をクリックしたことを示すURLパラメータ。
 *
 * チャット画面はこの値を見て会話履歴をリセットする。
 * 遷移先を `/chat` のままにすると「今の会話を続けたいのか」「新しく始めたいのか」を
 * 画面側が区別できないため、意図をURLへ明示している。
 */
export const NEW_CHAT_PARAM = 'new';

/** 「新しい質問」の遷移先（会話をリセットした状態でチャットを開く） */
export const NEW_CHAT_PATH = `${CHAT_PATH}?${NEW_CHAT_PARAM}=1`;

/**
 * ログイン後の初期画面。
 * 2026-08-18の構成変更でチャットからダッシュボードへ変更した。
 */
export const HOME_PATH = '/dashboard';

/** 各ナビの遷移先 */
export const NAV_ROUTES: Record<NavId, string> = {
  chat: NEW_CHAT_PATH,
  documents: '/documents',
  search: '/search',
  history: '/histories',
  dashboard: '/dashboard',
  settings: '/settings',
};

/** ナビの遷移先URLを返す */
export function getNavRoute(id: NavId): string {
  return NAV_ROUTES[id];
}
