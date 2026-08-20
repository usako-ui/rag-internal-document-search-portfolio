/**
 * 社内メールドメイン制限（要件F-06 / CLAUDE.md セクション7）
 *
 * 指定ドメイン以外のメールアドレスでのログイン・API利用を拒否する。
 * クライアントの最重要要件「社外への情報漏洩を絶対に避ける」に直結するため、
 * 判定ロジックはこのファイル1か所へ集約し、呼び出し側で条件を書き分けない。
 *
 * 【設計上の最重要事項：どこで弾くかで安全性が変わる】
 * ログイン画面やAPI Routeでの「ログイン前チェック」は利用者への案内であり、
 * それ単体はセキュリティ境界にならない。
 * anonキーは NEXT_PUBLIC_ で公開されるため、Supabaseの認証エンドポイントを
 * 直接叩けばこのアプリを経由せずセッションを取得できてしまうからである。
 *
 * そのため実効的な防御線は **Middleware（サーバー側のセッション検査）** に置く。
 * Middlewareは「Supabaseが検証済みのメールアドレス」を見て毎リクエスト判定するので、
 * どの経路でセッションを取得しても社内文書へは到達できない。
 */

/** ドメイン不一致時に利用者へ返すメッセージ（原因と次の行動を示す） */
export const DOMAIN_RESTRICTION_MESSAGE =
  'このメールアドレスではログインできません。社内メールアドレスでログインしてください。';

/**
 * ALLOWED_EMAIL_DOMAIN が未設定のときのメッセージ（設定漏れは利用者では解決できない）。
 *
 * 【この文言はログイン画面専用】
 * 「ログインできません」と書かれているため、登録画面で使ってはいけない。
 * 登録画面は `registerRules.ts` の `REGISTER_NOT_CONFIGURED_MESSAGE` を使う。
 */
export const DOMAIN_NOT_CONFIGURED_MESSAGE =
  'ログイン設定が未完了のためログインできません。管理者へご連絡ください。';

/** 環境変数名（綴り間違いを防ぐため定数化する） */
export const ALLOWED_EMAIL_DOMAIN_ENV = 'ALLOWED_EMAIL_DOMAIN';

/**
 * 許可ドメインを環境変数から取得する。
 *
 * 【重要】未設定なら null を返し、呼び出し側は**ログインを拒否する**（fail-closed）。
 * 「未設定なら制限しない」にすると、Vercelへの環境変数設定を忘れただけで
 * 社外アドレスが素通りし、しかも誰も気付けない。
 * 全員がログインできない方が異常に気付けるため、閉じる側へ倒す。
 *
 * 値は `techbridge.co.jp` 形式で設定する（`@` 付き・大文字でも動くよう正規化する）。
 */
export function getAllowedEmailDomain(): string | null {
  const raw = process.env[ALLOWED_EMAIL_DOMAIN_ENV];
  if (!raw) return null;

  const normalized = raw.trim().toLowerCase().replace(/^@/, '');

  return normalized.length > 0 ? normalized : null;
}

/**
 * メールアドレスからドメイン部分（`@` より後ろ）を取り出す。
 *
 * 取り出せない形式（`@` が無い・前後が空）は null を返し、呼び出し側で拒否させる。
 */
function extractDomain(email: string | null | undefined): string | null {
  if (!email) return null;

  const normalized = email.trim().toLowerCase();
  const separatorIndex = normalized.lastIndexOf('@');

  // `@` が無い / 先頭が `@`（ローカル部が空） / 末尾が `@`（ドメインが空）はすべて不正
  if (separatorIndex <= 0 || separatorIndex === normalized.length - 1) return null;

  return normalized.slice(separatorIndex + 1);
}

/**
 * メールアドレスが許可ドメインかどうかを判定する。
 *
 * 【判定は完全一致】`endsWith` で判定してはいけない。
 * `endsWith('techbridge.co.jp')` だと、攻撃者が取得した
 * `eviltechbridge.co.jp` や `techbridge.co.jp.example.com` を通してしまう。
 * サブドメイン（`mail.techbridge.co.jp`）も別ドメイン扱いで拒否する
 * （必要になった時点で要確認事項として扱い、ここを明示的に拡張すること）。
 *
 * @param email 判定対象のメールアドレス
 * @param allowedDomain 許可ドメイン。省略時は環境変数から読む
 */
export function isAllowedEmailDomain(
  email: string | null | undefined,
  allowedDomain: string | null = getAllowedEmailDomain()
): boolean {
  // 許可ドメインが未設定なら判定不能。素通しせず拒否する（fail-closed）
  if (!allowedDomain) return false;

  const domain = extractDomain(email);
  if (!domain) return false;

  return domain === allowedDomain;
}

/** ドメイン検証の結果 */
export type EmailDomainCheckResult =
  | { allowed: true }
  | { allowed: false; reason: 'not-configured' | 'domain-mismatch'; message: string };

/**
 * メールアドレスを検証し、拒否理由と利用者向けメッセージまで返す。
 *
 * 「設定漏れ（管理者が対応すべき）」と「ドメイン不一致（利用者が対応すべき）」を
 * 区別して案内するために使う。単純な真偽値でよい場面では isAllowedEmailDomain を使う。
 */
export function checkEmailDomain(email: string | null | undefined): EmailDomainCheckResult {
  const allowedDomain = getAllowedEmailDomain();

  if (!allowedDomain) {
    // 設定漏れをサーバーログへ残す。メールアドレス本体はログに出さない
    console.error(
      `[auth] 環境変数 ${ALLOWED_EMAIL_DOMAIN_ENV} が未設定のため、すべてのログインを拒否しました。.env.local / Vercelの環境変数を確認してください。`
    );
    return { allowed: false, reason: 'not-configured', message: DOMAIN_NOT_CONFIGURED_MESSAGE };
  }

  if (!isAllowedEmailDomain(email, allowedDomain)) {
    return { allowed: false, reason: 'domain-mismatch', message: DOMAIN_RESTRICTION_MESSAGE };
  }

  return { allowed: true };
}
