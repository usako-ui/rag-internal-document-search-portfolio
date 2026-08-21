import styles from './Message.module.css';
import type { UserMessage as UserMessageType } from '@/types/chat';

/**
 * ユーザーの発言吹き出し
 * ネイビー背景・右揃え・角丸 14px 14px 2px 14px
 */
export function UserMessage({ message }: { message: UserMessageType }) {
  return (
    <div className={styles.userRow}>
      <div className={styles.userWrap}>
        <div className={styles.userBubble}>{message.text}</div>
        <div className={styles.time}>{message.time}</div>
      </div>
    </div>
  );
}
