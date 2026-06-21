# ADR-0017 — Qiita / Zenn を Watchword 収集ソースに追加

**Date**: 2026-06-21
**Status**: ACCEPTED

## Context

Watchword(ADR-0016)の収集ソースは Google News / Reddit / Hacker News / arXiv /
Wikipedia で、いずれも英語圏に強い。日本語の技術用語を登録しても、日本語コミュニティの
一次情報(Qiita / Zenn)が拾えず、日本語ユーザーにとって取得源が貧弱だった。

Qiita と Zenn は日本の技術記事の中心だが、API の性格が異なる:

- **Qiita**: 公式の REST API v2 が存在し、`GET /api/v2/items?query=` で全文キーワード検索を
  返す(JSON)。未認証で 60 req/h/IP。安定・ドキュメント有り。
- **Zenn**: 公式の検索 API は無い。トピックの Atom フィード
  (`zenn.dev/topics/{topic}/feed`)は公開されている。非公式 JSON エンドポイントも
  存在するが未ドキュメントで破損リスクがある。

## Decision

両者を **opt-in(デフォルト OFF、arXiv と同じ専門ソース扱い)** で追加する。
取得方式はプラットフォームの API 性格に合わせて分ける。

### Qiita — 公式 REST API v2 の全文検索(JSON)

- `https://qiita.com/api/v2/items?query={term}&per_page=20` をワーカーの
  `GET /json?url=` 経由で取得する。
- `qiita.com` を `JSON_HOST_ALLOW` に追加(`wikipedia.org|wikimedia.org|qiita.com`)。
- レスポンス(記事配列)を専用 `parse` で `{title,link,summary,publishedAt,author}` に
  正規化し、既存の `inbound.fetched` パイプラインへ流す(`source.type='word'`、
  `word:{normalized}` 自動タグ)。
- タグ一致に限らず本文も検索対象になるため、タグフィードより網羅的。

### Zenn — トピックの Atom フィード(RSS、ワーカー変更なし)

- `https://zenn.dev/topics/{slug}/feed` を既存の `GET /rss?url=` 経由で取得する。
- term をトピックスラグへ正規化(小英数字+日本語のみ連結、記号・空白除去。
  例 "Next.js"→"nextjs")。一致トピックが無ければ 404 が `lastErrors` に
  `http_404` として記録され、`signalGaps` が「取得失敗」として誠実に表示する。
- 公式検索 API が無く、非公式 JSON は破損リスクがあるため採用しない(ゼロ依存・
  慎重原則)。タグフィードは公開・安定で、`/json` 許可リストを広げずに済む。

### 実装(`index.html`)

- `WORD_FEEDS` のエントリに任意の `kind:'json'` と `parse(text)` を導入。収集ループは
  `kind` で分岐し、JSON は `/json` + `feed.parse`、RSS は `/rss` + `parseFeed` を使う
  (どちらも `{raw,source}` に揃えて publish)。

## Rationale

### なぜ Qiita だけ `/json` 許可リストを広げるか

- Qiita は公式・安定・全文検索という明確な品質上の利得がある。`/json` は
  ホストスコープの読み取り中継で、Wikipedia と同じ攻撃面(SSRF ガード・
  Content-Type 検証・サイズ上限・no-store)を共有するため、信頼ドメインを 1 つ
  追加するコストは小さい。
- Zenn は公式検索 API が無く、`/json` を広げる正当性が弱い。タグフィード(RSS)で
  egress 一本化を保ったまま十分機能する。

### なぜ opt-in(デフォルト OFF)か

- 英語ユーザーに日本語コンテンツを押し付けないため。arXiv と同じ「専門ソース」位置づけ。

### 代替案

- **Qiita もタグフィードのみ**: ワーカー変更不要だが、全文検索の網羅性を捨てることになる。
  公式 API があるのに使わないのは品質上もったいないため不採用。
- **Zenn も非公式 JSON 検索 API**: 網羅性は上がるが、未ドキュメントで予告なく壊れうる。
  ゼロ依存・慎重原則に反するため不採用。将来 Zenn が公式検索 API を出せば再検討。

## Consequences

- ワーカー `JSON_HOST_ALLOW` に `qiita.com` を追加(外部 API 追加に該当、本 ADR で記録)。
- Qiita の未認証レート上限(60 req/h/IP)は、各ユーザーが自身のワーカーを deploy する
  前提(README)では個人利用に十分。共有 deploy で多人数が使うとワーカー IP 単位で
  上限に達しうる点は既知の制約。
- 新規ソーストグル `qiita` / `zenn`(デフォルト OFF)。既存 word の `sources` は
  `wordFromImport` / 既定値で両キーが補完される。
- `WORD_FEEDS` が RSS と JSON の 2 種を持つようになり、将来の JSON ソース追加
  (HN Algolia 等)も同じ `kind:'json'` 機構で受けられる。
