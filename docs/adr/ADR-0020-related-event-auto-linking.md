# ADR-0020 — 関連イベント自動リンク(類似度ベース)

**Date**: 2026-07-03
**Status**: PROPOSED(人間の承認待ち — CLAUDE.md 重要分岐: データモデルの破壊的変更)

## Context

`Plan.md` §4.9 (v1.1) に「関連付け自動化(類似度ベース、リンク自動生成)」が定義されているが
未実装(`docs/FEATURE-AUDIT.md` §1-3)。

`InformationEvent.links[]` は既に2種のプレフィックス規約で拡張済みの緩い型の配列である:

- 裸の URL 文字列 — 同一記事の別URL(dedup で `dedupTitleThreshold=0.8` 以上の類似記事を
  マージする際に追記。`index.html` の `event.normalized` 購読ハンドラ)
- `vault:{path}` — `VaultMatcher` が突合したローカル Obsidian ノート

dedup は既に `recentEvents(dedupWindowMs)` の直近 `dedupCompareMax=300` 件
(ADR-0019)に対して `tokenize()`+`jaccard()` でタイトル類似度を計算しているが、
**0.8 未満の類似度は一切記録せず捨てている**。0.8 未満だが明確に無関係でもない範囲
(例: 同じニュースを別視点で書いた記事、続報記事)には「関連するが別記事」という情報が
既に計算されているのに保存されていない。

## Decision(提案・要承認)

### 比較した3案

1. **現状維持(何もしない)**: リスクゼロだが Plan.md 記載の機能を提供しない。
2. **【提案】既存 dedup ループの類似度計算を再利用し、閾値未満・下限以上の範囲で
   双方向の `related:{eventId}` リンクを `links[]` に追記する**: 新規ストア・新規
   IndexedDB スキーマ・新規インデックスが不要。`vault:` と同じプレフィックス規約を
   1つ増やすだけ。既存の `dedupCompareMax=300` の直近ウィンドウをそのまま再利用。
3. **専用の類似度インデックスをバックグラウンドジョブで全イベント履歴に対して構築し、
   別フィールド `related` に保存する**: 時間的に離れた記事も拾えるが、新規ストア・
   新規メンテナンス処理が必要で、個人利用規模に対しては過剰設計(ゼロ設計思考に反する)。
   dedup が既に持つ計算資産を再利用しない点でも非効率。

**案2を推奨する。**

### 具体的な変更点

`event.normalized` 購読ハンドラ(`index.html`、dedup ループ内)を以下のように拡張する:

```js
const recent=(await Store.recentEvents(CONFIG.dedupWindowMs)).slice(0,CONFIG.dedupCompareMax);
const newTok=new Set(tokenize(ev.content.title));
if(newTok.size>0){
  for(const r of recent){
    const sim=jaccard(newTok,new Set(tokenize(r.content.title)));
    if(sim>=CONFIG.dedupTitleThreshold){ /* 既存: 重複マージ */ ... return; }
    // 新規: 重複ではないが無視できない類似度 -> 双方向の related リンク
    if(sim>=CONFIG.relatedTitleThreshold){
      if(!ev.links.includes(`related:${r.id}`))ev.links=[...ev.links,`related:${r.id}`];
      if(!(r.links||[]).includes(`related:${ev.id}`)){r.links=[...(r.links||[]),`related:${ev.id}`];await Store.putEvent(r);FTSIndex.add(r);}
    }
  }
}
```

- `CONFIG.relatedTitleThreshold`(要決定、暫定 0.4): `dedupTitleThreshold`(0.8)より低いが、
  無関係な記事が一般語の共有だけで誤マッチしない下限。要チューニング・テスト。
- 1イベントあたりの `related:` 件数に上限(例: 5件)を設け、汎用的な話題で無制限に
  増殖しないようにする。
- UI: 既存の `vaultLinks`(`(ev.links||[]).filter(l=>l.startsWith('vault:'))`)と同じ
  パターンで `relatedLinks` を抽出し、詳細モーダル等に表示する新規UIが必要
  (現状 `vault:` リンクの表示箇所3箇所と同様の追加)。

## Rationale

### なぜ「破壊的変更」ではなく「追加」と整理できるか

`links[]` は既に文字列プレフィックスによる緩い多態性を持つ配列であり(裸URL / `vault:`)、
`related:` プレフィックスを追加しても既存の2種の意味論・既存コンシューマの
`.filter(l=>l.startsWith('vault:'))` 等のロジックには一切影響しない。**厳密には
「破壊的変更」ではなく「型の追加」だが**、CLAUDE.md は「データモデル
(InformationEvent)の破壊的変更」を人間の承認必須の重要分岐として挙げており、
本件のようにコアデータフィールドの意味論を拡張する変更もこの精神に該当すると判断し、
本 ADR を人間承認前提の PROPOSED として起票する。

### なぜ双方向か

ユーザーが記事Aを見て「Bと関連している」と知りたい状況は、AがBより先に収集されたか後か
によらない。片方向だけだと収集順によって発見できるかが変わってしまう。

## Consequences(承認された場合)

- `links[]` に3つ目のプレフィックス規約(`related:`)が加わる。既存の裸URL・`vault:`
  読み取りロジックは無変更。
- 新規 UI(関連イベント表示)が必要。
- `CONFIG.relatedTitleThreshold` の具体的な値と上限件数は実装前にテストで検証する。
- Vault 書き出し・JSON エクスポート・インポート往復での `related:` リンクの扱い
  (エクスポート先に相手記事が無い場合の扱い等)を実装時に定義する必要がある。

## 未決定事項(要ユーザー判断)

1. `relatedTitleThreshold` の具体値(暫定 0.4 でよいか)
2. 1イベントあたりの `related:` 上限件数(暫定 5 でよいか)
3. UI表示位置(詳細モーダルのみか、カード上にも軽量表示するか)
