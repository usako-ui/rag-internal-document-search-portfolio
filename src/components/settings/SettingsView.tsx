'use client';

import { useEffect, useState } from 'react';
import styles from './SettingsView.module.css';
import { SettingsApiError, fetchSettings, saveSettings } from '@/lib/api/settings';
import {
  ANSWER_LENGTH_OPTIONS,
  DEFAULT_USER_SETTINGS,
  HISTORY_LIMIT_OPTIONS,
  MATCH_COUNT_OPTIONS,
} from '@/lib/settings/userSettings';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { LOGIN_PATH } from '@/lib/auth/redirect';
import type { UserSettings } from '@/types/api';
import { CheckCircleIcon, LoaderIcon, LogOutIcon } from '@/components/icons';

/**
 * 設定画面（TE-10）
 *
 * 設定項目（2026-08-18 確定）：
 *  1. 履歴表示件数（10件・20件・50件）
 *  2. 回答の最大文字数（短め・標準・詳しく）
 *  3. 検索件数 match_count（3件・5件・10件）
 *  4. メールアドレス表示（読み取り専用）
 *  5. ログアウトボタン
 *
 * 【類似度閾値を含めない理由（Q-38）】
 * 閾値はハルシネーション抑制の要であり、利用者が緩められてはならないため
 * 0.62固定とし、設定項目から除外している。
 *
 * 【表示言語を含めない理由（Q-40）】
 * UIの英語化（i18n）が未実装で、選んでも表示が変わらず誤案内になるため削除した。
 * 日本語のみ対応。英語対応を行う場合は、全画面の文言・日時書式を含む独立タスクとする。
 */

type SettingsViewProps = {
  /** ログイン中ユーザーのメールアドレス（サーバー側でセッションから取得した値） */
  userEmail: string;
};

/** 選択肢1件分のボタン */
function OptionButton<T extends string | number>({
  label,
  hint,
  isActive,
  disabled,
  onClick,
}: {
  label: string;
  hint?: string;
  isActive: boolean;
  disabled: boolean;
  onClick: () => void;
  /** ジェネリクスを使うことで、呼び出し側で値の型が崩れないようにする */
  value?: T;
}) {
  return (
    <button
      type="button"
      className={`${styles.option} ${isActive ? styles.optionActive : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={isActive}
    >
      {label}
      {hint && <span className={styles.optionHint}>{hint}</span>}
    </button>
  );
}

export function SettingsView({ userEmail }: SettingsViewProps) {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_USER_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);

  // 保存済みの設定を読み込む
  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      try {
        const loaded = await fetchSettings();
        if (isMounted) setSettings(loaded);
      } catch (error) {
        if (isMounted) {
          setLoadError(
            error instanceof SettingsApiError
              ? error.userMessage
              : '設定を読み込めませんでした。時間をおいてもう一度お試しください。'
          );
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    void load();

    return () => {
      isMounted = false;
    };
  }, []);

  /** 設定を1項目変更する。変更したら保存済み表示は消す（未保存であることを明示） */
  const update = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    setSettings((previous) => ({ ...previous, [key]: value }));
    setIsSaved(false);
    setSaveError(null);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    setIsSaved(false);

    try {
      const saved = await saveSettings(settings);
      setSettings(saved);
      setIsSaved(true);
    } catch (error) {
      setSaveError(
        error instanceof SettingsApiError
          ? error.userMessage
          : '設定を保存できませんでした。時間をおいてもう一度お試しください。'
      );
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * ログアウト（サイドバーのログアウトと同じ動き）
   *
   * 遷移に `window.location.href` を使うのは、Next.jsのルーターキャッシュに
   * ログイン中の画面が残らないようにするため（CLAUDE.md セクション8）。
   */
  const handleLogout = async () => {
    setIsLoggingOut(true);

    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
    } catch (error) {
      // 通信に失敗してもログイン画面へは送る（ログアウト操作を空振りさせない）
      console.error('[ログアウト] セッションの破棄に失敗:', error);
    }

    window.location.href = LOGIN_PATH;
  };

  if (isLoading) {
    return (
      <div className={styles.wrap}>
        <div className={styles.state}>
          <LoaderIcon size={16} />
          <div>設定を読み込み中です…</div>
        </div>
      </div>
    );
  }

  const isBusy = isSaving || isLoggingOut;

  return (
    <div className={styles.wrap}>
      <div className={styles.inner}>
        {loadError && (
          <div className={`${styles.state} ${styles.stateError}`}>
            {loadError}
            <br />
            以下は初期値を表示しています。保存すると初期値で上書きされます。
          </div>
        )}

        {/* 1. 履歴表示件数 */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>履歴表示件数</div>
          <div className={styles.cardHint}>
            質問履歴画面で一度に表示する件数です。多くすると読み込みに時間がかかります。
          </div>
          <div className={styles.options}>
            {HISTORY_LIMIT_OPTIONS.map((option) => (
              <OptionButton
                key={option.value}
                label={option.label}
                isActive={settings.history_limit === option.value}
                disabled={isBusy}
                onClick={() => update('history_limit', option.value)}
              />
            ))}
          </div>
        </div>

        {/* 2. 回答の最大文字数 */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>回答の最大文字数</div>
          <div className={styles.cardHint}>
            AIの回答の長さの目安です。「詳しく」にすると条件・例外も含めて回答します。
          </div>
          <div className={styles.options}>
            {ANSWER_LENGTH_OPTIONS.map((option) => (
              <OptionButton
                key={option.value}
                label={option.label}
                hint={option.hint}
                isActive={settings.answer_length === option.value}
                disabled={isBusy}
                onClick={() => update('answer_length', option.value)}
              />
            ))}
          </div>
        </div>

        {/* 3. 検索件数（match_count） */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>検索件数</div>
          <div className={styles.cardHint}>
            回答の根拠として読み込む文書の数です。多くすると幅広く探せますが、
            関係のない箇所が混ざって回答がぼやけることがあります。
          </div>
          <div className={styles.options}>
            {MATCH_COUNT_OPTIONS.map((option) => (
              <OptionButton
                key={option.value}
                label={option.label}
                hint={option.hint}
                isActive={settings.match_count === option.value}
                disabled={isBusy}
                onClick={() => update('match_count', option.value)}
              />
            ))}
          </div>
        </div>

        {/* 4. メールアドレス（読み取り専用） */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>ログイン中のアカウント</div>
          <div className={styles.cardHint}>
            メールアドレスの変更は情報システム部へご連絡ください。
          </div>
          <div className={styles.readonlyRow}>
            <span className={styles.readonlyValue}>{userEmail}</span>
            <span className={styles.readonlyBadge}>変更不可</span>
          </div>
        </div>

        {/* 保存 */}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.saveButton}
            onClick={() => void handleSave()}
            disabled={isBusy}
          >
            {isSaving ? <LoaderIcon size={14} /> : null}
            {isSaving ? '保存中…' : '設定を保存'}
          </button>

          {isSaved && (
            <span className={`${styles.status} ${styles.statusSuccess}`} role="status">
              <CheckCircleIcon size={14} />
              保存しました
            </span>
          )}

          {saveError && (
            <span className={`${styles.status} ${styles.statusError}`} role="alert">
              {saveError}
            </span>
          )}
        </div>

        {/* 5. ログアウト */}
        <div className={styles.logoutCard}>
          <div>
            <div className={styles.cardTitle}>ログアウト</div>
            <div className={styles.cardHint}>
              この端末からログアウトします。再度利用するにはログインが必要です。
            </div>
          </div>

          <button
            type="button"
            className={styles.logoutButton}
            onClick={() => void handleLogout()}
            disabled={isBusy}
          >
            <LogOutIcon size={14} />
            {isLoggingOut ? 'ログアウト中…' : 'ログアウト'}
          </button>
        </div>
      </div>
    </div>
  );
}
