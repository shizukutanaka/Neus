# ADR-0015 — RSS Conditional GET (ETag / Last-Modified)

**Date**: 2026-05-30
**Status**: ACCEPTED (v0.8.0で実装)

## Context

Neusは情報ハブとして頻繁にRSSをPOLLする。だが現状は毎回feed全文をダウンロードしており、変更がなくても帯域とWorker処理を消費していた。ADR-0013のカテゴリー4ロードマップの残課題。

HTTPのConditional GET(条件付きGET)は、クライアントが前回の検証子(ETag/Last-Modified)を送り、サーバー側で変更がなければ`304 Not Modified`をボディ無しで返す標準機構。帯域を大幅に節約できる。

## Decision

Worker と クライアントの両方にConditional GETを実装する。

### Worker (_worker.js)
- クライアントの `If-None-Match` / `If-Modified-Since` を upstream に転送
- upstream が 304 を返したら、検証子だけ付けてボディ無しの 304 を中継
- upstream の `ETag` / `Last-Modified` をレスポンスヘッダに含めてクライアントへ
- CORS: `If-None-Match`/`If-Modified-Since` を許可ヘッダに、`ETag`/`Last-Modified` を露出ヘッダに追加

### クライアント (fetchOne)
- source ごとに `etag` / `lastModified` を IndexedDB の sources ストアに保存
- 次回リクエストで `If-None-Match` / `If-Modified-Since` を付与
- レスポンスが 304 なら parseFeed をスキップして 0 件を返す(最大の節約)
- 200 ならレスポンスの検証子を保存して次回に備える

## Rationale

### なぜ重要か
- 情報ハブは高頻度POLL(periodic sync含む)が前提
- 多くのfeedは更新が散発的 → 大半のPOLLは「変更なし」
- 304は数百バイトのヘッダのみ、200は数十〜数百KB → 桁違いの節約
- Worker無料枠(リクエスト数/帯域)の節約にもなり、サーバーレス運用コストに寄与(Q2)

### CORS制約の解決
- ブラウザのfetchはデフォルトで一部レスポンスヘッダしか読めない
- `Access-Control-Expose-Headers: etag, last-modified` で明示的に露出が必要
- これがないとクライアントが検証子を読めず機能しない(実装の要点)

## Consequences

- **+**: 変更なしfeedの帯域・処理を桁違いに削減
- **+**: Worker無料枠の節約 → サーバーレス運用コスト低減
- **+**: バッテリー/モバイルデータの節約(モバイルPWAに効く)
- **-**: source オブジェクトに etag/lastModified フィールドが増える(スキーマ拡張、後方互換)
- **-**: 一部feedは検証子を返さない → その場合は従来通り全文取得(劣化なし)

## North Star 4問チェック

| Q | 評価 |
|---|---|
| Q1 漏洩 | 不変 |
| Q2 運用コスト | **減**(帯域・Worker処理の節約) |
| Q3 メンテ工数 | 微増(検証子の保存ロジック) |
| Q4 法的リスク | 不変 |

## References

- MDN Conditional requests: https://developer.mozilla.org/en-US/docs/Web/HTTP/Conditional_requests
- RFC 9110 (HTTP Semantics) §13 Conditional Requests
- ADR-0013: カテゴリー4 RSS処理ロードマップ
