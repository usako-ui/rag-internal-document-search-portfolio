import { DemoChat } from '@/components/demo/DemoChat';

/**
 * デモ用チャット画面（BYOKデモ STEP C）
 *
 * 【認証について】
 * `/demo/*` は Middleware の公開パスに含まれており、認証チェックを行わない。
 * この画面は Supabase を一切使わず、Gemini APIをブラウザから直接呼ぶ。
 *
 * APIキーが未設定の場合は `/demo` へ戻す処理を DemoChat 側で行っている
 * （sessionStorage はサーバー側から読めないため、判定はクライアントで行う必要がある）。
 */

// sessionStorage を読むまで表示内容が決まらないため、静的に事前生成しない
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'デモ | 社内文書検索AI',
  description: 'サンプル社内文書に対する検索を試せるデモ画面です。',
};

export default function DemoChatPage() {
  return <DemoChat />;
}
