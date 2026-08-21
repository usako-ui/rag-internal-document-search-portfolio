/**
 * 簡易レート制限（納品フェーズ QAレビュー）
 *
 * 同一利用者からの短時間の連続リクエストを制限する。
 *
 * 【なぜ必要か】
 * Gemini APIの無料枠は毎分5回程度で、1人が連続して質問すると
 * その分だけ他の社員が「APIの利用制限に達しました」に遭遇する。
 * 全社員が使えなくなる前に、その1人へ先に制限を返して原因を分かりやすくする。
 *
 * 【インメモリで十分と判断した理由】
 * 目的はGemini無料枠の使い切りを緩和することであり、
 * 認証を突破した攻撃者を止めることではない（/api/chat は認証済み社員のみが到達できる）。
 * Redis等の外部ストアを持ち込むと運用対象が増えるため、MVPではプロセス内で完結させる。
 *
 * 【この方式の限界（重要）】
 * Vercelのサーバーレス環境では実行インスタンスが複数に分かれることがあり、
 * カウントはインスタンスごとに独立する。
 * つまり実際の上限は「毎分5回 × インスタンス数」まで緩む可能性がある。
 * 厳密な制限が必要になった場合は、Upstash Redis等の共有ストアへ移すこと。
 */

/** 集計する時間の幅（ミリ秒）。1分間 */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * 時間幅あたりの許可リクエスト数。
 * Gemini無料枠の毎分5回に合わせる（これを超えると、どのみちGemini側で429になる）。
 */
export const RATE_LIMIT_MAX_REQUESTS = 5;

/** 利用者ごとのリクエスト時刻（ミリ秒）を保持する */
const requestLog = new Map<string, number[]>();

/**
 * 使われなくなったキーを捨てる際の閾値。
 * 上限を超えたときだけ掃除するため、通常のリクエストに負荷をかけない
 */
const CLEANUP_THRESHOLD = 1000;

/** 判定結果 */
export type RateLimitResult = {
  /** 許可する場合は true */
  allowed: boolean;
  /** 制限中の場合、次に試せるようになるまでの秒数（Retry-Afterヘッダーに使う） */
  retryAfterSeconds: number;
};

/**
 * 時間幅から外れた古い記録を捨てる。
 * 残したままだとメモリが増え続け、判定にも古い回数が混ざる
 */
function pruneTimestamps(timestamps: number[], now: number): number[] {
  return timestamps.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
}

/**
 * Mapが肥大化しないよう、記録が空になったキーを削除する。
 *
 * リクエストのたびに全件を走査すると遅くなるため、
 * キー数が閾値を超えたときだけ実行する。
 */
function cleanupIfNeeded(now: number): void {
  if (requestLog.size < CLEANUP_THRESHOLD) return;

  // Mapを直接 for...of で回すと、tsconfig の target 設定（downlevelIteration）に依存する。
  // プロジェクト全体の設定を変えずに済むよう forEach を使う。
  // 走査中に delete すると挙動が分かりにくいため、削除対象を集めてから消す
  const staleKeys: string[] = [];

  requestLog.forEach((timestamps, key) => {
    if (pruneTimestamps(timestamps, now).length === 0) {
      staleKeys.push(key);
    }
  });

  staleKeys.forEach((key) => requestLog.delete(key));
}

/**
 * 1回分のリクエストを記録し、上限を超えていないか判定する。
 *
 * 【重要】許可した場合のみ記録する。
 * 拒否したリクエストまで記録すると、連打している間ずっと時間幅が更新され、
 * 待っても解除されない状態になる。
 *
 * @param key 利用者を識別する値。**必ずサーバー側で確定したユーザーIDを使うこと**
 *            （リクエストボディやヘッダーの値を使うと、詐称して制限を回避できる）
 * @param now 現在時刻。テストから固定値を渡せるようにしている
 */
export function checkRateLimit(key: string, now: number = Date.now()): RateLimitResult {
  const timestamps = pruneTimestamps(requestLog.get(key) ?? [], now);

  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    // 最も古い記録が時間幅から外れるまで待てば、また1回分の空きができる
    const oldest = timestamps[0];
    const waitMs = RATE_LIMIT_WINDOW_MS - (now - oldest);

    requestLog.set(key, timestamps);

    return {
      allowed: false,
      // 0秒と返すと即座に再試行されてしまうため、最低1秒は待たせる
      retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)),
    };
  }

  timestamps.push(now);
  requestLog.set(key, timestamps);
  cleanupIfNeeded(now);

  return { allowed: true, retryAfterSeconds: 0 };
}

/** テスト・検証スクリプトから記録を初期化する */
export function resetRateLimit(): void {
  requestLog.clear();
}
