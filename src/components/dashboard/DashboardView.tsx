'use client';

import { useEffect, useState, type ReactNode } from 'react';
import styles from './DashboardView.module.css';
import type { ChatHistory, DocumentSummary } from '@/types/api';
import { fetchHistories } from '@/lib/api/histories';
import { fetchDocuments } from '@/lib/api/documents';
import { formatDateTime } from '@/lib/format';
import { NAV_ROUTES } from '@/lib/navigation/routes';
import {
  AlertCircleIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  FolderUpIcon,
  HistoryIcon,
  LoaderIcon,
  MessageSquarePlusIcon,
  SearchIcon,
} from '@/components/icons';

/**
 * ダッシュボード（`/dashboard`）
 *
 * ログイン後の初期画面。「次に何をすればよいか」を1画面で示す。
 *
 * 【この画面を作った理由】
 * ログイン直後がチャットだと、質問する以外の操作（文書の追加・状態の確認）へ
 * 行くにはサイドバーを読む必要があった。
 * 主要な入口・直近の利用状況・文書の状態をここへ集約し、
 * 最初の1クリックで目的の画面へ入れるようにしている。
 *
 * 【表示するデータについて】
 * 質問履歴・文書の状態は実データ（GET /api/histories・GET /api/documents）。
 * 精度サマリーだけは Phase VAL の測定結果を固定値として表示する（下記コメント参照）。
 */

/** 「最近の質問履歴」に出す件数 */
const RECENT_HISTORY_COUNT = 5;

/**
 * 精度サマリー（Phase VALの測定結果・固定値）。
 *
 * 【重要】ここは実測値のみを載せること。
 * 測っていない数字を出すと、クライアントへの説明が事実と食い違う。
 * 値を変えるときは必ず検証をやり直し、測定条件（下の note）も更新すること。
 *
 *  - 回答精度100%       … 12問中、文書に記載のある10問すべて正答
 *  - ハルシネーション0件 … 12問すべてで文書外の推測回答なし
 *  - 検証問題数12問      … 講座提供の case3-test-questions.csv
 *  - 平均回答時間2.0秒   … POST /api/chat の成功21件の実測平均（1.39〜2.88秒）
 */
const ACCURACY_STATS = [
  { value: '100%', label: '回答精度' },
  { value: '0件', label: 'ハルシネーション' },
  { value: '12問', label: '検証問題数' },
  { value: '2.0秒', label: '平均回答時間' },
];

/** クイックアクション。サイドバーの主要ナビと同じ遷移先にそろえる */
const QUICK_ACTIONS: { href: string; title: string; sub: string; icon: ReactNode }[] = [
  {
    href: NAV_ROUTES.chat,
    title: '新しい質問',
    sub: '社内文書に質問する',
    icon: <MessageSquarePlusIcon size={20} />,
  },
  {
    href: NAV_ROUTES.documents,
    title: '文書管理',
    sub: 'アップロード・更新',
    icon: <FolderUpIcon size={20} />,
  },
  {
    href: NAV_ROUTES.search,
    title: '文書を検索',
    sub: 'フィルター・文書一覧',
    icon: <SearchIcon size={20} />,
  },
  {
    href: NAV_ROUTES.history,
    title: '質問履歴',
    sub: '過去の質問と出典',
    icon: <HistoryIcon size={20} />,
  },
];

export function DashboardView() {
  const [histories, setHistories] = useState<ChatHistory[]>([]);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [isDocumentLoading, setIsDocumentLoading] = useState(true);

  /**
   * 履歴と文書を取得する。
   *
   * 片方が失敗しても、もう片方は表示する（Promise.all でまとめて失敗させない）。
   * 履歴の取得に失敗しただけで文書の状態まで見えなくなるのは、
   * 「次に何をすればよいか」を示すこの画面の目的に反するため。
   */
  useEffect(() => {
    let isMounted = true;

    void fetchHistories(RECENT_HISTORY_COUNT)
      .then((data) => {
        if (!isMounted) return;
        setHistories(data.slice(0, RECENT_HISTORY_COUNT));
        setHistoryError(null);
      })
      .catch(() => {
        if (!isMounted) return;
        setHistoryError('質問履歴を取得できませんでした。ページを再読み込みしてお試しください。');
      })
      .finally(() => {
        if (isMounted) setIsHistoryLoading(false);
      });

    void fetchDocuments()
      .then((data) => {
        if (!isMounted) return;
        setDocuments(data);
        setDocumentError(null);
      })
      .catch(() => {
        if (!isMounted) return;
        setDocumentError('文書の状態を取得できませんでした。ページを再読み込みしてお試しください。');
      })
      .finally(() => {
        if (isMounted) setIsDocumentLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const readyCount = documents.filter((document) => document.status === 'ready').length;
  const processingCount = documents.filter((document) => document.status === 'processing').length;
  const errorCount = documents.filter((document) => document.status === 'error').length;

  return (
    <div className={styles.screen}>
      <div className={styles.body}>
        {/* ─── 上部：クイックアクション ─── */}
        <section className={styles.quickSection} aria-label="クイックアクション">
          {/*
            ページ遷移は <a> タグを使う（CLAUDE.md セクション8）。
            Next.jsのルーターキャッシュに前の画面が残らないようにするため
          */}
          {QUICK_ACTIONS.map((action) => (
            <a href={action.href} className={styles.quickCard} key={action.href}>
              <span className={styles.quickIcon}>{action.icon}</span>
              <span className={styles.quickText}>
                <span className={styles.quickTitle}>{action.title}</span>
                <span className={styles.quickSub}>{action.sub}</span>
              </span>
              <span className={styles.quickChevron}>
                <ChevronRightIcon size={14} strokeWidth={2.2} />
              </span>
            </a>
          ))}
        </section>

        {/* ─── 中段：最近の質問履歴 / 文書の状態 ─── */}
        <div className={styles.middleRow}>
          <section className={styles.card} aria-label="最近の質問履歴">
            <div className={styles.cardHeader}>
              <span className={styles.cardIcon}>
                <HistoryIcon size={14} />
              </span>
              <h2 className={styles.cardTitle}>最近の質問履歴</h2>
              <a href={NAV_ROUTES.history} className={styles.cardLink}>
                すべて見る
                <ChevronRightIcon size={12} strokeWidth={2.2} />
              </a>
            </div>

            <div className={styles.cardBody}>
              {isHistoryLoading && <p className={styles.mutedText}>読み込んでいます...</p>}

              {historyError && (
                <p className={styles.errorText} role="alert">
                  {historyError}
                </p>
              )}

              {!isHistoryLoading && !historyError && histories.length === 0 && (
                <p className={styles.mutedText}>
                  まだ質問がありません。「新しい質問」から社内文書に質問してみてください。
                </p>
              )}

              {histories.map((history) => (
                <a href={NAV_ROUTES.history} className={styles.historyItem} key={history.id}>
                  <span className={styles.historyQuestion}>{history.question}</span>
                  <span className={styles.historyTime}>{formatDateTime(history.created_at)}</span>
                </a>
              ))}
            </div>
          </section>

          <section className={styles.card} aria-label="文書の状態">
            <div className={styles.cardHeader}>
              <span className={styles.cardIcon}>
                <FolderUpIcon size={14} />
              </span>
              <h2 className={styles.cardTitle}>文書の状態</h2>
              <a href={NAV_ROUTES.documents} className={styles.cardLink}>
                文書管理へ
                <ChevronRightIcon size={12} strokeWidth={2.2} />
              </a>
            </div>

            <div className={styles.cardBody}>
              {isDocumentLoading && <p className={styles.mutedText}>読み込んでいます...</p>}

              {documentError && (
                <p className={styles.errorText} role="alert">
                  {documentError}
                </p>
              )}

              {!isDocumentLoading && !documentError && (
                <>
                  <ul className={styles.statusList}>
                    <li className={styles.statusRow}>
                      <span className={`${styles.statusIcon} ${styles.statusReady}`}>
                        <CheckCircleIcon size={14} />
                      </span>
                      <span className={styles.statusLabel}>検索可能</span>
                      <span className={styles.statusCount}>{readyCount}件</span>
                    </li>
                    <li className={styles.statusRow}>
                      <span className={`${styles.statusIcon} ${styles.statusProcessing}`}>
                        <LoaderIcon size={14} />
                      </span>
                      <span className={styles.statusLabel}>処理中</span>
                      <span className={styles.statusCount}>{processingCount}件</span>
                    </li>
                    <li className={styles.statusRow}>
                      <span className={`${styles.statusIcon} ${styles.statusError}`}>
                        <AlertCircleIcon size={14} />
                      </span>
                      <span className={styles.statusLabel}>エラー</span>
                      <span className={styles.statusCount}>{errorCount}件</span>
                    </li>
                  </ul>

                  {/* 放置すると検索対象から抜け落ちたままになるため、次の行動を明示する */}
                  {errorCount > 0 && (
                    <p className={styles.statusNote}>
                      取り込みに失敗した文書があります。文書管理の「更新」からPDFを選び直して取り込み直してください。
                    </p>
                  )}

                  {documents.length === 0 && (
                    <p className={styles.statusNote}>
                      まだ文書が登録されていません。文書管理からPDFを追加してください。
                    </p>
                  )}
                </>
              )}
            </div>
          </section>
        </div>

        {/* ─── 下部：精度サマリー ─── */}
        <section className={styles.card} aria-label="精度サマリー">
          <div className={styles.cardHeader}>
            <span className={styles.cardIcon}>
              <CheckCircleIcon size={14} />
            </span>
            <h2 className={styles.cardTitle}>精度サマリー</h2>
          </div>

          <div className={styles.cardBody}>
            <div className={styles.statsGrid}>
              {ACCURACY_STATS.map((stat) => (
                <div className={styles.statItem} key={stat.label}>
                  <span className={styles.statValue}>{stat.value}</span>
                  <span className={styles.statLabel}>{stat.label}</span>
                </div>
              ))}
            </div>

            {/* 根拠のない数字に見せないため、測定条件を必ず添える */}
            <p className={styles.statsNote}>
              精度検証（12問・文書に記載あり10問／記載なし2問）の結果と、
              応答21件の実測平均です。現在の登録文書に対する自動計測ではありません。
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
