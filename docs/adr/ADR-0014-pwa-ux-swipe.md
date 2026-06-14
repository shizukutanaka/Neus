# ADR-0014 — カテゴリー5(PWA)/9(UX)調査と スワイプ操作・SW更新戦略

**Date**: 2026-05-30
**Status**: ACCEPTED (v0.7.0で実装)

## Context

10カテゴリー横断調査(ADR-0013)の第2弾。今回はカテゴリー5(PWA/オフライン)と9(A11y/UX)を深掘りし、arXiv/Web標準/GitHub実装を調査。前回ロードマップの残課題から実装可能なものを選定。

## 調査と判断

### カテゴリー5: PWA/オフライン

| 知見 | 出典 | 判断 |
|---|---|---|
| stale-while-revalidate を高評価PWAの45%が動的リソースに採用 | HTTP Archive 2024 | **採用**: app shellをSWRに変更 |
| activeイベントで旧キャッシュをクリーンアップ | MDN | 既に実装済 |
| 失敗POST/PUTをIndexedDBにキュー→接続復帰で再生(Background Sync) | MoldStud | 却下: NeusはRSS取得のみで送信なし、不要 |
| cache-first/network-first/SWR の使い分け | 各種 | 既に適切に実装済(shell=cache, proxy=network) |

**採用理由(app shell SWR化)**:
- 従来はapp shellがcache-first → **index.html が一度キャッシュされると新版デプロイ後も古いまま**
- 単一HTMLアプリのため、これはアプリ全体が更新されない致命的問題
- stale-while-revalidate なら即座にキャッシュを返しつつ裏で新版取得、次回起動で反映
- SW更新通知(updatefound)と二重の更新保証

### カテゴリー9: A11y/UX

| 知見 | 出典 | 判断 |
|---|---|---|
| カードのスワイプ操作(左右でアクション) | モバイルUX標準 | **採用**: 右=star, 左=archive |
| 触覚フィードバック(vibrate) | - | 採用: スワイプ確定時に10ms振動 |
| スクリーンリーダー実機テスト | WCAG | 残(手動テスト要、自動化困難) |

**採用理由(スワイプ)**:
- モバイルの最も基本的なジェスチャ。前回ロードマップで筆頭課題
- ボタンタップより高速で直感的なトリアージ操作
- InterestProfile学習とも連動(右スワイプ→pos学習、左→neg学習)

## Design

### app shell stale-while-revalidate
```
SHELL要求時:
1. キャッシュがあれば即座に返す(高速)
2. 並行してネットワークから新版取得
3. 成功したらキャッシュ更新(次回反映)
4. ネットワーク失敗時はキャッシュにフォールバック(オフライン動作維持)
```

### カードスワイプ
- touchstart でカード記録、touchmove で水平移動量を追跡
- 縦スクロール優位(dy > dx)なら無視 → スクロールと両立
- 水平80px超で確定: 右=star(InterestProfile pos学習)、左=archive(neg学習 + Undo提供)
- 移動中は transform で追従 + 方向の背景色ヒント
- 長押し(キーワードシート)とは移動量で判別(移動したら長押しキャンセル)

## Consequences

- **+**: デプロイした新版が確実にユーザーへ届く(古いHTMLに張り付かない)
- **+**: モバイルで高速トリアージ(スワイプ)、InterestProfile学習と連動
- **+**: スクロールとスワイプが座標判別で共存
- **-**: スワイプはタッチデバイスのみ(PCはボタン操作、既存のまま)
- **-**: スクリーンリーダー実機テストは手動(次回以降)

## North Star 4問チェック

| Q | SWR | スワイプ |
|---|---|---|
| Q1 漏洩 | 不変 | 不変 |
| Q2 運用コスト | 不変 | 不変 |
| Q3 メンテ工数 | 不変 | 微増 |
| Q4 法的リスク | 不変 | 不変 |

## References

- stale-while-revalidate採用率: https://moldstud.com/articles/p-unlocking-the-power-of-service-workers-and-the-cache-api-for-progressive-web-apps
- MDN Caching (activeクリーンアップ): https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Caching
- MDN Offline and background operation: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation
