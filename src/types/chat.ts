import type { ChatResponse } from '@/types/api';

/**
 * チャット画面の内部状態を表す型。
 * APIの型（api.ts）とは分けて管理する。
 * 画面表示の都合（送信時刻・ローディング）はAPIの契約ではないため。
 */

/** ユーザーの発言 */
export type UserMessage = {
  role: 'user';
  id: string;
  text: string;
  /** 表示用の時刻文字列（例：10:30） */
  time: string;
};

/** AIの回答。中身は POST /api/chat のレスポンスをそのまま保持する */
export type AssistantMessage = {
  role: 'assistant';
  id: string;
  time: string;
  response: ChatResponse;
};

/** 回答取得に失敗したときのメッセージ */
export type ErrorMessage = {
  role: 'error';
  id: string;
  time: string;
  /** 原因と次の行動が分かる文言を入れること（「失敗しました」だけにしない） */
  text: string;
  /** 失敗した質問。再送信ボタンで同じ質問をやり直せるようにするため保持する */
  question: string;
};

export type ChatMessage = UserMessage | AssistantMessage | ErrorMessage;
