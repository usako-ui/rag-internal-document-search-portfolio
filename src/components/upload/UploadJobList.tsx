'use client';

import styles from './UploadJobList.module.css';
import {
  UPLOAD_STAGE_LABEL,
  UPLOAD_STAGE_ORDER,
  UPLOAD_STAGE_PROGRESS,
  isUploadJobFinished,
  type UploadJob,
} from '@/types/upload';
import {
  AlertCircleIcon,
  CheckCircleIcon,
  FileIcon,
  LoaderIcon,
  XIcon,
} from '@/components/icons';

/**
 * アップロード処理状況の段階表示（TC-14・TC-15 / 要件F-07）
 *
 * 「アップロード済み → テキスト抽出中 → 検索用データを作成中 → 検索可能」を
 * 常に見える形で表示する。処理中に「今何をしているか分からない」状態を作らないため、
 * 現在の段階名・進行バー・残りの段階をすべて出す。
 *
 * アップロードパネル（右カラム）と文書一覧画面の両方から使う共通部品。
 */

/** 段階表示で見せるステップ（送信中は「アップロード済み」に含めて4段階で見せる） */
const VISIBLE_STAGES = UPLOAD_STAGE_ORDER.filter((stage) => stage !== 'uploading');

type UploadJobListProps = {
  jobs: UploadJob[];
  /** 表示を閉じる（完了・失敗したジョブのみ閉じられる） */
  onDismiss: (jobId: string) => void;
  /** 見出しを表示するか。パネル内では見出しが重複するため省ける */
  showHeading?: boolean;
};

export function UploadJobList({ jobs, onDismiss, showHeading = true }: UploadJobListProps) {
  if (jobs.length === 0) return null;

  return (
    <div className={styles.wrapper}>
      {showHeading && <div className={styles.heading}>処理状況</div>}

      {jobs.map((job) => {
        const isError = job.stage === 'error';
        const isReady = job.stage === 'ready';
        const isFinished = isUploadJobFinished(job);

        // 送信中のみ実際の送信進捗を使い、それ以降は段階に応じた位置を示す
        const percent =
          job.stage === 'uploading'
            ? Math.max(UPLOAD_STAGE_PROGRESS.uploading, Math.round(job.progress * 0.35))
            : UPLOAD_STAGE_PROGRESS[job.stage];

        return (
          <div
            key={job.id}
            className={`${styles.job} ${isError ? styles.jobError : ''}`}
            // 段階が変わったことを支援技術にも伝える
            aria-live="polite"
          >
            <div className={styles.jobHeader}>
              <span className={styles.pdfIcon}>
                <FileIcon size={14} />
              </span>

              <span className={styles.jobName} title={job.fileName}>
                {job.fileName}
              </span>

              {isFinished && (
                <button
                  type="button"
                  className={styles.dismissButton}
                  onClick={() => onDismiss(job.id)}
                  aria-label={`${job.fileName} の表示を閉じる`}
                >
                  <XIcon size={13} />
                </button>
              )}
            </div>

            {/* 資料更新（F-08）から始まったジョブは対象文書を明示する */}
            {job.replacesDocumentName && (
              <div className={styles.replaceNote}>更新対象：{job.replacesDocumentName}</div>
            )}

            {isError ? (
              // エラーは原因と次の行動が分かる文言をそのまま出す（F-07・TC-15）
              <div className={styles.errorBox} role="alert">
                <span className={styles.errorIcon}>
                  <AlertCircleIcon size={13} strokeWidth={2.2} />
                </span>
                <span>{job.errorMessage ?? 'アップロードに失敗しました。'}</span>
              </div>
            ) : (
              <>
                <div className={styles.currentStage}>
                  <span className={isReady ? styles.stageIconReady : styles.stageIconRunning}>
                    {isReady ? <CheckCircleIcon size={13} /> : <LoaderIcon size={13} />}
                  </span>
                  {UPLOAD_STAGE_LABEL[job.stage]}
                  {job.stage === 'uploading' && `（${job.progress}%）`}
                </div>

                <div
                  className={styles.progressTrack}
                  role="progressbar"
                  aria-valuenow={percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${job.fileName} の処理状況：${UPLOAD_STAGE_LABEL[job.stage]}`}
                >
                  <div
                    className={isReady ? styles.progressBarReady : styles.progressBar}
                    style={{ width: `${percent}%` }}
                  />
                </div>

                {/* 4段階すべてを常に見せ、あと何が残っているかを分かるようにする */}
                <ol className={styles.steps}>
                  {VISIBLE_STAGES.map((stage) => {
                    const stageIndex = UPLOAD_STAGE_ORDER.indexOf(stage);
                    const currentIndex = UPLOAD_STAGE_ORDER.indexOf(job.stage);
                    const isDone = currentIndex > stageIndex;
                    const isCurrent = currentIndex === stageIndex;

                    return (
                      <li
                        key={stage}
                        className={`${styles.step} ${isDone ? styles.stepDone : ''} ${
                          isCurrent ? styles.stepCurrent : ''
                        }`}
                        aria-current={isCurrent ? 'step' : undefined}
                      >
                        {UPLOAD_STAGE_LABEL[stage]}
                      </li>
                    );
                  })}
                </ol>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
