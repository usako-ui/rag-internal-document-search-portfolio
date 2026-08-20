/**
 * Phase VAL：RAG精度検証（TV-01〜TV-07）
 *
 * `data/case3-test-questions.csv` の12問を実際の POST /api/chat へ順番に投入し、
 * CLAUDE.md セクション6の4観点で評価して記録シート（Markdown）を出力する。
 *
 *  - 検索精度         … 期待した出典文書が検索上位（最大5件）に入っているか
 *  - 回答精度         … 期待される回答の要素（数値・固有名詞）が回答本文に含まれるか
 *  - 出典表示         … 出典が正しく返るか（該当なしの質問では出典を出さないか）
 *  - ハルシネーション … 文書にない情報を根拠なしに断定していないか
 *
 * 検索精度の確認には、APIレスポンスに含まれない「検索で取得したチャンク」が必要なため、
 * 同じ質問で `match_chunks` を直接呼び出して上位チャンクも記録する。
 *
 * 事前に開発サーバーを起動しておくこと：npm run dev -- -p 3002
 * 実行：npm run validate:rag
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createServerClient } from '@supabase/ssr';
import { loadEnv } from './loadEnv';
import { requireEnv } from './loadEnv';
import { createSupabaseAdminClient } from '../src/lib/supabase/admin';
import { generateQueryEmbedding } from '../src/lib/search/queryEmbedding';
import {
  MATCH_COUNT,
  SIMILARITY_THRESHOLD,
  type MatchedChunk,
  searchChunks,
} from '../src/lib/search/searchChunks';

loadEnv();

/** 検証対象の開発サーバー */
const BASE_URL = process.env.VERIFY_BASE_URL ?? 'http://localhost:3002';

/** 評価データ（講座提供の正式な評価データ） */
const CSV_PATH = resolve(process.cwd(), 'data/case3-test-questions.csv');

/** 記録シートの出力先 */
const SHEET_PATH = resolve(process.cwd(), 'docs/validation/rag-evaluation-sheet.md');

/** 文書に記載がない場合の定型文（F-04・ハルシネーション検証の合格条件） */
const NO_ANSWER_MESSAGE = '該当する情報を社内文書から確認できませんでした。';

/**
 * 評価データの文書ID（case3-docN-...）と、DBへ登録した文書名の対応。
 *
 * 評価データはファイル名ベース、DBは日本語の文書名で管理しているため、
 * 検索精度の判定にはこの対応表が必要になる。
 * 文書を追加・改名した場合はここも更新すること。
 */
const DOCUMENT_NAME_BY_SLUG: Record<string, string> = {
  'case3-doc1-employment-rules': '就業規則(抜粋)',
  'case3-doc2-expense-manual': '経費精算マニュアル',
  'case3-doc3-security-policy': '情報セキュリティ規程',
  'case3-doc4-remote-work': 'リモートワーク規程',
  'case3-doc5-it-onboarding': '社内ITツール・アカウント申請ガイド',
};

/**
 * 回答精度の判定基準。
 *
 * `required` … 回答に必ず含まれるべき事実。1つでも欠ければ不合格。
 * `optional` … 含まれていれば望ましいが、質問文が尋ねていないため合否には含めない事実。
 *
 * 内側の配列は表記ゆれの許容リスト（どれか1つ含まれていれば合格）。
 * 期待される回答の文章そのものではなく、**数値・固有名詞といった事実**で判定する。
 * 言い回しの違いで不合格にすると、回答精度ではなく文体を測ることになるため。
 */
const EXPECTED_FACTS: Record<number, { required: string[][]; optional?: string[][] }> = {
  1: { required: [['6ヶ月', '6か月', '6カ月', '6箇月'], ['10日']] },
  2: { required: [['末日', '月末'], ['10日'], ['25日']] },
  3: { required: [['週3日', '3日']] },
  // 質問は「最低文字数と変更頻度」の2点のみを尋ねている。
  // 評価データの期待回答に含まれる「過去3回分と同一は不可」は尋ねられていないため参考扱いとする
  4: { required: [['12文字'], ['90日']], optional: [['3回']] },
  5: { required: [['3000円']] },
  6: { required: [['5000円'], ['部門長']] },
  7: { required: [['情報システム部'], ['30分']] },
  8: { required: [['11:00', '11時'], ['15:00', '15時']] },
  9: { required: [['2営業日']] },
  10: { required: [['45時間'], ['360時間']] },
  // 11・12は「該当なし」の定型文が返ることが正解のため、事実の一致は判定しない
};

/**
 * 質問1件ごとの待機時間（ミリ秒）。
 *
 * Gemini APIの無料枠は gemini-2.5-flash の生成リクエストが**毎分5回**までのため、
 * 連続投入すると429（RESOURCE_EXHAUSTED）で検証が成立しない。
 * 毎分4回に抑えて確実に全12問を測定する。
 */
const REQUEST_INTERVAL_MS = 15_000;

/** 429で失敗したときの再試行回数と待機時間 */
const RETRY_COUNT = 2;
const RETRY_WAIT_MS = 60_000;

/** 指定ミリ秒待つ */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 評価データ1行分 */
type TestQuestion = {
  no: number;
  question: string;
  expectedAnswer: string;
  /** 期待される出典文書名（DB上の名称）。該当なしの質問では空配列 */
  expectedDocuments: string[];
  expectedSection: string;
  /** 文書に記載がある質問か（false＝ハルシネーション検証用） */
  inScope: boolean;
};

/** APIレスポンス（requirements.md セクション7） */
type ChatResponse = {
  answer?: string;
  citations?: { document_name: string; page: string | null; section: string | null; document_id: string }[];
  has_answer?: boolean;
  error?: string;
};

/** 4観点の評価結果 */
type Evaluation = {
  retrieval: boolean;
  answer: boolean;
  citation: boolean;
  hallucination: boolean;
  /** 判定理由（不合格時に何を見るべきか分かるようにする） */
  notes: string[];
};

/** 1問分の検証結果 */
type Result = {
  test: TestQuestion;
  status: number;
  response: ChatResponse;
  chunks: MatchedChunk[];
  evaluation: Evaluation;
};

/**
 * 評価データCSVを読み込む。
 *
 * 【注意】このCSVは「月額3,000円」のように、引用符で囲まれていない値の中に
 * カンマが含まれる行がある（そのまま split すると列がずれる）。
 * 先頭2列（番号・質問）と末尾3列（出典文書・出典セクション・種別）には
 * カンマが含まれないため、両端から確定させ、残りを期待回答として結合する。
 */
function loadTestQuestions(): TestQuestion[] {
  const lines = readFileSync(CSV_PATH, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  // 1行目はヘッダー
  return lines.slice(1).map((line) => {
    const fields = line.split(',');

    if (fields.length < 6) {
      throw new Error(`評価データの列数が不足しています: ${line}`);
    }

    const no = Number(fields[0]);
    const question = fields[1];
    const kind = fields[fields.length - 1];
    const expectedSection = fields[fields.length - 2];
    const documentField = fields[fields.length - 3];
    const expectedAnswer = fields.slice(2, fields.length - 3).join(',');

    const inScope = kind.startsWith('該当あり');

    // 「case3-doc2-... / case3-doc4-...」のように複数文書が指定される場合がある
    const expectedDocuments = inScope
      ? documentField
          .split('/')
          .map((slug) => slug.trim())
          .map((slug) => {
            const name = DOCUMENT_NAME_BY_SLUG[slug];
            if (!name) {
              throw new Error(`対応表にない出典文書です: ${slug}（DOCUMENT_NAME_BY_SLUG を更新してください）`);
            }
            return name;
          })
      : [];

    return { no, question, expectedAnswer, expectedDocuments, expectedSection, inScope };
  });
}

/**
 * 表記ゆれを吸収するための正規化。
 *
 * 全角・半角（NFKC）、カンマ区切りの数値（3,000円 → 3000円）、
 * 空白を取り除いてから比較する。これをしないと正解でも不合格と判定されてしまう。
 */
function normalizeForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[,、]/g, '')
    .replace(/\s+/g, '');
}

/**
 * 検証用ユーザーでログインし、ブラウザが持つのと同じ形のCookieを組み立てる。
 * Cookieの分割・エンコードは @supabase/ssr に任せる（自前で作ると形式ズレで動かない）。
 */
async function signInAndBuildCookie(): Promise<string> {
  const email = requireEnv('TEST_USER_EMAIL');
  const password = requireEnv('TEST_USER_PASSWORD');
  const jar: Record<string, string> = {};

  const supabase = createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll: () => Object.entries(jar).map(([name, value]) => ({ name, value })),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => {
            jar[name] = value;
          });
        },
      },
    }
  );

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`検証用ユーザーのログインに失敗しました: ${error.message}`);

  return Object.entries(jar)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
}

/** /api/chat へ質問を投げる */
async function postChat(question: string, cookieHeader: string): Promise<{ status: number; json: ChatResponse }> {
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
    body: JSON.stringify({ question }),
  });

  const json = (await response.json().catch(() => ({}))) as ChatResponse;
  return { status: response.status, json };
}

/**
 * /api/chat へ質問を投げ、502（Gemini側の一時エラー・レート制限）なら待って再試行する。
 *
 * レート制限による失敗を「回答精度が低い」と誤って記録しないための処置。
 * 精度の測定結果とAPI側の一時障害を混ぜないこと。
 */
async function postChatWithRetry(
  question: string,
  cookieHeader: string
): Promise<{ status: number; json: ChatResponse }> {
  let result = await postChat(question, cookieHeader);

  for (let attempt = 1; attempt <= RETRY_COUNT && result.status === 502; attempt += 1) {
    console.log(`  502のため${RETRY_WAIT_MS / 1000}秒待って再試行します（${attempt}/${RETRY_COUNT}）`);
    await sleep(RETRY_WAIT_MS);
    result = await postChat(question, cookieHeader);
  }

  return result;
}

/**
 * 4観点で1問を評価する（CLAUDE.md セクション6）。
 */
function evaluate(test: TestQuestion, response: ChatResponse, chunks: MatchedChunk[]): Evaluation {
  const notes: string[] = [];
  const answer = response.answer ?? '';
  const citations = response.citations ?? [];
  const retrievedNames = new Set(chunks.map((chunk) => chunk.document_name));
  const citedNames = new Set(citations.map((citation) => citation.document_name));

  // ------------------------------------------------------------
  // 観点1：検索精度
  //  記載あり → 期待した文書が検索上位に入っていること
  //  記載なし → 閾値を超えるチャンクが0件であること
  // ------------------------------------------------------------
  let retrieval: boolean;

  if (test.inScope) {
    const missing = test.expectedDocuments.filter((name) => !retrievedNames.has(name));
    retrieval = missing.length === 0;
    if (!retrieval) notes.push(`検索: 期待文書が上位${MATCH_COUNT}件に無い（${missing.join(' / ')}）`);
  } else {
    // 文書に記載がない質問では、閾値を超えるチャンクが0件であることが設計上の期待。
    // 0件でなくても回答生成側（Geminiのプロンプト）が「該当なし」と判断すれば
    // 利用者には正しい応答が返るが、検索段階では取りこぼしとして記録する
    retrieval = chunks.length === 0;
    if (!retrieval) {
      const top = chunks[0];
      notes.push(
        `検索: 文書外の質問で${chunks.length}件ヒット（最高 ${top.similarity.toFixed(3)} / ${top.document_name}）。閾値${SIMILARITY_THRESHOLD}では弾けていない`
      );
    }
  }

  // ------------------------------------------------------------
  // 観点2：回答精度
  //  記載あり → 期待される回答の事実（数値・固有名詞）が含まれること
  //  記載なし → 定型文が返ること
  // ------------------------------------------------------------
  let answerOk: boolean;

  if (test.inScope) {
    const normalizedAnswer = normalizeForMatch(answer);
    const facts = EXPECTED_FACTS[test.no] ?? { required: [] };

    /** 回答に含まれていない事実を抜き出す */
    const findMissing = (groups: string[][]) =>
      groups.filter(
        (variants) => !variants.some((variant) => normalizedAnswer.includes(normalizeForMatch(variant)))
      );

    const missingRequired = findMissing(facts.required);
    const missingOptional = findMissing(facts.optional ?? []);

    answerOk = response.has_answer === true && missingRequired.length === 0;

    if (response.has_answer !== true) notes.push('回答: has_answer が false（回答できていない）');
    if (missingRequired.length > 0) {
      notes.push(`回答: 必須要素が不足（${missingRequired.map((variants) => variants[0]).join(' / ')}）`);
    }
    if (missingOptional.length > 0) {
      notes.push(
        `参考: 質問されていない補足情報は回答に含まれていない（${missingOptional.map((variants) => variants[0]).join(' / ')}）※合否には含めない`
      );
    }
  } else {
    answerOk = answer === NO_ANSWER_MESSAGE && response.has_answer === false;
    if (!answerOk) notes.push('回答: 文書外の質問に定型文を返していない');
  }

  // ------------------------------------------------------------
  // 観点3：出典表示
  //  記載あり → 出典が1件以上あり、期待した文書を含み、文書名が入っていること
  //  記載なし → 出典が空であること（空の出典ラベルを出さない：CLAUDE.md セクション10）
  // ------------------------------------------------------------
  let citation: boolean;

  if (test.inScope) {
    const missingCitations = test.expectedDocuments.filter((name) => !citedNames.has(name));
    const wellFormed = citations.every((item) => Boolean(item.document_name) && Boolean(item.document_id));

    citation = citations.length > 0 && missingCitations.length === 0 && wellFormed;

    if (citations.length === 0) notes.push('出典: 出典が0件');
    else if (missingCitations.length > 0) notes.push(`出典: 期待文書が出典に無い（${missingCitations.join(' / ')}）`);
    if (!wellFormed) notes.push('出典: 文書名またはdocument_idが欠けている');
  } else {
    citation = citations.length === 0;
    if (!citation) notes.push('出典: 文書外の質問で出典を表示している');
  }

  // ------------------------------------------------------------
  // 観点4：ハルシネーション
  //  「根拠なしに断定していないか」を機械的に判定できる範囲で確認する。
  //   - 記載なし → 定型文以外を返していないこと（最重要）
  //   - 記載あり → 回答したなら必ず出典があり、出典が検索結果の文書に限られること
  //     （検索していない文書名を出典に出す＝根拠の捏造）
  // ------------------------------------------------------------
  let hallucination: boolean;

  if (!test.inScope) {
    hallucination = answer === NO_ANSWER_MESSAGE && citations.length === 0;
    if (!hallucination) notes.push('ハルシネーション: 文書に無い内容へ回答している');
  } else {
    const fabricated = citations.filter((item) => !retrievedNames.has(item.document_name));
    const answeredWithoutCitation = response.has_answer === true && citations.length === 0;

    hallucination = fabricated.length === 0 && !answeredWithoutCitation;

    if (fabricated.length > 0) {
      notes.push(`ハルシネーション: 検索結果に無い文書を出典にしている（${fabricated.map((item) => item.document_name).join(' / ')}）`);
    }
    if (answeredWithoutCitation) notes.push('ハルシネーション: 出典なしで断定回答している');
  }

  return { retrieval, answer: answerOk, citation, hallucination, notes };
}

/** 合否記号（絵文字はCLAUDE.md セクション8で禁止のため使わない） */
function mark(ok: boolean): string {
  return ok ? 'OK' : 'NG';
}

/** 記録シート（Markdown）を組み立てる */
function buildSheet(results: Result[]): string {
  const inScope = results.filter((result) => result.test.inScope);
  const outOfScope = results.filter((result) => !result.test.inScope);

  /** 観点ごとの正答率を出す */
  const rate = (list: Result[], pick: (evaluation: Evaluation) => boolean) => {
    if (list.length === 0) return { passed: 0, total: 0, percent: 0 };
    const passed = list.filter((result) => pick(result.evaluation)).length;
    return { passed, total: list.length, percent: Math.round((passed / list.length) * 1000) / 10 };
  };

  // 評価目標（80%）は「文書に記載された内容への正答率」なので、記載ありの10問で判定する
  const answerRate = rate(inScope, (evaluation) => evaluation.answer);
  const retrievalRate = rate(inScope, (evaluation) => evaluation.retrieval);
  const citationRate = rate(results, (evaluation) => evaluation.citation);
  const hallucinationRate = rate(results, (evaluation) => evaluation.hallucination);

  const lines: string[] = [];

  lines.push('# RAG精度検証 記録シート（Phase VAL / TV-02〜TV-07）');
  lines.push('');
  lines.push('> このファイルは `npm run validate:rag` が自動生成します。手で編集しても再実行で上書きされます。');
  lines.push('');
  lines.push('## 検証条件');
  lines.push('');
  lines.push('| 項目 | 値 |');
  lines.push('|---|---|');
  lines.push(`| 実施日時 | ${new Date().toLocaleString('ja-JP')} |`);
  lines.push('| 評価データ | `data/case3-test-questions.csv`（12問） |');
  lines.push('| 検証経路 | POST /api/chat（ログイン済みユーザーのCookieを付与） |');
  lines.push(`| 類似度の閾値 | ${SIMILARITY_THRESHOLD} |`);
  lines.push(`| 取得チャンク数の上限 | ${MATCH_COUNT} |`);
  lines.push('| 生成モデル | gemini-2.5-flash |');
  lines.push(`| 投入間隔 | ${REQUEST_INTERVAL_MS / 1000}秒（Gemini無料枠の毎分5リクエスト制限に対応） |`);
  lines.push('');

  // API側の失敗が残っている状態の数値は精度として読めないため、シート冒頭で警告する
  const failedRequests = results.filter((result) => result.status !== 200);
  if (failedRequests.length > 0) {
    lines.push(
      `> **注意**：${failedRequests.length}問でAPIがエラーを返しています（Q${failedRequests.map((result) => result.test.no).join(', Q')}）。` +
        'この結果はRAGの精度ではなくAPI側の失敗を含むため、原因を解消してから再測定してください。'
    );
    lines.push('');
  }

  lines.push('## 集計（4観点）');
  lines.push('');
  lines.push('| 観点 | 母数 | 合格 | 正答率 | 判定 |');
  lines.push('|---|---|---|---|---|');
  lines.push(`| 検索精度（記載あり10問） | ${retrievalRate.total} | ${retrievalRate.passed} | ${retrievalRate.percent}% | ${mark(retrievalRate.percent >= 80)} |`);
  lines.push(`| 回答精度（記載あり10問・評価目標80%） | ${answerRate.total} | ${answerRate.passed} | ${answerRate.percent}% | ${mark(answerRate.percent >= 80)} |`);
  lines.push(`| 出典表示（全12問） | ${citationRate.total} | ${citationRate.passed} | ${citationRate.percent}% | ${mark(citationRate.percent >= 80)} |`);
  lines.push(`| ハルシネーション（全12問） | ${hallucinationRate.total} | ${hallucinationRate.passed} | ${hallucinationRate.percent}% | ${mark(hallucinationRate.percent >= 80)} |`);
  lines.push('');
  lines.push(`文書外の質問（${outOfScope.length}問）で定型文を返せた数：${outOfScope.filter((result) => result.evaluation.hallucination).length} / ${outOfScope.length}`);
  lines.push('');

  lines.push('## 一覧');
  lines.push('');
  lines.push('| No | 種別 | 質問 | 検索精度 | 回答精度 | 出典表示 | ハルシネーション |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const result of results) {
    const { test, evaluation } = result;
    lines.push(
      `| ${test.no} | ${test.inScope ? '該当あり' : '該当なし'} | ${test.question} | ${mark(evaluation.retrieval)} | ${mark(evaluation.answer)} | ${mark(evaluation.citation)} | ${mark(evaluation.hallucination)} |`
    );
  }
  lines.push('');

  lines.push('## 各問の記録');
  lines.push('');

  for (const result of results) {
    const { test, response, chunks, evaluation } = result;

    lines.push(`### Q${test.no}. ${test.question}`);
    lines.push('');
    lines.push(`- 種別：${test.inScope ? '該当あり' : '該当なし（ハルシネーション検証）'}`);
    lines.push(`- 期待される回答：${test.expectedAnswer}`);
    lines.push(`- 期待される出典：${test.inScope ? `${test.expectedDocuments.join(' / ')}（${test.expectedSection}）` : '出典なし'}`);
    lines.push(`- HTTPステータス：${result.status} / has_answer：${response.has_answer}`);
    lines.push('');
    lines.push('**AIの回答**');
    lines.push('');
    lines.push('```');
    lines.push(response.answer ?? response.error ?? '(応答なし)');
    lines.push('```');
    lines.push('');

    lines.push('**返した出典**');
    lines.push('');
    if ((response.citations ?? []).length === 0) {
      lines.push('- なし');
    } else {
      for (const citation of response.citations ?? []) {
        lines.push(`- ${citation.document_name}（${citation.page ?? 'ページ不明'} / ${citation.section ?? '見出しなし'}）`);
      }
    }
    lines.push('');

    lines.push(`**検索で取得したチャンク（上位${MATCH_COUNT}件・閾値${SIMILARITY_THRESHOLD}）**`);
    lines.push('');
    if (chunks.length === 0) {
      lines.push('- なし（閾値を超えるチャンクなし）');
    } else {
      lines.push('| 順位 | 類似度 | 文書名 | 参照箇所 |');
      lines.push('|---|---|---|---|');
      chunks.forEach((chunk, index) => {
        lines.push(
          `| ${index + 1} | ${chunk.similarity.toFixed(3)} | ${chunk.document_name} | ${chunk.section ?? '見出しなし'}${chunk.page_number !== null ? ` / p.${chunk.page_number}` : ''} |`
        );
      });
    }
    lines.push('');

    lines.push(
      `**評価**：検索精度 ${mark(evaluation.retrieval)} / 回答精度 ${mark(evaluation.answer)} / 出典表示 ${mark(evaluation.citation)} / ハルシネーション ${mark(evaluation.hallucination)}`
    );
    if (evaluation.notes.length > 0) {
      lines.push('');
      for (const note of evaluation.notes) lines.push(`- ${note}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function main() {
  // 開発サーバーが起動しているか先に確認する（起動忘れの切り分けを早くするため）
  try {
    await fetch(BASE_URL, { method: 'HEAD' });
  } catch {
    throw new Error(
      `開発サーバーへ接続できません（${BASE_URL}）。別ターミナルで npm run dev -- -p 3002 を実行してください。`
    );
  }

  const tests = loadTestQuestions();
  const admin = createSupabaseAdminClient();
  const cookieHeader = await signInAndBuildCookie();

  console.log(`評価データ: ${tests.length}問（該当あり ${tests.filter((t) => t.inScope).length}問 / 該当なし ${tests.filter((t) => !t.inScope).length}問）`);
  console.log(`検証対象: ${BASE_URL} / 閾値 ${SIMILARITY_THRESHOLD} / 最大${MATCH_COUNT}件`);
  console.log('='.repeat(96));

  console.log(`Gemini無料枠（毎分5リクエスト）に合わせ、1問ごとに${REQUEST_INTERVAL_MS / 1000}秒空けます。所要約${Math.ceil((tests.length * REQUEST_INTERVAL_MS) / 60000)}分。`);

  const results: Result[] = [];

  for (let index = 0; index < tests.length; index += 1) {
    const test = tests[index];

    // レート制限による429を避けるため、2問目以降は間隔を空ける
    if (index > 0) await sleep(REQUEST_INTERVAL_MS);

    // 検索精度の確認用に、同じ質問で検索処理を直接実行して取得チャンクを記録する
    const queryEmbedding = await generateQueryEmbedding(test.question);
    const chunks = await searchChunks(admin, queryEmbedding);

    const { status, json } = await postChatWithRetry(test.question, cookieHeader);
    const evaluation = evaluate(test, json, chunks);

    results.push({ test, status, response: json, chunks, evaluation });

    console.log('');
    console.log(`Q${test.no}. ${test.question}`);
    console.log(
      `  検索 ${mark(evaluation.retrieval)} / 回答 ${mark(evaluation.answer)} / 出典 ${mark(evaluation.citation)} / ハルシネーション ${mark(evaluation.hallucination)}`
    );
    console.log(`  A. ${(json.answer ?? json.error ?? '(応答なし)').replace(/\n/g, ' ')}`);
    for (const note of evaluation.notes) console.log(`  -> ${note}`);
  }

  const sheet = buildSheet(results);
  mkdirSync(dirname(SHEET_PATH), { recursive: true });
  writeFileSync(SHEET_PATH, sheet, 'utf8');

  // 評価目標は「文書に記載された内容への正答率80%以上」なので記載あり10問で判定する
  const inScope = results.filter((result) => result.test.inScope);
  const answerPassed = inScope.filter((result) => result.evaluation.answer).length;
  const percent = Math.round((answerPassed / inScope.length) * 1000) / 10;

  console.log('');
  console.log('='.repeat(96));
  console.log(`回答精度（記載あり${inScope.length}問）: ${answerPassed}件正解 / ${percent}%  目標80% → ${percent >= 80 ? '達成' : '未達'}`);
  console.log(`記録シート: ${SHEET_PATH}`);

  if (percent < 80) process.exit(1);
}

main().catch((error) => {
  console.error('精度検証に失敗しました:', error instanceof Error ? error.message : error);
  process.exit(1);
});
