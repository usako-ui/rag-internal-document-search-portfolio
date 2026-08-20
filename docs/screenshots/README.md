# スクリーンショット

`README.md` と `docs/operations.md` へ埋め込んでいる画面キャプチャです。

**これらは実際に動作しているアプリから自動撮影しています。** イメージ図やモックアップではありません。

## 撮り直す方法

画面を変更したら、次のコマンドで13枚すべてを撮り直せます。

```bash
# 別のターミナルで開発サーバーを起動しておく
npm run dev

# 撮影
npm run capture:screenshots
```

撮影スクリプトは [`scripts/capture-screenshots.ts`](../../scripts/capture-screenshots.ts) です。

### 前提条件

| # | 条件 | 確認方法 |
|---|---|---|
| 1 | 開発サーバーが起動している | `http://localhost:3000` が開ける |
| 2 | `.env.local` に `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` がある | そのユーザーでログインできること（`npm run create:test-user`） |
| 3 | Google Chrome がインストールされている | 別の場所にある場合は `CHROME_PATH` で指定する |
| 4 | 文書が5件とも「検索可能」になっている | 08・09の一覧が正しく写るため |

### Gemini APIの利用制限に注意

**`06-chat-answer.png` と `07-citation-modal.png` の2枚だけが、実際にGemini APIを呼びます。**
無料枠は毎分5回・1日20回のため、続けて実行すると制限に達して撮影が止まります。

他の画面だけ撮り直したい場合は、この2枚をスキップできます。

```bash
SKIP_CHAT_ANSWER=1 npm run capture:screenshots
```

### 別のポート・環境で撮る場合

```bash
BASE_URL=http://localhost:3100 npm run capture:screenshots
```

## 撮影されるファイル

| ファイル名 | 画面 | 備考 |
|---|---|---|
| `01-landing.png` | `/` ランディング | 未ログイン状態で撮影（ログイン済みだと `/dashboard` へ自動遷移するため） |
| `02-login.png` | `/login` | 未ログイン |
| `03-register.png` | `/register` | 未ログイン |
| `04-dashboard.png` | `/dashboard` | ログイン後 |
| `05-chat.png` | `/chat?new=1` | 質問前の初期状態 |
| `06-chat-answer.png` | `/chat` | 「在宅勤務手当はいくらですか？」の回答・出典 |
| `07-citation-modal.png` | `/chat` | 出典モーダルを開いた状態 |
| `08-documents.png` | `/documents` | 文書管理 |
| `09-search.png` | `/search` | 文書検索 |
| `10-histories.png` | `/histories` | 質問履歴 |
| `11-settings.png` | `/settings` | 設定 |
| `12-demo.png` | `/demo` | APIキーを入力する**前**の状態 |
| `13-mobile-chat.png` | `/chat` | スマホ幅375pxで撮影 |

## スクリプトが行っている配慮

| 配慮 | 理由 |
|---|---|
| ログイン中のメールアドレスを `user@example.co.jp` へ差し替える | 画像は納品資料として配布されるため、実在しうるアドレスやクライアントの社名ドメインを載せない。表示テキストだけを撮影直前に置き換えており、アプリの動作やデータには影響しない |
| ランディングは未ログインの別ブラウザコンテキストで撮影する | ログイン済みだと `/dashboard` へ自動遷移してしまう |
| `12-demo.png` はAPIキー入力前に撮影する | 画像にAPIキーを写さない |
| 画面の高さを内容に合わせて自動調整する | このアプリはメイン領域が内部スクロールするため、`fullPage` では下が切れる。はみ出している分だけ画面を広げて全体を写す |
| ランディングは4秒待ってから撮影する | チャットデモが自動再生されるため、入力中の「…」のまま撮れてしまうのを防ぐ |

## 手作業で撮影する場合（Chrome）

1. `F12` でDevToolsを開く
2. スマホ表示は Responsive Design モード（`Ctrl+Shift+M`）で幅 375px に設定する
3. `Ctrl+Shift+P` → 「Capture screenshot」でキャプチャする

手作業で撮る場合は、**ログイン中のメールアドレスが写り込まないよう**注意してください。

## コミット前の確認

- [ ] 実在する個人名・メールアドレスが写っていない
- [ ] APIキーが写っていない
- [ ] `README.md` と `docs/operations.md` で画像が表示される
