import type { ChatMessage } from '@/types/chat';

/**
 * デモモードのブラウザ内保存（BYOKデモ・STEP B・STEP C）
 *
 * 【sessionStorage を使う理由】
 * 指示は「localStorageに保存」「ページを閉じると履歴・APIキーは消える」の2点だが、
 * localStorage はタブを閉じてもディスクに残り続けるため、この2つは両立しない。
 * **利用者へ約束する動作（閉じたら消える）を正**とし、タブを閉じると破棄される
 * sessionStorage を採用している。
 *
 * 預かっているのは利用者本人のGemini APIキーであり、
 * 「消えるつもりのキーが端末に残り続ける」状態は避けるべきと判断した。
 * localStorage 固定が要件になった場合は、画面の説明文も
 * 「明示的に削除するまで端末に残る」へ必ず変更すること。
 *
 * 【サーバーには送らない】
 * ここで扱う値はすべてブラウザ内のみで完結する。
 * APIキーをサーバーへ送信・ログ出力してはならない。
 */

/** APIキーの保存キー */
const API_KEY_STORAGE_KEY = 'rag-demo-api-key';

/** 会話履歴の保存キー */
const MESSAGES_STORAGE_KEY = 'rag-demo-messages';

/**
 * sessionStorage を安全に取得する。
 *
 * サーバーサイドレンダリング時や、ブラウザ設定でストレージが無効な場合は null を返す。
 * ここで例外が出ると画面全体が真っ白になるため、必ず握りつぶして呼び出し側で分岐させる。
 */
function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;

  try {
    return window.sessionStorage;
  } catch {
    // プライベートブラウジング等でアクセスが拒否される場合がある
    return null;
  }
}

/** 保存されているAPIキーを取得する。未設定なら null */
export function loadApiKey(): string | null {
  const storage = getStorage();
  if (!storage) return null;

  const value = storage.getItem(API_KEY_STORAGE_KEY);
  return value && value.trim().length > 0 ? value : null;
}

/** APIキーを保存する */
export function saveApiKey(apiKey: string): void {
  getStorage()?.setItem(API_KEY_STORAGE_KEY, apiKey.trim());
}

/** APIキーと会話履歴をまとめて消す（「APIキーを変更する」「デモを終了」で使う） */
export function clearDemoData(): void {
  const storage = getStorage();
  if (!storage) return;

  storage.removeItem(API_KEY_STORAGE_KEY);
  storage.removeItem(MESSAGES_STORAGE_KEY);
}

/** 会話履歴を取得する。壊れた値が入っていた場合は空配列を返す */
export function loadMessages(): ChatMessage[] {
  const storage = getStorage();
  if (!storage) return [];

  const raw = storage.getItem(MESSAGES_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ChatMessage[]) : [];
  } catch {
    // 保存形式を変えた直後などに壊れた値が残ることがある。
    // 画面が開けなくなる方が困るため、空にして続行する
    return [];
  }
}

/** 会話履歴を保存する */
export function saveMessages(messages: ChatMessage[]): void {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(MESSAGES_STORAGE_KEY, JSON.stringify(messages));
  } catch {
    // 保存容量を超えた場合など。履歴が残らないだけで会話は続けられるため無視する
  }
}
