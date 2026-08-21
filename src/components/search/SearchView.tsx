'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './SearchView.module.css';
import { useDocumentLibrary } from '@/hooks/useDocumentLibrary';
import type { DocumentStatus, DocumentSummary } from '@/types/api';
import { formatDateTime, getDocumentStatusLabel } from '@/lib/format';
import { NEW_CHAT_PATH } from '@/lib/navigation/routes';
import {
  AlertCircleIcon,
  CheckCircleIcon,
  FileIcon,
  LoaderIcon,
  SearchIcon,
  XIcon,
} from '@/components/icons';

/**
 * 文書を検索する画面（`/search` / 要件F-09 ＋）
 *
 * 「いまAIが検索対象にしている文書」を絞り込んで確認するための画面。
 * UX優先順位5位「現在の検索対象文書が分かる」に対応する。
 *
 * 【文書管理（`/documents`）との違い】
 * こちらは「探して確認する」画面で、更新・削除は持たない。
 * 一覧を見ながら誤って削除してしまう事故を避けるため、
 * 文書を変更する操作は文書管理へ集約している。
 *
 * 【絞り込みをサーバー側で行う理由】
 * 管轄部署とキーワードは GET /api/documents のクエリパラメータで絞り込む。
 * 文書が増えても全件をブラウザへ送らずに済み、
 * 「人事部の文書だけ見たい」という使い方が件数に関わらず成立する。
 */

/** 管轄部署の選択肢。サーバー側は部分一致で絞り込む */
const DEPARTMENT_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'すべての部署' },
  { value: '人事部', label: '人事部' },
  { value: '経理部', label: '経理部' },
  { value: '情報システム部', label: '情報システム部' },
];

/** キーワード入力をサーバーへ反映するまでの待ち時間（ms） */
const KEYWORD_DEBOUNCE_MS = 350;

/** 登録状態バッジの見た目とアイコン */
function getStatusPresentation(status: DocumentStatus) {
  switch (status) {
    case 'ready':
      return { className: styles.statusReady, icon: <CheckCircleIcon size={11} /> };
    case 'processing':
      return { className: styles.statusProcessing, icon: <LoaderIcon size={11} /> };
    case 'error':
      return { className: styles.statusError, icon: <AlertCircleIcon size={11} /> };
    default:
      return { className: '', icon: null };
  }
}

/**
 * 登録状態ごとの説明。
 * 「ready」のような内部の値ではなく、利用者にとって何が起きているかを書く。
 */
function getStatusDescription(status: DocumentStatus): string {
  switch (status) {
    case 'ready':
      return 'この文書は検索対象です。チャットで質問すると、回答の根拠として使われます。';
    case 'processing':
      return '検索用データを作成中です。完了すると質問の対象になります（数分かかる場合があります）。';
    case 'error':
      return '取り込みに失敗しています。文書管理の「更新」からPDFを選び直して取り込み直してください。';
    default:
      return '';
  }
}

export function SearchView() {
  const library = useDocumentLibrary();

  // 入力欄の値。サーバーへ送るのは打ち終わりを待ってから（下のデバウンス処理）
  const [keyword, setKeyword] = useState('');
  const [selectedDocument, setSelectedDocument] = useState<DocumentSummary | null>(null);

  // タイマーから最新の条件・コールバックを参照するための保持
  const filtersRef = useRef(library.filters);
  const setFiltersRef = useRef(library.setFilters);

  useEffect(() => {
    filtersRef.current = library.filters;
    setFiltersRef.current = library.setFilters;
  }, [library.filters, library.setFilters]);

  /**
   * キーワードの反映をデバウンスする。
   *
   * 1文字打つたびに GET /api/documents を呼ぶと、
   * 入力中ずっと通信が走り一覧がちらつく。打ち終わりを待ってから1回だけ送る。
   */
  useEffect(() => {
    if (keyword === (filtersRef.current.keyword ?? '')) return;

    const timer = setTimeout(() => {
      setFiltersRef.current({ ...filtersRef.current, keyword });
    }, KEYWORD_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [keyword]);

  const documents = library.documents;

  return (
    <div className={styles.screen}>
      {/* ─── 上部：フィルターエリア ─── */}
      <div className={styles.filterBar}>
        <div className={styles.searchField}>
          <span className={styles.searchIcon}>
            <SearchIcon size={13} />
          </span>
          <input
            type="search"
            className={styles.searchInput}
            placeholder="文書名で検索"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            aria-label="文書名で検索"
          />
        </div>

        <label className={styles.srOnlyLabel} htmlFor="search-department-filter">
          管轄部署で絞り込む
        </label>
        <select
          id="search-department-filter"
          className={styles.select}
          value={library.filters.department ?? ''}
          onChange={(event) =>
            library.setFilters({ ...library.filters, department: event.target.value })
          }
        >
          {DEPARTMENT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.layout}>
        {/* ─── メイン：文書一覧（フィルター結果） ─── */}
        <div className={styles.listColumn}>
          <div className={styles.summary}>
            {library.isLoading ? '文書を読み込んでいます...' : `${documents.length}件の文書`}
          </div>

          {library.errorMessage && (
            <div className={styles.errorNotice} role="alert">
              <span className={styles.noticeIcon}>
                <AlertCircleIcon size={15} strokeWidth={2.2} />
              </span>
              <span>
                {library.errorMessage}
                <br />
                解消しない場合はページを再読み込みするか、管理者へご連絡ください。
              </span>
            </div>
          )}

          {/*
            行そのものが「詳細を開く」ボタンなので、表(role=table)ではなくボタンの一覧にしている。
            ボタンに role="row" を付けるとボタンであることが支援技術へ伝わらなくなるため。
            列見出しは視覚的な目印なので aria-hidden にし、
            各行の読み上げ内容は aria-label で項目名付きに組み立てる。
          */}
          <ul className={styles.table}>
            <li className={styles.headRow} aria-hidden="true">
              <span>文書名</span>
              <span>管轄部署</span>
              <span>登録日時</span>
              <span>登録状態</span>
            </li>

            {documents.length === 0 && !library.isLoading && (
              <li>
                <p className={styles.emptyText}>
                  条件に一致する文書がありません。
                  <br />
                  キーワードや管轄部署の絞り込みを変えてお試しください。
                </p>
              </li>
            )}

            {documents.map((document) => {
              const presentation = getStatusPresentation(document.status);
              const isSelected = selectedDocument?.id === document.id;
              const statusLabel = getDocumentStatusLabel(document.status);

              return (
                <li key={document.id}>
                  <button
                    type="button"
                    className={`${styles.row} ${isSelected ? styles.rowSelected : ''}`}
                    onClick={() => setSelectedDocument(document)}
                    aria-pressed={isSelected}
                    aria-label={`${document.name}／管轄部署 ${
                      document.department ?? '未設定'
                    }／登録日時 ${formatDateTime(
                      document.uploaded_at
                    )}／登録状態 ${statusLabel}／詳細を表示`}
                  >
                    <span className={styles.nameCell}>
                      <span className={styles.pdfIcon}>
                        <FileIcon size={15} />
                      </span>
                      <span className={styles.name}>{document.name}</span>
                    </span>

                    <span className={styles.cell}>
                      <span className={styles.cellLabel}>管轄部署</span>
                      {document.department ?? '未設定'}
                    </span>

                    <span className={styles.cell}>
                      <span className={styles.cellLabel}>登録日時</span>
                      {formatDateTime(document.uploaded_at)}
                    </span>

                    <span className={styles.cell}>
                      <span className={styles.cellLabel}>登録状態</span>
                      <span className={`${styles.statusBadge} ${presentation.className}`}>
                        {presentation.icon}
                        {statusLabel}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* ─── 詳細表示（文書クリック時） ─── */}
        {selectedDocument && (
          <aside className={styles.detail} aria-label="文書の詳細">
            <div className={styles.detailHeader}>
              <span className={styles.detailTitle}>文書の詳細</span>
              <button
                type="button"
                className={styles.detailClose}
                onClick={() => setSelectedDocument(null)}
                aria-label="詳細を閉じる"
              >
                <XIcon size={15} />
              </button>
            </div>

            <div className={styles.detailBody}>
              <div className={styles.detailName}>
                <span className={styles.pdfIcon}>
                  <FileIcon size={16} />
                </span>
                {selectedDocument.name}
              </div>

              <dl className={styles.detailList}>
                <dt>種別</dt>
                <dd>PDF</dd>

                <dt>管轄部署</dt>
                <dd>{selectedDocument.department ?? '未設定'}</dd>

                <dt>登録日時</dt>
                <dd>{formatDateTime(selectedDocument.uploaded_at)}</dd>

                <dt>登録状態</dt>
                <dd>
                  <span
                    className={`${styles.statusBadge} ${
                      getStatusPresentation(selectedDocument.status).className
                    }`}
                  >
                    {getStatusPresentation(selectedDocument.status).icon}
                    {getDocumentStatusLabel(selectedDocument.status)}
                  </span>
                </dd>
              </dl>

              <p className={styles.detailNote}>{getStatusDescription(selectedDocument.status)}</p>

              {/*
                ページ遷移は <a> タグを使う（コーディング規約）。
                Next.jsのルーターキャッシュに前の画面が残らないようにするため
              */}
              <div className={styles.detailActions}>
                <a href={NEW_CHAT_PATH} className={styles.detailPrimary}>
                  この文書について質問する
                </a>
                <a href="/documents" className={styles.detailSecondary}>
                  文書管理で更新・削除する
                </a>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
