/**
 * アカウント登録の入力ルール（TS-07 / 要件F-06）
 *
 * 登録画面（クライアント）と登録API（サーバー）の両方から使う。
 * 判定を1か所へ集約することで、画面とAPIで条件がずれるのを防ぐ。
 *
 * 【重要】画面側の検証は「利用者へその場で理由を伝える」ためのもので、
 * セキュリティ境界ではない。ブラウザの検証は改造すれば飛ばせるため、
 * **APIでも必ず同じ関数で検証する**こと。
 *
 * ドメイン判定そのものは `emailDomain.ts` を使う（ここでは実装しない）。
 * 登録時だけ文言が異なるため、メッセージの差し替えのみここで行う。
 */

import { getAllowedEmailDomain, isAllowedEmailDomain } from './emailDomain';

/**
 * パスワードの最低文字数。
 *
 * 12文字としているのは、社内の情報セキュリティ規程が
 * 「パスワードは12文字以上」と定めているため（デモ文書・ランディングの記載と一致させる）。
 */
export const MIN_PASSWORD_LENGTH = 12;

/** 登録時にドメインが一致しない場合のメッセージ（ログイン時とは文言が異なる） */
export const REGISTER_DOMAIN_MESSAGE = '社内メールアドレスで登録してください。';

/**
 * ALLOWED_EMAIL_DOMAIN が未設定のときに登録画面へ返すメッセージ。
 *
 * ログイン画面用の文言（`DOMAIN_NOT_CONFIGURED_MESSAGE`）は
 * 「ログインできません」と書かれており、登録画面で出すと
 * 「登録処理がログイン可否を判定している」と誤解させる。
 * 実際に原因調査を誤らせたため、画面ごとに文言を分ける。
 *
 * どちらも伝えるべきことは同じ：**利用者の入力ミスではなく、サーバーの設定不備**である。
 */
export const REGISTER_NOT_CONFIGURED_MESSAGE =
  'システムの設定が未完了です。管理者へご連絡ください。';

/** パスワードが短い場合のメッセージ */
export const PASSWORD_TOO_SHORT_MESSAGE = `パスワードは${MIN_PASSWORD_LENGTH}文字以上で設定してください。`;

/** パスワードと確認用が一致しない場合のメッセージ */
export const PASSWORD_MISMATCH_MESSAGE =
  'パスワードが一致しません。確認用のパスワードを入力し直してください。';

/** メール・パスワード未入力のメッセージ */
export const MISSING_INPUT_MESSAGE = 'メールアドレスとパスワードを入力してください。';

/**
 * パスワード入力欄の補足文言。
 *
 * 文字数を式で埋め込まず1つの文字列にしているのは、
 * サーバー描画時にテキストが分割されず、検証スクリプトからも素直に確認できるため。
 */
export const PASSWORD_HINT_MESSAGE = `${MIN_PASSWORD_LENGTH}文字以上で設定してください。`;

/**
 * 検証に失敗した理由。
 *
 * APIが返すHTTPステータスを決めるために使う。
 * 「社外ドメイン（403）」と「入力ミス（400）」を呼び出し側で区別できるようにするのが目的で、
 * メッセージ本文から理由を推測させない（推測は取り違えのもとになる）。
 */
export type RegisterValidationReason =
  | 'missing-input'
  | 'domain-mismatch'
  | 'not-configured'
  | 'password-too-short'
  | 'password-mismatch';

/** 検証結果。ok の場合は使ってよい値を返す */
export type RegisterValidationResult =
  | { ok: true; email: string; password: string }
  | { ok: false; reason: RegisterValidationReason; message: string };

/** 検証対象の入力値 */
export type RegisterInput = {
  email: string;
  password: string;
  /** 確認用パスワード。APIでは省略できる（画面側で一致を確認済みのため） */
  passwordConfirm?: string;
  /**
   * 許可ドメイン。**ブラウザから呼ぶ場合は必ず渡すこと。**
   *
   * ALLOWED_EMAIL_DOMAIN は `NEXT_PUBLIC_` 接頭辞が無いため、
   * ブラウザでは `process.env` から読めず必ず undefined になる。
   * それに気付かず画面側で環境変数を読むと、
   * **常に「設定が未完了」となり登録APIへ到達しない**（実際にこの不具合が発生した）。
   *
   * そのためサーバーコンポーネント（`app/register/page.tsx`）が
   * 環境変数を読み、この引数で画面へ渡す。
   * 省略した場合（サーバー側から呼ぶ場合）は環境変数から読む。
   */
  allowedDomain?: string | null;
};

/**
 * 登録入力を検証する。
 *
 * 検証の順序には意味がある。
 *  1. 未入力      … 何も入っていない状態で他の理由を出しても分かりにくい
 *  2. ドメイン    … 社外の相手にパスワード規則を教える必要がない
 *  3. 文字数      … 入力し直す前に規則を伝える
 *  4. 確認用一致  … 上記を満たしてから最後に確認する
 */
export function validateRegisterInput(input: RegisterInput): RegisterValidationResult {
  const email = input.email.trim();
  const { password } = input;

  if (email === '' || password === '') {
    return { ok: false, reason: 'missing-input', message: MISSING_INPUT_MESSAGE };
  }

  // 許可ドメインは、渡されていればその値を使い、無ければ環境変数から読む。
  // ブラウザからは環境変数を読めないため、呼び出し側が渡す前提（上記コメント参照）
  const allowedDomain =
    input.allowedDomain !== undefined ? input.allowedDomain : getAllowedEmailDomain();

  // 設定不備は利用者では解決できないため、管理者向けの案内を返す
  if (!allowedDomain) {
    return { ok: false, reason: 'not-configured', message: REGISTER_NOT_CONFIGURED_MESSAGE };
  }

  // 判定そのものは emailDomain.ts に委ねる（完全一致・大文字小文字非依存）
  if (!isAllowedEmailDomain(email, allowedDomain)) {
    return { ok: false, reason: 'domain-mismatch', message: REGISTER_DOMAIN_MESSAGE };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: 'password-too-short', message: PASSWORD_TOO_SHORT_MESSAGE };
  }

  // 確認用は画面側のみで使う。APIへは送らないため、渡された場合だけ検証する
  if (input.passwordConfirm !== undefined && input.passwordConfirm !== password) {
    return { ok: false, reason: 'password-mismatch', message: PASSWORD_MISMATCH_MESSAGE };
  }

  return { ok: true, email, password };
}
