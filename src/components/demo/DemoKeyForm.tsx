'use client';

import { useState, type FormEvent } from 'react';
import styles from './DemoKeyForm.module.css';
import { saveApiKey } from '@/lib/demo/storage';
import { ChevronRightIcon, MessageSquareIcon } from '@/components/icons';

/**
 * デモ用APIキー入力フォーム（BYOKデモ STEP B）
 *
 * 入力されたキーはブラウザ内（sessionStorage）にのみ保存し、
 * こちらのサーバーへは一切送信しない。
 *
 * 【入力値の扱い】
 * キーはログ出力しない。入力欄は type="password" にして肩越しの覗き見を防ぐ。
 */

/** デモチャットのパス */
const DEMO_CHAT_PATH = '/demo/chat';

/** Gemini APIキーの取得ページ */
const API_KEY_DOCS_URL = 'https://aistudio.google.com/app/apikey';

/**
 * 明らかに形式が違う入力をその場で弾く。
 *
 * Gemini APIキーは `AIza` で始まる39文字程度の文字列。
 * サーバーへ問い合わせる前に気づける誤りは手前で伝えた方が待ち時間が短い。
 * ただし将来キーの形式が変わる可能性があるため、長さの下限だけを厳しくし、
 * 接頭辞は「違うかもしれない」程度の警告に留める。
 */
function validateApiKey(value: string): string | null {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return 'APIキーを入力してください。';
  }

  if (trimmed.length < 20) {
    return 'APIキーが短すぎるようです。Google AI Studio でコピーした値をそのまま貼り付けてください。';
  }

  if (/\s/.test(trimmed)) {
    return 'APIキーに空白が含まれています。前後の余分な文字を取り除いてください。';
  }

  return null;
}

export function DemoKeyForm() {
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    const validationError = validateApiKey(apiKey);
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    saveApiKey(apiKey);

    // ページ遷移は window.location.href を使う（コーディング規約）
    window.location.href = DEMO_CHAT_PATH;
  };

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <span className={styles.badge}>
          <MessageSquareIcon size={12} strokeWidth={2.2} />
          デモモード
        </span>

        <h1 className={styles.title}>Gemini APIキーを入力してください</h1>

        <p className={styles.lead}>
          あなたのGemini APIキーを入力してください。
          キーはブラウザ内にのみ保存され、サーバーには送信されません。
        </p>

        <div className={styles.notice}>
          キーの取り扱い
          <ul className={styles.noticeList}>
            <li>ブラウザのタブを閉じると、キーと会話履歴は自動的に消えます</li>
            <li>質問はあなたのブラウザからGoogleへ直接送信されます</li>
            <li>デモで使う社内文書はサンプルであり、実在の規程ではありません</li>
          </ul>
        </div>

        <a className={styles.link} href={API_KEY_DOCS_URL} target="_blank" rel="noopener noreferrer">
          Google AI Studio でAPIキーを取得する
          <ChevronRightIcon size={13} />
        </a>

        <form onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="demo-api-key">
              APIキー
            </label>
            <input
              id="demo-api-key"
              // 肩越しの覗き見を防ぐため伏せ字にする
              type="password"
              className={`${styles.input} ${error ? styles.inputError : ''}`}
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                setError(null);
              }}
              placeholder="AIza..."
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'demo-api-key-error' : undefined}
            />

            {error && (
              <p className={styles.error} id="demo-api-key-error" role="alert">
                {error}
              </p>
            )}
          </div>

          <button type="submit" className={styles.submitButton} disabled={isSubmitting}>
            デモを開始する
            <ChevronRightIcon size={16} strokeWidth={2.2} />
          </button>
        </form>

        <a className={styles.backLink} href="/">
          トップへ戻る
        </a>
      </div>
    </main>
  );
}
