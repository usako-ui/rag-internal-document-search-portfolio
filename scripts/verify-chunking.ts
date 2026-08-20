/**
 * チャンキング処理の検証スクリプト（TA-03）
 *
 * 実PDFがまだ無い（tasks.md Q-12）ため、日本語の規程文を直接与えて
 * チャンク分割が意図通り動くかを確認する。
 * PDFを介さずに検証できるので、日本語での分割挙動はここで担保する。
 *
 * 実行：npm run verify:chunking
 */

import { DEFAULT_CHUNK_OPTIONS, chunkDocument, estimateTokens } from '../src/lib/pdf/chunkText';
import type { ExtractedDocument } from '../src/lib/pdf/extractText';

/** 社内規程を模した日本語のサンプル文書（2ページ構成） */
const SAMPLE_DOCUMENT: ExtractedDocument = {
  pageCount: 2,
  pages: [
    {
      pageNumber: 3,
      text: [
        '第3条（在宅勤務手当）',
        '在宅勤務を行う社員に対し、在宅勤務手当として月額5,000円を支給する。支給対象は、週2日以上の在宅勤務を行う社員とする。',
        '手当は毎月の給与と併せて支給し、在宅勤務日数が月8日に満たない場合は日割りで計算する。',
        '',
        '第4条（勤務時間）',
        '所定労働時間は1日8時間とし、始業時刻は9時00分、終業時刻は18時00分とする。休憩時間は12時00分から13時00分までの1時間とする。',
        '在宅勤務の場合も所定労働時間は同一とし、始業および終業の時刻を勤怠システムへ記録しなければならない。',
        '第5条（時間外労働）',
        '業務上必要がある場合は、所定労働時間を超えて労働させることがある。時間外労働を行う場合は、事前に所属長の承認を得なければならない。',
      ].join('\n'),
    },
    {
      pageNumber: 12,
      text: [
        '4.2.3 在宅勤務に係る費用の精算',
        '在宅勤務手当は経費精算の対象外とし、給与として支給する。通信費および光熱費は在宅勤務手当に含まれるものとする。',
        '業務上必要な備品を購入した場合は、事前に所属長の承認を得たうえで経費精算を行うこと。申請期限は購入日の翌月10日までとする。',
        '領収書は電子データで保管し、経費精算システムへ添付すること。原本の提出は不要である。',
      ].join('\n'),
    },
    {
      // 目標トークン数を大きく超えるページ。複数チャンクへの分割とオーバーラップを確認する
      pageNumber: 20,
      text: [
        '第10条（年次有給休暇）',
        '入社後6か月を経過し、全労働日の8割以上出勤した社員に対して10日の年次有給休暇を付与する。',
        '年次有給休暇は、勤続年数に応じて付与日数を増加させ、最大20日を上限とする。',
        '年次有給休暇の請求は、原則として取得予定日の3営業日前までに勤怠システムへ申請しなければならない。',
        '事業の正常な運営を妨げる場合に限り、会社は取得時季の変更を求めることができる。',
        '年次有給休暇は、付与日から2年間に限り繰り越すことができる。',
        '第11条（特別休暇）',
        '社員は、慶弔その他の事由により特別休暇を取得することができる。',
        '本人の結婚の場合は5日、配偶者の出産の場合は2日の特別休暇を付与する。',
        '父母、配偶者または子が死亡した場合は5日、祖父母または兄弟姉妹が死亡した場合は3日を付与する。',
        '特別休暇を取得する場合は、事由を証明する書類を所属長へ提出しなければならない。',
        '第12条（育児休業）',
        '育児休業の取得については、育児介護休業法および別途定める育児介護休業規程による。',
        '育児休業を希望する社員は、休業開始予定日の1か月前までに所属長へ申し出るものとする。',
        '第13条（欠勤）',
        '傷病その他やむを得ない事由により欠勤する場合は、あらかじめ所属長へ届け出なければならない。',
        '連続して3日以上欠勤する場合は、医師の診断書を提出しなければならない。',
      ].join('\n'),
    },
  ],
  fullText: '',
};

function main() {
  console.log('チャンキング設定:', DEFAULT_CHUNK_OPTIONS);
  console.log('');

  const chunks = chunkDocument(SAMPLE_DOCUMENT);

  console.log(`入力: ${SAMPLE_DOCUMENT.pages.length}ページ`);
  for (const page of SAMPLE_DOCUMENT.pages) {
    console.log(`  p.${page.pageNumber}: ${page.text.length}字 / 約${estimateTokens(page.text)}トークン`);
  }
  console.log('');
  console.log(`出力: ${chunks.length}チャンク`);
  console.log('='.repeat(70));

  for (const chunk of chunks) {
    console.log('');
    console.log(
      `[${chunk.chunkIndex}] p.${chunk.pageNumber} / ${chunk.charCount}字 / 約${chunk.estimatedTokens}トークン`
    );
    console.log(chunk.content);
  }

  console.log('');
  console.log('='.repeat(70));
  console.log('検証結果');

  // 1. すべてのチャンクがページ番号を持つか（出典表示に必須）
  const hasPageNumbers = chunks.every((chunk) => chunk.pageNumber > 0);
  console.log(`  ページ番号の保持      : ${hasPageNumbers ? 'OK' : 'NG'}`);

  // 2. 上限トークンを超えていないか
  const withinMax = chunks.every((chunk) => chunk.estimatedTokens <= DEFAULT_CHUNK_OPTIONS.maxTokens);
  console.log(`  上限トークン以内      : ${withinMax ? 'OK' : 'NG'}`);

  // 3. chunk_index が0から連番になっているか（DBのユニーク制約に対応）
  const isSequential = chunks.every((chunk, index) => chunk.chunkIndex === index);
  console.log(`  chunk_indexが連番     : ${isSequential ? 'OK' : 'NG'}`);

  // 4. 文の途中で切れていないか（句点・記号で終わっているか）
  const endsProperly = chunks.every((chunk) => /[。！？!?」』）\)]$/.test(chunk.content.trim()));
  console.log(`  文の途中で切れていない: ${endsProperly ? 'OK' : '一部あり（長文の強制分割）'}`);

  // 5. ページをまたいでいないか（1チャンク＝1ページであること）
  const pagesPerChunk = Array.from(new Set(chunks.map((chunk) => chunk.pageNumber)));
  console.log(`  使用ページ            : ${pagesPerChunk.map((p) => `p.${p}`).join(', ')}`);

  // 6. 見出しが正しく設定されているか（出典の参照箇所に使うため）
  const headings = chunks.map((chunk) => chunk.heading);
  console.log(`  見出しの割当          : ${headings.filter(Boolean).length}/${chunks.length}件`);
  for (const chunk of chunks) {
    // チャンク本文の先頭が、割り当てられた見出しと一致していることを確認する
    if (chunk.heading && !chunk.content.startsWith(chunk.heading)) {
      console.log(`    NG: [${chunk.chunkIndex}] 見出し「${chunk.heading}」が本文先頭にない`);
    }
  }

  // 7. 同一セクション内が複数チャンクに分かれた場合、オーバーラップが効いているか
  //    セクションをまたぐオーバーラップは出典の見出しがずれるため意図的に行わない
  let overlapChecked = false;
  let overlapWorking = true;

  for (let i = 1; i < chunks.length; i += 1) {
    if (chunks[i].pageNumber !== chunks[i - 1].pageNumber) continue;
    // 見出しが変わる箇所は別セクションなのでオーバーラップの対象外
    if (chunks[i].heading !== chunks[i - 1].heading) continue;

    overlapChecked = true;
    // 前チャンクの末尾30文字が次チャンクの先頭付近に現れるかで判定する
    const tail = chunks[i - 1].content.trim().slice(-30);
    if (!chunks[i].content.includes(tail)) {
      overlapWorking = false;
    }
  }

  console.log(
    `  オーバーラップ        : ${
      overlapChecked ? (overlapWorking ? 'OK' : 'NG') : '未検証（分割が発生しなかった）'
    }`
  );

  if (!hasPageNumbers || !withinMax || !isSequential || (overlapChecked && !overlapWorking)) {
    process.exit(1);
  }
}

main();
