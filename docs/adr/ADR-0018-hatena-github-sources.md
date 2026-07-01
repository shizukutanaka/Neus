# ADR-0018 — Hatena Bookmark / GitHub Topics を Watchword 収集ソースに追加

**Date**: 2026-07-01
**Status**: ACCEPTED

## Context

ADR-0017 で Qiita(全文検索 API)・Zenn(トピック Atom フィード)を追加したが、
以下2件は別途に追加され、記録されていなかった:

- **Hatena Bookmark**: Qiita/Zenn は単一プラットフォームの記事に閉じる。はてなブックマークは
  日本語Web全体を横断する被ブックマーク記事の全文検索 RSS
  (`b.hatena.ne.jp/search/text?q=...&mode=rss`)を提供し、Qiita/Zenn を補完する。
- **GitHub Topics**: リポジトリ単位の情報源が無かった。GitHub は公式検索 API が無いが、
  トピックの Atom フィード(`github.com/topics/{slug}.atom`)を公開しており、Zenn と同型の
  トピックフィード設計で取得できる。

いずれも本 ADR で事後的に記録し、ADR-0017 と同じ判断枠組み(公式 API の有無・opt-in・
ワーカー変更の要否)を適用する。

## Decision

両者を **opt-in(デフォルト OFF、arXiv と同じ専門ソース扱い)** で追加する。
どちらも既存の `GET /rss?url=` プロキシで取得でき、ワーカー変更は不要。

### Hatena Bookmark — 全文検索 RSS(RSS、ワーカー変更なし)

- `https://b.hatena.ne.jp/search/text?q={term}&sort=recent&users=3&safe=on&mode=rss` を
  既存の `/rss` 経由で取得する。
- `users=3`: 最低3ブックマークの品質フロア。「広く参照された記事」という役割に沿い、
  1ブックマークのノイズ(個人メモ/スパム)を除外する。
- `safe=on`: アダルト除外。Qiita/Zenn と違い Web 全体を横断するアグリゲータのため
  健全な既定にする。
- 検索語は verbatim で渡す(検索エンジン側が処理)。
- 各アイテムの `hatena:bookmarkcount` 拡張要素を、Qiita の `likes_count` と同じ曲線
  (`engagementScore()`、+0..25 の対数ブースト、基準50)でスコアに反映する。

### GitHub Topics — トピックの Atom フィード(RSS、ワーカー変更なし)

- `https://github.com/topics/{slug}.atom` を既存の `/rss` 経由で取得する。
- term をトピックスラグへ正規化(小文字英数字のみ、非英数字はハイフンへ連結・前後の
  ハイフンは除去。例 "Next.js"→"next-js")。GitHub のトピック命名規則がハイフン区切り
  のため、Zenn(連結・ハイフン無し)とは正規化方式が異なる — プラットフォームごとの
  実際の命名規則に合わせる(ADR-0017 の教訓と同じ)。
- 一致トピックが無ければ 404 が返る。これは Zenn と同じ「該当トピック無し=信号なし」の
  設計であり、`signalGaps` の 404-as-silence 特例を `zennLabel` 単体の判定から
  `topicFeeds = new Set([Zenn, GitHub])` へ一般化して両方に適用する。
- 英語スラグのみ対応(日本語トピックは実質存在しない)のため、日本語ユーザー向けの
  既定 ON 対象には含めない(`defaultSources()` は ja/en いずれも `github:false`)。

## Rationale

### なぜ両方とも `/rss` のみで `/json` 許可リストを広げないか

- Hatena・GitHub Topics のいずれも Atom/RSS で十分な情報(タイトル・リンク・要約・
  日付・エンゲージメント指標)が取得でき、JSON API を使う理由がない。egress を
  `/rss` 経由に一本化したまま追加でき、Worker のホスト許可リスト変更(=外部API追加の
  記録対象)が不要。

### なぜ opt-in(デフォルト OFF)か

- Hatena: 日本語ユーザー向けの既定 ON(Qiita/Zenn と同じ扱い)。英語ユーザーには
  デフォルト OFF。
- GitHub: 英語スラグのみのため言語に関わらずデフォルト OFF。リポジトリ中心の
  技術情報は arXiv と同じ「専門ソース」位置づけ。

### 代替案

- **GitHub も公式 Search API (REST/GraphQL) を使う**: 認証必須(未認証は極端に低いレート
  制限)で、個人利用の zero-config 前提(README)に反するため不採用。Topics Atom
  フィードは無認証・安定・公開で十分な代替。
- **Hatena も個別記事ページのブックマーク数のみ取得**: 検索機能を失い、watchword ごとの
  収集という目的に合わないため不採用。

## Consequences

- ワーカー変更なし(Worker のホスト許可リストは既存の `/rss` プロキシのままで両ソースを
  通す)。
- 新規ソーストグル `hatena` / `github`。`defaultSources()` に両キーを追加し、
  `wordFromImport` は `{...defaultSources(),...w.sources}` のマージで既存語にも
  両キーを補完する(移行安全)。
- `signalGaps` の 404-as-silence 特例が `topicFeeds` Set 化され、将来 3つ目のトピック
  フィード型ソースを追加する際も同じ機構に一行追加するだけで対応できる。
