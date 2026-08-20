import { DemoKeyForm } from '@/components/demo/DemoKeyForm';

/**
 * デモ用APIキー入力画面（BYOKデモ STEP B）
 *
 * 【認証について】
 * `/demo/*` は Middleware の公開パスに含まれており、認証チェックを行わない。
 * この画面と `/demo/chat` は Supabase を一切使わず、ブラウザ内で完結する。
 */

export const metadata = {
  title: 'デモを試す | 社内文書検索AI',
  description: 'ご自身のGemini APIキーで、サンプル社内文書に対する検索を試せます。',
};

export default function DemoPage() {
  return <DemoKeyForm />;
}
