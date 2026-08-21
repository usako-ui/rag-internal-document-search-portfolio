'use client';

import { useState, type FormEvent } from 'react';
import styles from './AuthForm.module.css';
import { PASSWORD_HINT_MESSAGE, validateRegisterInput } from '@/lib/auth/registerRules';
import { AlertCircleIcon, BookOpenIcon, CheckCircleIcon, LoaderIcon } from '@/components/icons';

/**
 * アカウント登録フォーム（要件F-06）
 *
 * 社内メールアドレスでの自己登録を受け付ける。
 * 登録は `POST /api/auth/register`（サーバー側）へ委ねる。
 *
 * 【この画面の検証はセキュリティ境界ではない】
 * ここでの検証は「送信する前に理由を伝える」ためのもの。
 * ブラウザ側は改造すれば飛ばせるため、同じ検証をAPIでも行っている
 * （`src/lib/auth/registerRules.ts` を両方から使い、条件がずれないようにしている）。
 *
 * 【許可ドメインは必ずpropsで受け取る】
 * ALLOWED_EMAIL_DOMAIN は `NEXT_PUBLIC_` 接頭辞が無いため、
 * このコンポーネントから `process.env` を読んでも必ず undefined になる。
 * 以前それに気付かず画面側で環境変数を読んでいたため、
 * **常に「システムの設定が未完了です」となり登録APIへ到達しない**不具合が発生した。
 * 環境変数はサーバーコンポーネント（`app/register/page.tsx`）が読み、propsで渡す。
 *
 * 【登録できてもすぐには使えない】
 * Supabaseの「Confirm email」が有効なため、登録直後にセッションは発行されない。
 * 確認メールのリンクを開いて初めてログインできる。
 * これが「社内メールを受信できる人だけが使える」という担保になっている。
 */

type RegisterFormProps = {
  /**
   * 許可メールドメイン。サーバーコンポーネントが環境変数から読んで渡す。
   * 未設定（null）の場合は設定不備として案内する
   */
  allowedDomain: string | null;
};

export function RegisterForm({ allowedDomain }: RegisterFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    // 送信前に理由を伝える（ドメイン・文字数・確認用の一致）
    const validated = validateRegisterInput({ email, password, passwordConfirm, allowedDomain });

    if (!validated.ok) {
      setErrorMessage(validated.message);
      return;
    }

    setIsSubmitting(true);

    try {
      // 確認用パスワードは送らない（サーバーで使わない値を送る必要がない）
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: validated.email, password: validated.password }),
        cache: 'no-store',
      });

      if (!response.ok) {
        const json = (await response.json().catch(() => null)) as { error?: string } | null;

        setErrorMessage(
          json?.error ??
            '登録できませんでした。時間をおいてもう一度お試しください。解消しない場合は管理者へご連絡ください。'
        );
        setIsSubmitting(false);
        return;
      }

      setIsRegistered(true);
    } catch {
      setErrorMessage(
        'サーバーへ接続できませんでした。ネットワーク接続を確認して、もう一度お試しください。'
      );
      setIsSubmitting(false);
    }
  };

  // ------------------------------------------------------------
  // 登録受付後の表示
  // ------------------------------------------------------------
  if (isRegistered) {
    return (
      <div className={styles.screen}>
        <div className={styles.card}>
          <div className={styles.brand}>
            <span className={styles.brandIcon}>
              <BookOpenIcon size={20} strokeWidth={2.2} />
            </span>
            <span className={styles.brandText}>社内文書検索AI</span>
          </div>

          <div className={styles.successIcon}>
            <CheckCircleIcon size={24} strokeWidth={2.2} />
          </div>

          <h1 className={styles.title}>確認メールを送信しました。</h1>
          <p className={styles.successText}>
            メール内のリンクをクリックしてログインできます。
          </p>
          <p className={styles.successNote}>
            メールが届かない場合は、迷惑メールフォルダをご確認ください。
            それでも見つからない場合は情報システム部へお問い合わせください。
          </p>

          <p className={styles.switch}>
            {/* Next.jsのルーターキャッシュを避けるため <a> で遷移する（コーディング規約） */}
            <a className={styles.link} href="/login">
              ログイン画面へ戻る
            </a>
          </p>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------
  // 登録フォーム
  // ------------------------------------------------------------
  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.brandIcon}>
            <BookOpenIcon size={20} strokeWidth={2.2} />
          </span>
          <span className={styles.brandText}>社内文書検索AI</span>
        </div>

        <h1 className={styles.title}>アカウント登録</h1>
        <p className={styles.sub}>
          社内メールアドレスで登録してください。確認メールをお送りします。
        </p>

        {/*
          method="post" を付ける理由（見た目には影響しない）。

          通常はJavaScriptの onSubmit が送信を止めてAPIを呼ぶ。
          しかしJavaScriptの読み込みに失敗した場合、ブラウザは素のフォーム送信を行う。
          method の既定は GET のため、そのとき**入力したパスワードがURLへ載る**
          （履歴・アクセスログ・Refererに残る）。実際に検証環境で発生した。

          post にしておけば、同じ状況でもパスワードがURLに現れない。
        */}
        <form className={styles.form} method="post" onSubmit={handleSubmit} noValidate>
          <label className={styles.label} htmlFor="register-email">
            メールアドレス
          </label>
          <input
            id="register-email"
            className={styles.input}
            type="email"
            name="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@company.co.jp"
            autoComplete="email"
            autoFocus
            disabled={isSubmitting}
            required
          />

          <label className={styles.label} htmlFor="register-password">
            パスワード
          </label>
          <input
            id="register-password"
            className={styles.input}
            type="password"
            name="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="パスワードを入力"
            autoComplete="new-password"
            disabled={isSubmitting}
            required
          />
          <p className={styles.hint}>{PASSWORD_HINT_MESSAGE}</p>

          <label className={styles.label} htmlFor="register-password-confirm">
            パスワード（確認）
          </label>
          <input
            id="register-password-confirm"
            className={styles.input}
            type="password"
            name="passwordConfirm"
            value={passwordConfirm}
            onChange={(event) => setPasswordConfirm(event.target.value)}
            placeholder="同じパスワードをもう一度入力"
            autoComplete="new-password"
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
            {isSubmitting ? '登録しています...' : '登録する'}
          </button>
        </form>

        <p className={styles.switch}>
          すでにアカウントをお持ちの方は{' '}
          <a className={styles.link} href="/login">
            ログインはこちら
          </a>
        </p>
      </div>
    </div>
  );
}
