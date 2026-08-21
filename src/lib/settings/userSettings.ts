import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  SettingAnswerLength,
  SettingHistoryLimit,
  SettingMatchCount,
  UserSettings,
} from '@/types/api';

/**
 * 利用者設定の既定値と検証（改善フェーズ）
 *
 * 設定行が無いユーザーでも画面・検索が成立するよう、
 * 「行が無い＝既定値」として扱う。ログインしただけで空行を作らない方針。
 */

/** 設定が未保存のときに使う既定値。DBのDEFAULTと必ず一致させること */
export const DEFAULT_USER_SETTINGS: UserSettings = {
  history_limit: 20,
  answer_length: 'standard',
  match_count: 5,
};

/** 画面の選択肢（UIのラジオ・セレクトはこの配列から生成する） */
export const HISTORY_LIMIT_OPTIONS: { value: SettingHistoryLimit; label: string }[] = [
  { value: 10, label: '10件' },
  { value: 20, label: '20件' },
  { value: 50, label: '50件' },
];

export const ANSWER_LENGTH_OPTIONS: { value: SettingAnswerLength; label: string; hint: string }[] = [
  { value: 'short', label: '短め', hint: '結論のみ・1〜2文' },
  { value: 'standard', label: '標準', hint: '結論と補足・3文程度' },
  { value: 'detailed', label: '詳しく', hint: '条件・例外も含める・5文程度' },
];

export const MATCH_COUNT_OPTIONS: { value: SettingMatchCount; label: string; hint: string }[] = [
  { value: 3, label: '3件', hint: '絞り込み重視' },
  { value: 5, label: '5件', hint: '推奨' },
  { value: 10, label: '10件', hint: '幅広く探す' },
];

/**
 * 保存できる値かどうかを確認しながら設定を組み立てる。
 *
 * DB側にもCHECK制約があるが、制約違反エラーをそのまま利用者へ見せると
 * 原因が分からないため、アプリ側で先に弾いて具体的なメッセージを返せるようにする。
 *
 * @returns 正常なら設定、不正なら理由（利用者向けメッセージ）
 */
export function parseUserSettings(
  input: unknown
): { ok: true; value: UserSettings } | { ok: false; reason: string } {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, reason: '設定の形式が正しくありません。' };
  }

  const raw = input as Record<string, unknown>;

  const historyLimit = raw.history_limit;
  if (!HISTORY_LIMIT_OPTIONS.some((option) => option.value === historyLimit)) {
    return { ok: false, reason: '履歴表示件数は10件・20件・50件のいずれかを選択してください。' };
  }

  const answerLength = raw.answer_length;
  if (!ANSWER_LENGTH_OPTIONS.some((option) => option.value === answerLength)) {
    return { ok: false, reason: '回答の最大文字数は短め・標準・詳しくのいずれかを選択してください。' };
  }

  const matchCount = raw.match_count;
  if (!MATCH_COUNT_OPTIONS.some((option) => option.value === matchCount)) {
    return { ok: false, reason: '検索件数は3件・5件・10件のいずれかを選択してください。' };
  }

  return {
    ok: true,
    value: {
      history_limit: historyLimit as SettingHistoryLimit,
      answer_length: answerLength as SettingAnswerLength,
      match_count: matchCount as SettingMatchCount,
    },
  };
}

/**
 * ログイン中ユーザーの設定を取得する。設定行が無い場合は既定値を返す。
 *
 * 検索・回答生成から呼ばれるため、**設定の取得に失敗しても処理を止めない**。
 * 設定が読めないことを理由に質問へ答えられなくなる方が損失が大きいので、
 * 失敗時は既定値へ倒してログにのみ残す。
 *
 * @param supabase 認証済みユーザーのクライアント（RLSが適用される）
 * @param userId ログイン中ユーザーのID
 */
export async function loadUserSettings(
  supabase: SupabaseClient,
  userId: string
): Promise<UserSettings> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('history_limit, answer_length, match_count')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('[user_settings] 設定の取得に失敗（既定値で継続）:', error);
    return DEFAULT_USER_SETTINGS;
  }

  if (!data) return DEFAULT_USER_SETTINGS;

  // DBのCHECK制約で値は保証されているが、
  // 制約変更やデータ移行のズレで想定外の値が入っても画面が壊れないよう既定値で補う
  const parsed = parseUserSettings(data);
  return parsed.ok ? parsed.value : DEFAULT_USER_SETTINGS;
}
