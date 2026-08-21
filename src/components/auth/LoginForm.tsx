'use client';

import { useEffect, useState, type FormEvent } from 'react';
import styles from './AuthForm.module.css';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { toLoginErrorMessage } from '@/lib/auth/loginErrors';
import { AlertCircleIcon, BookOpenIcon, LoaderIcon } from '@/components/icons';

/**
 * ログインフォーム（要件F-06）
 *
 * ログインは `POST /api/auth/login`（サーバー側）へ委ねる。
 * ブラウザから直接 signInWithPassword を呼ばない理由は2つ。
 *  1. 社内メールドメインの判定と許可ドメイン値をブラウザへ配らずに済む
 *  2. セッションCookieの発行をサーバー側へ一本化できる
 *
 * 【社内メールドメイン制限について】
 * 実効的な防御線は Middleware（`src/middleware.ts`）にある。
 * この画面での案内は「利用者に理由を伝える」ためのものであり、
 * ここを改造してもドメイン外のアドレスで社内文書へは到達できない。
 */

type LoginFormProps = {
  /** ログイン後の遷移先。呼び出し側で検証済みの安全なパスを渡すこと */
  redirectTo: string;
  /**
   * 画面表示時に出しておくエラーメッセージ。
   * ドメイン制限でMiddlewareに弾かれて戻ってきた場合に理由を表示する
   */
  initialErrorMessage?: string | null;
  /**
   * 残っているセッションを破棄するかどうか。
   * ドメイン外のセッションでMiddlewareに弾かれた場合に true になる
   */
  shouldClearSession?: boolean;
};

export function LoginForm({
  redirectTo,
  initialErrorMessage = null,
  shouldClearSession = false,
}: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(initialErrorMessage);
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * ドメイン外のセッションが残ったままだと、画面を開くたびにMiddlewareで
   * 弾かれ続けて操作できなくなる。理由を表示したうえでセッションを破棄する。
   */
  useEffect(() => {
    if (!shouldClearSession) return;

    createSupabaseBrowserClient()
      .auth.signOut()
      .catch(() => {
        // 破棄に失敗しても、正しいアドレスでログインし直せばセッションは置き換わる。
        // 利用者の操作を止める理由にはならないため、ここでは何もしない
      });
  }, [shouldClearSession]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    const trimmedEmail = email.trim();

    if (trimmedEmail === '' || password === '') {
      setErrorMessage('メールアドレスとパスワードを入力してください。');
      return;
    }

    setIsSubmitting(true);

    try {
      // ドメイン検証・認証・Cookie発行はすべてサーバー側で行う
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail, password }),
        cache: 'no-store',
      });

      if (!response.ok) {
        const json = (await response.json().catch(() => null)) as { error?: string } | null;

        // サーバーが利用者向け文言を返すため、そのまま表示する
        setErrorMessage(json?.error ?? toLoginErrorMessage('unknown'));
        setIsSubmitting(false);
        return;
      }

      // Next.jsのルーターキャッシュを避けるため、通常遷移でページを読み直す
      // （コーディング規約：ページ遷移は window.location.href を使う）。
      // サーバー側が新しいセッションCookieを読んだ状態で画面を描画できる。
      window.location.href = redirectTo;
    } catch (error) {
      setErrorMessage(
        toLoginErrorMessage(error instanceof Error ? error.message : 'unknown')
      );
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.brandIcon}>
            <BookOpenIcon size={20} strokeWidth={2.2} />
          </span>
          <span className={styles.brandText}>社内文書検索AI</span>
        </div>

        <h1 className={styles.title}>ログイン</h1>
        <p className={styles.sub}>
          社内アカウントでログインしてください。ログインした方のみ社内文書を検索できます。
        </p>

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <label className={styles.label} htmlFor="login-email">
            メールアドレス
          </label>
          <input
            id="login-email"
            className={styles.input}
            type="email"
            name="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@techbridge.co.jp"
            autoComplete="email"
            autoFocus
            disabled={isSubmitting}
            required
          />

          <label className={styles.label} htmlFor="login-password">
            パスワード
          </label>
          <input
            id="login-password"
            className={styles.input}
            type="password"
            name="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="パスワードを入力"
            autoComplete="current-password"
            disabled={isSubmitting}
            required
          />

          {errorMessage && (
            <div className={styles.error} role="alert">
              <span className={styles.errorIcon}>
                <AlertCircleIcon size={14} strokeWidth={2.2} />
              </span>
              <span>{errorMessage}</span>
            </div>
          )}

          <button type="submit" className={styles.submitButton} disabled={isSubmitting}>
            {isSubmitting && (
              <span className={styles.spinner}>
                <LoaderIcon size={14} strokeWidth={2.2} />
              </span>
            )}
            {isSubmitting ? 'ログインしています...' : 'ログイン'}
          </button>
        </form>

        <p className={styles.note}>
          パスワードが分からない場合は、情報システム部へお問い合わせください。
        </p>

        <p className={styles.switch}>
          アカウントをお持ちでない方は登録してください
          {/* 案内文とリンクを1行に詰めると語の途中で折り返すため、行を分ける */}
          <br />
          {/* Next.jsのルーターキャッシュを避けるため <a> で遷移する（コーディング規約） */}
          <a className={styles.link} href="/register">
            アカウント登録はこちら
          </a>
        </p>
      </div>
    </div>
  );
}
