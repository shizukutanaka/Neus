# ADR-0019 — 重複排除の類似度比較件数に上限を設ける

**Date**: 2026-07-01
**Status**: ACCEPTED

## Context

SPEC.md §10 round 15 で性能課題として指摘され、ADR での再検討が明示的に留保されていた:

> **dedup の Jaccard が O(n^2)**: 24h ウィンドウ内の近傍比較は件数増で重くなるが、
> 正当性の欠陥ではなく性能課題。別途 ADR で窓の上限化を検討する。

実装(`event.normalized` の重複排除):

```js
const recent=await Store.recentEvents(CONFIG.dedupWindowMs);   // 24h 全件(件数無制限)
const newTok=new Set(tokenize(ev.content.title));
for(const r of recent){                                       // 全件と総当たり
  const sim=jaccard(newTok,new Set(tokenize(r.content.title))); // 毎回re-tokenize
  if(sim>=CONFIG.dedupTitleThreshold){ ... return; }
}
```

`Store.recentEvents` 自体は `timestamp` インデックスの範囲クエリで効率的だが、その後の
JS側ループは 24h ウィンドウ内の件数 N に比例したコストがかかる。1件の新着イベントごとに
N 件の既存イベントタイトルを毎回 `tokenize()` し直す(結果はキャッシュされない)。
ソース数・watchword 数が多いユーザーが POLL/COLLECT ALL で M 件を一括取り込みすると、
総コストは概ね O(M×N) で、活発なユーザーほど N も M も増えるため体感上 O(n²) 的に悪化する。

## Decision

**類似度比較の対象を、24h ウィンドウ内の直近 `dedupCompareMax` 件に上限化する。**
ウィンドウそのもの(24h)は変更しない — 変更するのは「その中で実際に比較する件数」のみ。

```js
const recent=(await Store.recentEvents(CONFIG.dedupWindowMs)).slice(0,CONFIG.dedupCompareMax);
```

`Store.recentEvents` は `timestamp` インデックスを `'prev'`(降順)カーソルで走査するため、
`slice(0,N)` は「直近 N 件」を取る操作になる(末尾切り捨てではない)。

`dedupCompareMax = 300` とする。根拠:

- 重複記事は同じ RSS/検索フィードが短時間(通常は分〜数時間)に配信するため、24h という
  ウィンドウ自体が既に「時間的近接性」を担保する安全マージンであり、実際の重複ペアは
  ほぼ常にウィンドウの先頭(直近)側に集中する。300件は、複数ソース+複数 watchword を
  併用する活発な個人ユーザーでも1日の取り込み件数を通常上回る値であり、実運用での
  再現率(recall)低下は事実上発生しない。
- 上限を超えるほど24hに集中して取り込まれるのは異常系(初回POLLでの一括バックフィル等)
  であり、そこでの重複見逃しは許容範囲(手動マージ余地は残る。破壊的動作ではない)。

## Rationale

### 3案比較

1. **上限化しない(現状維持)**: 正当性は完璧だが、件数増加でコストが線形〜二乗的に悪化。
   個人ユーザー規模では通常問題にならないが、SPEC で明示的に性能課題として記録済み。
2. **直近 N 件に上限化(採用)**: 実装が1行(`.slice`)で完結し、既存の「タイトル類似度で
   重複を検出する」という契約(意味論)を変えない。取りこぼす可能性があるのは「ウィンドウ
   内だが N 件より古い」重複のみで、時間的に離れているため実際の重複である確率は低い。
3. **N-gram転置インデックスによる候補絞り込み(FTSIndex 相当の仕組みを dedup 専用に構築)**:
   比較件数を実質的に減らせるが、実装・保守コストが重く、個人利用規模で解決したい問題に
   対して過剰設計(CLAUDE.md のゼロ設計思考に反する)。将来的に必要になれば再検討。

案2を採用。ゼロ依存・単純さを保ったまま、コストに確定的な上限を与える。

### なぜ 24h ウィンドウ自体は変えないか

- ウィンドウは「重複とみなす時間的近接性」の定義そのもので、`dedupCompareMax` とは独立した
  別の変数(時間 vs 件数)。ウィンドウを狭めると根本的に検出できなくなる重複が増えるが、
  件数上限は「時間的に近いが件数が多い」場合にのみ影響する、より穏やかな制約。

## Consequences

- `CONFIG.dedupCompareMax=300` を追加。既存の `dedupTitleThreshold` / `dedupWindowMs` は不変。
- 通常利用(1日あたりの取り込みが数十〜百件程度)では挙動に変化なし。300件を超える一括
  バックフィル時のみ、直近300件を超えて古い重複が見逃され得る(誤検出ではなく見逃し側の
  トレードオフであり、既存イベントは失われない — 重複としてリンクされず新規保存されるだけ)。
- コストは 1 新着イベントあたり最大 300 件の tokenize+jaccard に確定的に上限化される。
