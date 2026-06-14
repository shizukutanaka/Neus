# ADR-0013 — 10カテゴリー横断調査(arXiv/GitHub)と改善ロードマップ

**Date**: 2026-05-30
**Status**: ACCEPTED (RSS堅牢化 + 永続ストレージをv0.6.0で実装、他は計画)

## Context

Neusのプロダクトカテゴリーを10定義し、各領域でarXiv論文とGitHub実装を調査。ゼロ依存・ローカルファースト・サーバーレス・買い切り制約で改善点を洗い出した。

## 10カテゴリーと調査結果

### 1. 情報推薦・選別 (調査済: ADR-0010/0012)
- Lifetime-aware Interest Matching → 鮮度ブースト実装済
- IP2 Entity-Guided → エンティティ抽出実装済
- InterestProfile(行動学習)実装済

### 2. 全文検索 (調査済: ADR-0011)
- BM25 IDF重み付け実装済
- **残**: TF飽和・文書長正規化(Setベースのため近似のみ。将来TF保持で完全BM25化)

### 3. 重複検知 (調査済: ADR-0010)
- 現状Jaccard(実測0.7ms)で十分。SimHashは数万件規模まで不要

### 4. RSS/フィード処理 ★今回実装
GitHub調査(feedparser-rs, feedsmith, node-feedparser, simple-rss):
- **採用**: bozoパターン(寛容パース) — 壊れたitemをスキップし他を救出
- **採用**: HTMLエンティティデコード(&amp; → &)
- **採用**: メディア添付抽出(enclosure / media:content / media:thumbnail)
- **残(次ループ)**: Conditional GET(ETag/Last-Modified、304で帯域節約)— Worker側の対応が必要
- **残**: 名前空間許容(HTTPS変種、大小文字、末尾スラッシュ)

### 5. PWA/オフライン (調査済: v0.2.6で実ブラウザ検証済)
- SW登録・キャッシュ・オフライン表示を実証済
- **残**: beforeinstallprompt によるインストール促進バナー
- **残**: Background Sync API(オフライン操作のキューイング)

### 6. ローカルストレージ/IndexedDB ★今回実装
MDN/RxDB調査:
- **採用**: navigator.storage.persist() による永続ストレージ要求
  - 許可オリジンはディスク50%まで使え、自動退避(eviction)対象外
  - オフラインファーストでデータ消失を防ぐ重要施策
- 既存: QuotaExceeded対策(StorageGuard自動クリーン)、try-catch、estimate監視は実装済
- **残**: onversionchange/onblocked ハンドラ(多タブ時のDB version競合)
- **残**: Compression Streams API による大容量イベントの圧縮保存

### 7. 暗号化/プライバシー (調査済: ADR-0009/0011)
- AES-GCM + PBKDF2 300k 実装済
- サーバー送信ゼロ → 連合学習/DP不要(設計優位)
- **残(v1.0)**: Event本文の暗号化(ADR-0009)

### 8. オンデバイスAI/要約 (調査済: ADR-0006/0011)
- WebLLM(WebGPU)でネイティブ80%性能の知見
- **残(v1.1)**: Bonsai 1.7B WebGPU オンデバイス要約(BYOK不要化)
- **残**: セマンティック検索(embedding)— FTSの同義語・文脈の限界を補う

### 9. アクセシビリティ/UX (調査済: v0.2.x で実装)
- axe-core violations 0、WCAG 2.2 AA、コントラスト、target size 実装済
- **残**: スクリーンリーダー実機テスト(VoiceOver/NVDA)
- **残**: カードのスワイプ操作(モバイル)

### 10. テスト/品質保証 (継続改善)
- 274検証(vitest 210 + 実ブラウザ 64)、実機能/UI/オフライン/性能 E2E
- **残**: ビジュアルリグレッション、モバイル実機エミュレーション

## Decision

今回(v0.6.0)は最も影響の大きい2件を実装:
1. **RSS寛容パース** (カテゴリー4) — 1件の壊れたXMLで全記事を失う問題を解消
2. **永続ストレージ要求** (カテゴリー6) — オフラインファーストのデータ消失リスクを解消

残りは本ADRをロードマップとして次ループ以降で対応。

## Rationale

### RSS寛容パースを最優先する理由
- 現状は parsererror で feed 全体を捨てる → 実世界のfeedは頻繁に不正XMLを含む
- 1件の壊れたitemで他の正常な記事まで失うのは情報ハブとして致命的
- GitHubの主要パーサ全てがbozoパターンを採用する業界標準

### 永続ストレージを優先する理由
- 「オフラインファースト」を謳うのにデータが自動退避され得る矛盾
- persist()一行で解消でき、効果(データ保全)が大きい
- ユーザーが貯めた情報が消えるのは買い切り製品として許容不可

## North Star 4問チェック

| Q | RSS寛容パース | 永続ストレージ |
|---|---|---|
| Q1 漏洩 | 不変 | 不変 |
| Q2 運用コスト | 不変 | 不変 |
| Q3 メンテ工数 | 微増 | 不変 |
| Q4 法的リスク | 不変 | 減(データ保全=ユーザー保護) |

## References

- feedparser-rs (bozoパターン): https://github.com/bug-ops/feedparser-rs
- feedsmith (寛容パース/名前空間許容): https://github.com/macieklamberski/feedsmith
- node-feedparser (汎用プロパティ): https://github.com/danmactough/node-feedparser
- MDN Storage quotas and eviction: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- RxDB IndexedDB limits: https://rxdb.info/articles/indexeddb-max-storage-limit.html
