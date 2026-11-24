import styles from '@/components/landing/Landing.module.css';
import { ChatPreview } from '@/components/landing/ChatPreview';
import { Phrase } from '@/components/landing/Phrase';
import {
  BookOpenIcon,
  FileTextIcon,
  LockIcon,
  MessageSquareIcon,
  PlayIcon,
  SearchIcon,
} from '@/components/icons';

/**
 * ランディングページ（`/`）
 *
 * 未ログインでも開ける公開ページ。
 * 製品の導線は「デモとして試す」だけにする（ページ下部に「つくった人」への相談の入口がある）。
 * 公開版は Supabase を持たずログインできないため、ログイン画面へのリンクは置かない
 * （/login・/register のページ自体は残している）。
 *
 * 【認証について】
 * この画面は Middleware の公開パス（完全一致 `/`）に含まれており、認証を行わない。
 * **社内文書の内容をここに書いてはいけない**（未ログインの相手が読めてしまう）。
 * ログイン後のチャット画面は `/chat` にある。
 *
 * 【掲載する数値について】
 * 実績値は 精度検証フェーズ の測定結果と実測ログに基づく。
 * 測っていない数字を載せると、クライアントへの説明が事実と食い違う。
 * 変更する場合は必ず測定し直し、測定条件も併記すること。
 */

// ログイン状態で表示が変わらないため静的に生成してよい
export const dynamic = 'force-static';

export const metadata = {
  title: '社内文書検索AI',
  description:
    '社内規程やマニュアルをチャットで横断検索。回答には必ず出典を表示し、文書にない情報は推測しません。',
};

/**
 * 実績数値。すべて測定済みの値のみを載せる。
 *  - 回答精度100%    … 精度検証フェーズ（12問・文書に記載のある10問すべて正答）
 *  - ハルシネーション0件 … 同検証の12問すべてで文書外の推測回答なし
 *  - 平均回答時間2.0s  … POST /api/chat の成功21件の実測平均（1.39〜2.88秒）
 */
const STATS = [
  { value: '100%', label: '回答精度' },
  { value: '0件', label: 'ハルシネーション' },
  { value: '2.0s', label: '平均回答時間' },
];

/** 機能紹介。実装済みの内容だけを書く（できないことを書かない） */
const FEATURES = [
  {
    icon: <SearchIcon size={20} />,
    title: 'ベクトル検索 + AI回答',
    description:
      'キーワードではなく意味で検索。複数文書にまたがる情報も、一度の質問で取得できます。',
    meta: 'pgvector · cosine similarity · threshold 0.62',
  },
  {
    icon: <FileTextIcon size={20} />,
    title: '出典を必ず表示',
    description:
      'すべての回答に根拠となる文書名・ページ・該当箇所を表示。AIの推測による回答は行いません。',
    meta: 'hallucination rate · 0% (12問検証)',
  },
  {
    icon: <LockIcon size={20} />,
    title: '社内認証 + 東京リージョン',
    description:
      'Supabase Authによる認証、国内リージョンでのデータ保存。社外への情報漏洩を設計レベルで防止します。',
    meta: 'Supabase Auth · ap-northeast-1 · RLS',
  },
];

/**
 * 「つくった人」の連絡先（オーナーが公開してよいと決めた2か所。本名・メールアドレスは載せない）。
 * LINE はサイト外（GitHub など）からの経路用のURLを使う。ほかの模擬案件のLPとそろえること
 */
const LINE_URL = 'https://line.me/R/ti/p/@745jejoa';
const PORTFOLIO_URL = 'https://misako-profile-portfolio.vercel.app/';

/** 技術スタック（フッター表示用） */
const TECH_TAGS = ['Next.js 14', 'Supabase', 'Gemini API', 'pgvector'];

export default function LandingPage() {
  return (
    <div className={styles.page}>
      {/* ナビゲーション */}
      <nav className={styles.nav}>
        <div className={styles.navLogo}>
          <span className={styles.navLogoMark}>
            <BookOpenIcon size={16} strokeWidth={2.2} />
          </span>
          社内文書検索AI
        </div>

        {/*
          ページ遷移は <a> タグを使う（コーディング規約）。
          Next.jsのルーターキャッシュに前の画面が残らないようにするため
        */}
        <div className={styles.navLinks}>
          <a href="#features" className={`${styles.btnGhost} ${styles.navFeatureLink}`}>
            機能
          </a>
          <a href="/demo" className={styles.btnGhost}>
            デモを試す
          </a>
        </div>
      </nav>

      {/* ヒーロー */}
      <section className={styles.hero}>
        <div className={styles.heroGrid} />

        <div className={styles.heroInner}>
          <div>
            <div className={styles.heroEyebrow}>
              <span className={styles.eyebrowDot} />
              RAG — Retrieval-Augmented Generation
            </div>

            <h1 className={styles.heroTitle}>
              <span className={styles.heroTitleStrong}>社内文書を、</span>
              <br />
              AIが<span className={styles.heroTitleAccent}>即座に</span>検索する
            </h1>

            <p className={styles.heroSub}>
              PDFをアップロードするだけで、社内規程・マニュアルをチャットで横断検索。
              回答には必ず出典を表示します。
            </p>

            <div className={styles.heroActions}>
              <a href="/demo" className={styles.btnHeroPrimary}>
                <PlayIcon size={15} strokeWidth={2.2} />
                デモとして試す
              </a>
            </div>

            <p className={`${styles.loginNote} ${styles.phrase}`}>
              <Phrase text="本番版は、|社内アカウントで|ログインして|使う|設計です。" />
              <br className={styles.pcBreak} />
              <Phrase text="このページでは、|サンプル文書で|体験版を|お試し|いただけます。" />
            </p>

            <div className={styles.heroStats}>
              {STATS.map((stat) => (
                <div className={styles.statItem} key={stat.label}>
                  <span className={styles.statNum}>{stat.value}</span>
                  <span className={styles.statLabel}>{stat.label}</span>
                </div>
              ))}

              {/* 根拠のない数字に見せないため、測定条件を必ず添える */}
              <p className={styles.statsNote}>
                評価データ12問（文書に記載あり10問・記載なし2問）での検証結果、
                および応答21件の実測平均です。
              </p>
            </div>
          </div>

          <div>
            <ChatPreview />
          </div>
        </div>
      </section>

      {/* 機能 */}
      <section className={styles.features} id="features">
        <div className={styles.featuresInner}>
          <div className={styles.sectionLabel}>Features</div>

          <h2 className={styles.sectionTitle}>
            必要な情報へ、
            <br />
            <span className={styles.sectionTitleStrong}>最短で到達する</span>
          </h2>

          <div className={styles.featuresGrid}>
            {FEATURES.map((feature) => (
              <div className={styles.featureCard} key={feature.title}>
                <div className={styles.featureIcon}>{feature.icon}</div>
                <h3 className={styles.featureTitle}>{feature.title}</h3>
                <p className={styles.featureDesc}>{feature.description}</p>
                <div className={styles.featureMeta}>{feature.meta}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className={styles.ctaSection}>
        <div className={styles.ctaInner}>
          <h2 className={styles.ctaTitle}>まず、試してみてください</h2>
          <p className={styles.ctaSub}>
            Gemini APIキーを用意するだけで、
            <br />
            アカウント不要でデモを体験できます。
          </p>

          <div className={styles.ctaActions}>
            <a href="/demo" className={styles.btnHeroPrimary}>
              <PlayIcon size={15} strokeWidth={2.2} />
              デモとして試す
            </a>
          </div>

          {/* すぐ上の文と重ならないよう、CTA では前半の1文だけにする */}
          <p className={`${styles.loginNote} ${styles.phrase}`}>
            <Phrase text="本番版は、|社内アカウントで|ログインして|使う|設計です。" />
          </p>
        </div>
      </section>

      {/*
        つくった人（相談の入口）。ほかの模擬案件のLPと同じ文言・同じ2つのボタンにそろえる。
        押し売りにならない呼びかけにし、LINE を一番目立たせる
      */}
      <section className={styles.aboutSection} aria-labelledby="about-title">
        <div className={styles.aboutInner}>
          <div className={styles.sectionLabel}>Contact</div>

          {/*
            PC は意味の切れ目で改行する（pcBreak）。スマホでは pcBreak を消し、
            Phrase の文節の区切りで自然に折り返す
          */}
          <h2 className={`${styles.aboutTitle} ${styles.phrase}`} id="about-title">
            <Phrase text="業務の|「ちょっと困った」を、" />
            <br />
            <Phrase text="仕組みで|解決しませんか？" />
          </h2>

          <p className={`${styles.aboutLead} ${styles.phrase}`}>
            <Phrase text="個人事業主・|小規模〜中規模|事業者向けに、" />
            <br className={styles.pcBreak} />
            {/* 「AI 活用」の間のスペースで折り返さないよう、詰めて1語にする */}
            <Phrase text="業務課題に|合わせた|AI活用・|システム開発の|相談を|承ります。" />
          </p>
          <p className={`${styles.aboutSub} ${styles.phrase}`}>
            <Phrase text="この|文書検索のように、|社内の|「探す手間」を、" />
            <br className={styles.pcBreak} />
            <Phrase text="使いやすい|仕組みに|変える|お手伝いを|しています。" />
            <br className={styles.pcBreak} />
            <Phrase text="「うちでも|できるかな？」という|段階の|ご相談も|歓迎です。" />
          </p>

          <div className={styles.ctaActions}>
            <a href={LINE_URL} target="_blank" rel="noopener noreferrer" className={styles.btnHeroPrimary}>
              <MessageSquareIcon size={15} strokeWidth={2.2} />
              {/* 「LINE」と「公式」の間で折り返さないよう、改行しないスペースでつなぐ */}
              LINE&nbsp;公式で相談する
              <span className="srOnly">（新しいタブで開きます）</span>
            </a>
            <a href={PORTFOLIO_URL} target="_blank" rel="noopener noreferrer" className={styles.btnHeroSecondary}>
              ポートフォリオを見る
              <span className="srOnly">（新しいタブで開きます）</span>
            </a>
          </div>
        </div>
      </section>

      {/* フッター */}
      <footer className={styles.footer}>
        {/*
          特定の会社名は書かない。
          この画面はポートフォリオとしても公開するため、架空の社名を前面に出すと
          実在の受託案件と誤解される。社名はデモ文書の中にサンプルとして登場するに留める
        */}
        <div className={styles.footerCopy}>社内文書検索AI — 社内規程・マニュアルのRAG検索システム</div>
        <div className={styles.footerTech}>
          {TECH_TAGS.map((tag) => (
            <span className={styles.techTag} key={tag}>
              {tag}
            </span>
          ))}
        </div>
      </footer>
    </div>
  );
}
