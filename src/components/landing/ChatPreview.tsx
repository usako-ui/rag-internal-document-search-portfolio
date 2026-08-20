'use client';

import { useEffect, useState } from 'react';
import styles from './Landing.module.css';
import { BookOpenIcon, FileIcon, SendIcon } from '@/components/icons';
import { PREVIEW_CONVERSATIONS } from '@/lib/demo/previewConversations';

/**
 * ランディングのチャットプレビュー（自動再生）
 *
 * 実際のチャット画面の動きを、ログインもAPIキーも無しで見せるための演出。
 *
 * 【表示内容について】
 * 質問・回答・出典は、デモ（`/demo/chat`）が実際に返す内容と揃えている。
 * ここだけ見栄えのする文言にすると、訪問者がデモで同じ質問をしたときに
 * 食い違いが露見して信頼を損なうため、収録文書の記載と一致させること。
 * 参照元：`src/lib/demo/documents.ts`
 */

/** 1パターンあたりの再生時間（ミリ秒） */
const CYCLE_MS = 6000;
/** 質問を出すまで */
const USER_DELAY_MS = 300;
/** タイピング表示を出すまで */
const TYPING_DELAY_MS = 900;
/** 回答を出すまで */
const ANSWER_DELAY_MS = 2400;

/** 再生の進行段階 */
type Phase = 'idle' | 'user' | 'typing' | 'answer';

export function ChatPreview() {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');

  useEffect(() => {
    // 1サイクル分のタイマーをまとめて仕掛け、最後に次のパターンへ進む
    const timers = [
      setTimeout(() => setPhase('user'), USER_DELAY_MS),
      setTimeout(() => setPhase('typing'), TYPING_DELAY_MS),
      setTimeout(() => setPhase('answer'), ANSWER_DELAY_MS),
      setTimeout(() => {
        setPhase('idle');
        setIndex((current) => (current + 1) % PREVIEW_CONVERSATIONS.length);
      }, CYCLE_MS),
    ];

    // パターンが切り替わるたびに前回のタイマーを必ず片付ける
    // （残っていると表示が二重に進んでちらつく）
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [index]);

  const conversation = PREVIEW_CONVERSATIONS[index];

  return (
    <div className={styles.chatPreview}>
      <div className={styles.chatHeader}>
        <span className={styles.chatHeaderDot} />
        <span className={styles.chatHeaderTitle}>CHAT</span>
        <span className={styles.chatHeaderBadge}>LIVE DEMO</span>
      </div>

      {/*
        自動で内容が入れ替わる領域。
        読み上げの邪魔になるため支援技術からは隠す（同じ内容は下のテキストで伝わる）
      */}
      <div className={styles.chatMessages} aria-hidden="true">
        {phase !== 'idle' && (
          // key を付けて、パターンが変わるたびにフェードインをやり直す
          <div className={styles.msgUser} key={`user-${index}`}>
            <div className={styles.msgUserBubble}>{conversation.user}</div>
          </div>
        )}

        {phase === 'typing' && (
          <div className={styles.msgAi} key={`typing-${index}`}>
            <div className={styles.msgAiAvatar}>
              <BookOpenIcon size={13} strokeWidth={2.2} />
            </div>
            <div className={styles.msgAiBody}>
              <div className={styles.msgAiBubble}>
                <div className={styles.typingIndicator}>
                  <span className={styles.typingDot} />
                  <span className={styles.typingDot} />
                  <span className={styles.typingDot} />
                </div>
              </div>
            </div>
          </div>
        )}

        {phase === 'answer' && (
          <div className={styles.msgAi} key={`answer-${index}`}>
            <div className={styles.msgAiAvatar}>
              <BookOpenIcon size={13} strokeWidth={2.2} />
            </div>
            <div className={styles.msgAiBody}>
              <div className={styles.msgAiBubble}>
                {conversation.ai}
                <span className={styles.typingCursor} />
              </div>

              <div className={styles.msgCitations}>
                {conversation.citations.map((citation) => (
                  <span className={styles.citationChip} key={citation}>
                    <FileIcon size={11} />
                    {citation}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className={styles.chatInputRow}>
        <div className={styles.chatInputFake}>社内文書について質問してください...</div>
        <div className={styles.chatSendBtn}>
          <SendIcon size={13} strokeWidth={2.2} />
        </div>
      </div>
    </div>
  );
}
