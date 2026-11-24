import { Fragment } from 'react';

/**
 * 文節の区切りで折り返すための部品。
 *
 * `|` で区切った文を、区切りごとに <wbr>（ここで折り返してよい目印）を入れて出す。
 * 親に `word-break: keep-all` を指定すると、日本語は <wbr> と句読点の位置だけで折り返す。
 * `word-break: auto-phrase` に対応していないブラウザでも文節で折り返せるようにするための仕組み。
 *
 * 例：<Phrase text="社内の|「探す手間」を、" />
 *
 * `|` は区切り専用。本文の中に `|` を使わないこと（そこが折り返し位置になる）。
 */
export function Phrase({ text }: { text: string }) {
  const segments = text.split('|');

  return (
    <>
      {segments.map((segment, index) => (
        <Fragment key={index}>
          {index > 0 && <wbr />}
          {segment}
        </Fragment>
      ))}
    </>
  );
}
