/**
 * 検証スクリプト用：許可メールドメインの取得（要件F-06）
 *
 * 各verifyスクリプトはRLS検証のために一時ユーザーを作って実際にログインする。
 * ALLOWED_EMAIL_DOMAIN 以外のアドレスで作るとMiddlewareが403で弾くため、
 * 「RLSが効いた」のか「ドメイン制限で弾かれた」のか区別できなくなる。
 * そのため一時ユーザーも必ず許可ドメインで組み立てる。
 */

import { getAllowedEmailDomain, ALLOWED_EMAIL_DOMAIN_ENV } from '../src/lib/auth/emailDomain';

/** 許可ドメインを取得する。未設定なら理由を明示して止める */
export function requireAllowedDomain(): string {
  const domain = getAllowedEmailDomain();

  if (!domain) {
    throw new Error(
      `環境変数 ${ALLOWED_EMAIL_DOMAIN_ENV} が設定されていません。` +
        '.env.local に社内メールドメイン（例：techbridge.co.jp）を設定してください。'
    );
  }

  return domain;
}
