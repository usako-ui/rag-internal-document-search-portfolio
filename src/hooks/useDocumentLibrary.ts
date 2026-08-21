'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocumentSummary } from '@/types/api';
import {
  UPLOAD_STAGE_ORDER,
  isUploadJobFinished,
  type UploadJob,
  type UploadStage,
} from '@/types/upload';
import {
  DocumentApiError,
  type DocumentFilters,
  deleteDocument,
  fetchDocuments,
  uploadDocument,
  validatePdfFile,
} from '@/lib/api/documents';
import { mockDocuments } from '@/mocks/documents';

/**
 * 文書一覧とアップロード状態をまとめて扱うフック
 *
 * ここが担当すること：
 *  - GET /api/documents の取得と、取り込み中のポーリング
 *  - POST /api/documents の送信とアップロード段階の管理
 *  - エラーメッセージの保持
 *
 * 文書一覧とアップロードパネルの両方が同じ状態を見る必要があるため、
 * AppShellで1回だけ呼び出し、そこから各コンポーネントへ渡す。
 */

/**
 * 文書一覧のサンプル表示フォールバック。
 *
 * 認証Middlewareが未完成だった間の暫定措置。
 * 統合フェーズ で全領域を統合し、GET /api/documents が実データを返せる
 * ようになったため false にした。実データが0件のときは、モックではなく
 * 「まだ文書が登録されていません」という空状態を表示する。
 *
 * サンプルを出したままにすると、登録済みだと誤解させるおそれがあるため
 * 統合後は必ず false にすること。
 */
const USE_SAMPLE_DOCUMENT_FALLBACK = false;

/** 取り込み中の文書があるときに一覧を再取得する間隔（ms） */
const POLL_INTERVAL_MS = 3000;

/**
 * 段階表示の最低表示時間（ms）。
 * サーバー処理が速いと段階が一瞬で飛んでしまい、
 * 「今何をしているのか分からない」状態になる（F-07が禁止している状態）ため、
 * 各段階を最低このミリ秒だけ表示してから次へ進める。
 */
const MIN_STAGE_MS = 700;

/** 取り込みがサーバー側で失敗したとき（documents.status = error）のメッセージ */
const INGEST_FAILED_MESSAGE =
  '検索用データの作成に失敗しました。PDFの内容を確認して、もう一度アップロードしてください。';

export type DocumentLibrary = {
  /** 画面に表示する文書一覧（サンプル表示中はモック） */
  documents: DocumentSummary[];
  /** 初回取得中かどうか */
  isLoading: boolean;
  /** 一覧取得に失敗したときの利用者向けメッセージ */
  errorMessage: string | null;
  /** サンプルデータを表示しているか（実データが0件・または取得失敗時） */
  isSampleData: boolean;
  /** 進行中・完了直後のアップロード一覧 */
  uploadJobs: UploadJob[];
  /** 一覧を再取得する */
  refresh: () => void;
  /**
   * アップロードを開始する。
   * replacesDocumentName / replacesDocumentId は資料更新（F-08）から呼ばれたとき。
   * ID を渡すと、改訂でPDFのタイトル行が変わっていてもその文書を置き換える。
   */
  startUpload: (
    file: File,
    options?: { replacesDocumentName?: string; replacesDocumentId?: string }
  ) => void;
  /**
   * 文書を削除する（F-09）。
   * 失敗したときは利用者向けメッセージを持つ例外（DocumentApiError）を投げるので、
   * 呼び出し側で捕まえて画面に表示すること。
   */
  removeDocument: (documentId: string) => Promise<void>;
  /** 完了・失敗したアップロード表示を閉じる */
  dismissJob: (jobId: string) => void;
  /** 現在の絞り込み条件 */
  filters: DocumentFilters;
  /** 絞り込み条件を変更する。変更すると一覧を取得し直す */
  setFilters: (filters: DocumentFilters) => void;
};

export function useDocumentLibrary(): DocumentLibrary {
  const [realDocuments, setRealDocuments] = useState<DocumentSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [uploadJobs, setUploadJobs] = useState<UploadJob[]>([]);

  /**
   * 絞り込み条件。
   * サーバー側（GET /api/documents）で絞り込むため、変更のたびに取得し直す。
   */
  const [filters, setFilters] = useState<DocumentFilters>({});

  /**
   * ポーリングのタイマーから最新の条件を参照するための保持。
   * stateを直接見ると、タイマー登録時点の古い条件で取得してしまい、
   * 絞り込み中に自動更新が走ると一覧が全件へ戻る。
   */
  const filtersRef = useRef<DocumentFilters>(filters);
  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  /**
   * アップロード状態の正本。
   * 段階を進めるタイマーからも参照するため、stateとは別にrefでも保持する
   * （setStateの更新関数内で副作用を起こさず、常に最新の値を読めるようにするため）。
   */
  const jobsRef = useRef<UploadJob[]>([]);
  /** ジョブごとの「進めたい段階」。実イベントを受け取るたびに更新する */
  const stageTargetsRef = useRef<Map<string, UploadStage>>(new Map());
  /** ジョブごとの段階送りタイマー。最低表示時間の制御に使う */
  const stageTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  /** アンマウント後にstateを更新しないためのフラグ */
  const isMountedRef = useRef(true);
  const jobCounterRef = useRef(0);

  // ────────────────────────────────
  // アップロード状態の更新（refとstateを常に同期させる）
  // ────────────────────────────────

  const commitJobs = useCallback((next: UploadJob[]) => {
    jobsRef.current = next;
    if (isMountedRef.current) setUploadJobs(next);
  }, []);

  const updateJob = useCallback(
    (jobId: string, patch: Partial<UploadJob>) => {
      commitJobs(jobsRef.current.map((job) => (job.id === jobId ? { ...job, ...patch } : job)));
    },
    [commitJobs]
  );

  const clearStageTimer = useCallback((jobId: string) => {
    const timer = stageTimersRef.current.get(jobId);
    if (timer) clearTimeout(timer);
    stageTimersRef.current.delete(jobId);
  }, []);

  // ────────────────────────────────
  // 段階表示（F-07）
  // ────────────────────────────────

  /**
   * 目標段階へ向けて1段だけ進め、最低表示時間の経過後にもう一度自分を呼ぶ。
   *
   * 1段ずつしか進めないため、サーバー処理が速くて
   * 「アップロード済み」から一気に「検索可能」へ飛ぶような場合でも、
   * 途中の段階が必ず画面に表示される。
   */
  const pumpStageRef = useRef<(jobId: string) => void>(() => {});

  const pumpStage = useCallback(
    (jobId: string) => {
      // すでに段階送りが進行中なら、そのタイマーの完了時に続きが処理される
      if (stageTimersRef.current.has(jobId)) return;

      const job = jobsRef.current.find((item) => item.id === jobId);
      const target = stageTargetsRef.current.get(jobId);
      if (!job || !target || job.stage === 'error') return;

      const currentIndex = UPLOAD_STAGE_ORDER.indexOf(job.stage);
      const targetIndex = UPLOAD_STAGE_ORDER.indexOf(target);
      if (currentIndex < 0 || targetIndex < 0 || currentIndex >= targetIndex) return;

      updateJob(jobId, { stage: UPLOAD_STAGE_ORDER[currentIndex + 1] });

      // 進めた直後は必ず待つ。次の目標が即座に届いても段階が飛ばないようにする
      const timer = setTimeout(() => {
        stageTimersRef.current.delete(jobId);
        // 自分自身を再帰的に呼ぶ。refを経由するのは、useCallbackの依存配列が
        // 自己参照で循環するのを避けるため
        pumpStageRef.current(jobId);
      }, MIN_STAGE_MS);

      stageTimersRef.current.set(jobId, timer);
    },
    [updateJob]
  );

  useEffect(() => {
    pumpStageRef.current = pumpStage;
  }, [pumpStage]);

  /** 実イベントを受けて目標段階を更新する */
  const requestStage = useCallback(
    (jobId: string, target: UploadStage) => {
      stageTargetsRef.current.set(jobId, target);
      pumpStage(jobId);
    },
    [pumpStage]
  );

  /** エラーは順序を持たないため、段階送りを止めて即座に反映する */
  const failJob = useCallback(
    (jobId: string, message: string) => {
      clearStageTimer(jobId);
      stageTargetsRef.current.delete(jobId);
      updateJob(jobId, { stage: 'error', errorMessage: message });
    },
    [clearStageTimer, updateJob]
  );

  // ────────────────────────────────
  // 文書一覧の取得
  // ────────────────────────────────

  /**
   * 取得した一覧の status を、進行中のアップロード段階へ反映する。
   * ready になった時点で「検索可能」、error なら失敗として表示する。
   */
  const syncJobsWithDocuments = useCallback(
    (documents: DocumentSummary[]) => {
      for (const job of jobsRef.current) {
        if (!job.documentId || isUploadJobFinished(job)) continue;

        const document = documents.find((item) => item.id === job.documentId);
        if (!document) continue;

        if (document.status === 'ready') requestStage(job.id, 'ready');
        if (document.status === 'error') failJob(job.id, INGEST_FAILED_MESSAGE);
      }
    },
    [failJob, requestStage]
  );

  const refresh = useCallback(async () => {
    try {
      const documents = await fetchDocuments(filtersRef.current);
      if (!isMountedRef.current) return;

      setRealDocuments(documents);
      setErrorMessage(null);
      syncJobsWithDocuments(documents);
    } catch (error) {
      if (!isMountedRef.current) return;

      setErrorMessage(
        error instanceof DocumentApiError
          ? error.userMessage
          : '文書一覧を取得できませんでした。時間をおいてもう一度お試しください。'
      );
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  }, [syncJobsWithDocuments]);

  // 最新のrefreshをタイマーから呼ぶための参照（間隔の再設定を避ける）
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  /**
   * 絞り込み条件が変わったら取得し直す。
   *
   * 初回マウント時は下の「初回取得」が走るため、ここではスキップする
   * （両方走ると同じリクエストを2回投げてしまう）。
   */
  const isFirstFilterEffectRef = useRef(true);
  useEffect(() => {
    if (isFirstFilterEffectRef.current) {
      isFirstFilterEffectRef.current = false;
      return;
    }

    void refreshRef.current();
  }, [filters]);

  // 初回取得
  useEffect(() => {
    isMountedRef.current = true;
    // 後片付けで参照するMapは同じインスタンスを使い続けるため、ここで束縛しておく
    const stageTimers = stageTimersRef.current;
    void refreshRef.current();

    return () => {
      isMountedRef.current = false;
      stageTimers.forEach((timer) => clearTimeout(timer));
      stageTimers.clear();
    };
  }, []);

  // 取り込み中がある間だけポーリングする（完了後は無駄な通信をしない）
  const hasProcessingDocument = realDocuments.some((document) => document.status === 'processing');
  const hasRunningJob = uploadJobs.some((job) => !isUploadJobFinished(job));
  const shouldPoll = hasProcessingDocument || hasRunningJob;

  useEffect(() => {
    if (!shouldPoll) return;

    const interval = setInterval(() => {
      void refreshRef.current();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [shouldPoll]);

  // ────────────────────────────────
  // アップロード
  // ────────────────────────────────

  const startUpload = useCallback(
    (file: File, options?: { replacesDocumentName?: string; replacesDocumentId?: string }) => {
      jobCounterRef.current += 1;
      const jobId = `upload-${jobCounterRef.current}`;

      // 送信前に判定できる問題（PDF以外・50MB超）はここで具体的に伝える（F-07）
      const validationMessage = validatePdfFile(file);

      const job: UploadJob = {
        id: jobId,
        fileName: file.name,
        progress: 0,
        stage: validationMessage ? 'error' : 'uploading',
        documentId: null,
        errorMessage: validationMessage,
        replacesDocumentName: options?.replacesDocumentName ?? null,
      };

      commitJobs([job, ...jobsRef.current]);

      if (validationMessage) return;

      stageTargetsRef.current.set(jobId, 'uploading');

      void uploadDocument(file, {
        onProgress: (percent) => updateJob(jobId, { progress: percent }),
        // 送信完了＝サーバーがテキスト抽出を開始した時点
        onUploadComplete: () => requestStage(jobId, 'uploaded'),
        // 「更新」から呼ばれた場合だけ、置き換える文書をIDで指定する
        replacesDocumentId: options?.replacesDocumentId ?? null,
      })
        .then((response) => {
          // 202受領＝テキスト抽出が終わり、検索用データの作成へ進んだ時点
          updateJob(jobId, { documentId: response.document_id });
          requestStage(jobId, 'indexing');
          void refreshRef.current();
        })
        .catch((error: unknown) => {
          failJob(
            jobId,
            error instanceof DocumentApiError
              ? error.userMessage
              : 'アップロードに失敗しました。時間をおいてもう一度お試しください。'
          );
        });
    },
    [commitJobs, failJob, requestStage, updateJob]
  );

  /**
   * 文書の削除（F-09）。
   *
   * 削除後は必ず一覧を取り直す。画面側で配列から抜くだけにすると、
   * サーバー側で消えていなかった場合に「消えたように見える」状態になるため。
   */
  const removeDocument = useCallback(async (documentId: string) => {
    await deleteDocument(documentId);
    await refreshRef.current();
  }, []);

  const dismissJob = useCallback(
    (jobId: string) => {
      clearStageTimer(jobId);
      stageTargetsRef.current.delete(jobId);
      commitJobs(jobsRef.current.filter((job) => job.id !== jobId));
    },
    [clearStageTimer, commitJobs]
  );

  // ────────────────────────────────
  // 表示用データの決定
  // ────────────────────────────────

  // 実データが1件でもあればそれを表示する。0件のときだけサンプルへ切り替える
  const isSampleData = USE_SAMPLE_DOCUMENT_FALLBACK && realDocuments.length === 0 && !isLoading;
  const documents = isSampleData ? mockDocuments : realDocuments;

  return {
    documents,
    isLoading,
    errorMessage,
    isSampleData,
    uploadJobs,
    refresh: () => void refreshRef.current(),
    startUpload,
    removeDocument,
    dismissJob,
    filters,
    setFilters,
  };
}
