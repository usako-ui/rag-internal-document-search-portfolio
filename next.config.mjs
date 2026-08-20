/**
 * 起動時の設定チェック（TS-06・TS-07）
 *
 * Next.js は `.env.local` を読み込んだあとにこのファイルを評価するため、
 * ここでサーバー起動時の環境変数を確認できる。
 *
 * 【なぜ起動時に見るか】
 * ALLOWED_EMAIL_DOMAIN が未設定だと、全ユーザーのログイン・登録が拒否される（fail-closed）。
 * これをリクエスト時にしか検出できないと、利用者側には
 * 「設定が未完了です」としか出ず、原因が環境変数だと分かるまで時間がかかる。
 * 実際に調査へ時間を要したため、起動時点で気付けるようにする。
 *
 * 【絵文字を使わない理由】
 * CLAUDE.md セクション8でコード・UIへの絵文字使用を禁止しているため、
 * 記号ではなく `[警告]` という接頭辞で目立たせる。
 */
function checkAuthConfig() {
  // 環境変数名は src/lib/auth/emailDomain.ts の ALLOWED_EMAIL_DOMAIN_ENV と同じ値。
  // next.config.mjs からTypeScriptを読めないため、ここだけ文字列で持つ
  const value = process.env.ALLOWED_EMAIL_DOMAIN;

  if (value && value.trim().length > 0) return;

  console.warn('');
  console.warn('[警告] ALLOWED_EMAIL_DOMAIN が未設定です。');
  console.warn('       全ユーザーのログイン・登録が拒否されます。');
  console.warn('       .env.local に ALLOWED_EMAIL_DOMAIN=your-domain.co.jp を設定してください。');
  console.warn('       設定後は開発サーバーを再起動してください（起動中は反映されないことがあります）。');
  console.warn('');
}

checkAuthConfig();

/**
 * セキュリティヘッダ（Phase DEL QAレビュー Q-53）
 *
 * ブラウザ側の防御機能を明示的に有効化する。
 * これらが無いと、ブラウザは既定の緩い挙動で動作する。
 *
 * 【CSP（Content-Security-Policy）を今回入れない理由】
 * Next.jsはインラインスクリプト・インラインスタイルを動的に生成するため、
 * nonce の受け渡しを組まずにCSPを入れると画面が壊れる。
 * 中途半端に入れて `unsafe-inline` を許可すると、防御としては意味を持たないまま
 * 「CSP対応済み」に見えてしまうため、別タスクとして扱う。
 */
const securityHeaders = [
  {
    // ブラウザによるMIMEタイプの推測を禁止する。
    // 推測を許すと、テキストとして返した内容をスクリプトとして実行される余地が生まれる
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    // 他サイトのiframeへ埋め込ませない（クリックジャッキング対策）。
    // 埋め込まれると、透明な要素を重ねて利用者に意図しない操作をさせられる
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    // 古いブラウザ向けのXSSフィルタ。最新ブラウザでは無視されるが、
    // 社内に古い端末が残っている場合の保険として付ける
    key: 'X-XSS-Protection',
    value: '1; mode=block',
  },
  {
    // 外部サイトへ遷移する際、URLのパス・クエリを送らずドメインのみを送る。
    // 社内文書の検索画面URLが外部サイトのアクセスログへ残るのを防ぐ
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    // 使用しないブラウザ機能を明示的に無効化する。
    // このアプリはカメラ・マイク・位置情報を一切使わない
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * 全ページ・全APIへセキュリティヘッダを付与する。
   * `/:path*` は静的ファイルを含むすべてのパスに一致する
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },

  experimental: {
    /**
     * pdf-parse（内部で pdfjs-dist を使用）をwebpackのバンドル対象から外す。
     *
     * pdfjs-dist の ESM ビルドはwebpackでバンドルすると
     * 「TypeError: Object.defineProperty called on non-object」で読み込みに失敗し、
     * `/api/documents` がモジュール読み込み時点で500になる。
     * Node.js の require で直接読ませることで回避する。
     *
     * この設定を外すとPDFアップロードAPIが起動しなくなるため、削除しないこと。
     */
    serverComponentsExternalPackages: ['pdf-parse', 'pdfjs-dist'],
  },
};

export default nextConfig;
