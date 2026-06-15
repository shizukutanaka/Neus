# ADR-0016 — Watchword Collector(単語登録→自動収集→出力)

**Date**: 2026-06-14
**Status**: ACCEPTED (v0.12.0で実装)

## Context

Neusは購読型(RSSソースを登録してPOLL)の情報ハブだが、「特定の単語/トピックを起点に、その情報を横断的に自動収集したい」という能動的な調査ニーズに直接応える機能がなかった。KeywordRules(WATCH/BLOCK)は流入済みイベントの振り分けに留まり、新たな情報を取りに行く仕組みではない。

要求: 単語を登録すると、その単語に関する情報を自動で集め、まとめて出力できること。

## Decision

「Watchword」を新しい一級概念として追加する。

### 入力(収集)
- 単語ごとに、検索クエリ付きの **RSS/Atom 検索フィード** URL を生成して取得する:
  - Google News 検索RSS / Reddit 検索RSS / Hacker News(hnrss)/ arXiv API(Atom)
  - これらは既存の `GET /rss?url=` プロキシをそのまま再利用でき、ワーカーの「ステートレスなRSS中継」不変条件を維持する。
- 単語自体の定義/概要は **Wikipedia REST summary API**(JSON)から取得する。
  - JSONはワーカーの新エンドポイント `GET /json?url=` 経由で中継する。
- 収集結果は `inbound.fetched` として既存パイプライン(正規化→重複排除→保存→FTS)へ流す。
  word由来イベントには `source.type='word'` と自動タグ `word:{normalized}` を付与し、フィルタ/検索/出力で束ねられるようにする。

### 出力(アウトプット)
既存の出力資産を再利用した「単語ドシエ」:
- Markdown(`WordExporter.toDossier`: 定義 + ソース別の収集アイテム一覧)ダウンロード
- 構造化JSONエクスポート
- Obsidian Vault へ `neus/words/{slug}.md` 直書き(`VaultWriter.exportWordDossier`)
- 個別カードの COPY MD(既存機能をそのまま活用)

### ワーカー `/json` の制約(SSRF/濫用防止)
- ホストは許可リスト `JSON_HOST_ALLOW = /(^|\.)(wikipedia\.org|wikimedia\.org)$/i` のみ。
- 既存の `validateTarget`(http(s)/プライベートIP遮断)・タイムアウト・サイズガード・CORS を共有。
- ステートレス・無ログを維持。

## Rationale

### なぜRSS検索フィードを主軸にするか
- ワーカーを変更せずに済む(RSS/Atom中継のまま)。ゼロ依存・端末内完結・ステートレスの原則を崩さない。
- 単語クエリは既に端末内にあり、外部へ出るのは「検索語」のみ。購読RSSと同じプライバシープロファイル。

### なぜWikipediaだけJSONを許すか
- 単語の「定義/概要」はRSSでは得られず、Wikipedia REST summaryが最小・高品質。
- 汎用JSONプロキシ化を避けるため、ホスト許可リストで Wikipedia/Wikimedia に限定。CSPに外部コンテンツドメインを列挙せず、egressをユーザー自身のワーカーに一本化する。

### 代替案
- **CSPにwikipedia.orgを追加してクライアント直fetch**: ワーカー変更不要だが、コンテンツドメインをCSPに列挙することになり、egress一本化の原則と非対称になるため不採用。
- **HN Algolia等の追加JSONソース**: 現状はhnrss(RSS)で代替可能なため初版では見送り(`/json`許可リスト拡張で将来追加可)。

## Consequences

- IndexedDB に `words` ストアを追加(dbVersion 1→2、非破壊アップグレード)。バックアップ/復元にも含める。
- 新ビュー `WORDS` と `WORDS` モーダル(登録/ソース選択/収集/出力)を追加。
- 収集は手動POLLおよびPeriodic Background Sync(AutoSync)に相乗りする。単語ごとの独立スケジュールは将来課題。
- ワーカーに `/json` を追加(外部API追加に該当、本ADRで記録)。
