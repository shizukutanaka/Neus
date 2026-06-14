# ADR-0008 — v0.2.0 機能追加: AutoSync / Digest / Later

**Date**: 2026-05-12
**Status**: ACCEPTED (v0.2.0 target)

## Context

v0.1.0 リリース直前に競合分析(Feedly / Inoreader / Readwise / Brief Digest等2026年現在の主要ツール)を実施し、Neusに不足する機能を特定した。

ユーザー価値の高い機能で、かつNorth Star 4問(漏洩・コスト・メンテ・法的リスク)に違反しないものを選定。

## Decision

v0.2.0 で以下3機能を追加する。**全てサーバーレス・端末内完結を維持**。

### F1: AutoSync (Periodic Background Sync)
- Service Worker の `periodicsync` イベントで定期RSS取得
- 設定: 取得間隔(1h / 6h / 12h / 24h)、新着通知ON/OFF
- 対応: Chromium系のみ(Periodic Background Sync API仕様)
- Firefox / Safari: 既存POLLボタンで手動取得継続(progressive enhancement)

### F2: Smart Digest View
- INBOX/ALL/STARRED の隣に DIGEST タブ追加
- 過去24時間のアクティビティを集計表示:
  - 取得数 / 要約済み数 / 本日スター数
  - Top 3 today(score+要約+未読の優先度順)
  - 頻出タグ Top 8(クリックでフィルタ)
  - アクティブソース Top 5
  - 7日間トレンド(SVGバーグラフ、ゼロ依存)

### F3: Reading Queue (LATER)
- カードに LATER ボタン追加(STAR と独立)
- LATER ナビ追加 → 該当Eventのみ表示
- キーボードショートカット `l` キー
- STAR=長期保管お気に入り / LATER=未読待機キュー の意味分離

## Rationale

### 競合分析結果(2026/05時点)

| 競合 | 強み | Neus採用機能 |
|---|---|---|
| Feedly Pro | AI Leo / クラスタリング | DIGEST(ローカル集計) |
| Inoreader | Rules / Periodic sync(Pro限定) | AutoSync(無料) |
| Readwise Reader | Reading Queue | LATER |
| Brief Digest | Daily Digest | DIGEST(ローカル版) |

各機能を「サーバーレス・端末内」で再実装することで、$0 維持 + プライバシー優位を保ったまま競合機能と並ぶ。

### North Star 4問チェック

| 機能 | Q1漏洩 | Q2コスト | Q3メンテ | Q4法的 |
|---|---|---|---|---|
| AutoSync | No | No | Low(SW追記+15行) | No |
| Digest | No | No | Low(既存IDBを集計) | No |
| LATER | No | No | None(state.later追加のみ) | No |

### 棄却した候補

| 機能 | 棄却理由 |
|---|---|
| Newsletter受信(メール転送) | サーバー必須 → Q2違反 |
| Semantic Clustering(現在) | 埋め込みモデルDL必要、v1.1のBonsai統合まで延期 |
| YouTube/Podcast購読 | スコープ拡散、別ジャンル |
| カスタムCSSテーマ | Neusらしさなし、装飾肥大 |
| Webhook配信 | 重要度低、v1.2へ |

## Implementation Notes

### AutoSync 設計

```
Browser (idle)
  → SW.periodicsync('neus-poll')
    → if (client active) postMessage('periodic-poll-done')
       → main thread: RSSPoller.fetchAll() + Notification(if new>0)
    → else: showNotification('Tap to fetch new events')
```

Periodic Sync は SW で実行されるが、Neus のメインロジック(IndexedDB / Crypto / Parser)は index.html のインライン ES module 内にある。SW から直接アクセス不可のため、postMessage 経由でメインスレッドへ delegateする設計。

クライアントが閉じている場合は silent notification でアプリを起こすトリガを残す。これにより iOS Safari は対応外でも通知をタップして起動できる。

### Digest 集計コスト

- 全Event scan O(N)、N=10K で 〜10ms 程度(実測)
- 24h フィルタを timestamp index で先絞り可
- 将来N=100K想定時はindex.timestamp で範囲スキャンに変更

### LATER vs STAR の意味分離

- STAR: 長期保管したい(Vault書出候補)
- LATER: 今は読めないが後で読む(時限的キュー)

スター済みでアーカイブされた古い記事は LATER に出ない。LATER は「未読待機」の役割専門。

## Consequences

- index.html サイズ増加: 117KB → 129KB(+12KB / 制限500KBの26%)
- 新 Service Worker (sw.js v2): cache name `neus-shell-v2` で旧キャッシュ自動破棄
- iOS Safari ユーザーは AutoSync 利用不可だが、機能無効化なし(progressive enhancement)
- v0.1.0 ユーザーが v0.2.0 にアップデート時、IndexedDB schema は同一(state.later は新規optional field)
- Notification permission リクエストはユーザーが SETTINGS で AutoSync 有効化時のみ表示
EOF
echo "ADR-0008 created"