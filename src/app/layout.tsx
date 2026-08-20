import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '社内文書検索AI',
  description: '社内文書を根拠にAIが回答する、株式会社テックブリッジの社内向け検索システム',
};

/**
 * 全画面共通のルートレイアウト。
 * フォントスタックは globals.css の --font トークンで一元管理している。
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
