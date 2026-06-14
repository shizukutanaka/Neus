# ADR-0001 — Event Bus型アーキテクチャ採用

**Date**: 2026-05-12
**Status**: ACCEPTED

## Context

Lensy は P1 段階でシンプルな `Collector → Filter → Summarizer → Renderer` パイプライン設計で開始した。P3 で「情報のハブ」という位置付けに昇格し、入力 Adapter・Processor・出力 Adapter の組合せが動的に変化することが明確になった。

## Decision

固定パイプラインを廃止し、メモリ内 pub/sub Event Bus に移行する。

```
Inbound Adapters → Event Bus → Processors → Store → Outbound Adapters
```

Bus topics:
- `inbound.fetched` / `event.normalized` / `event.stored` / `event.tagged` / `event.summarized`
- `event.user-annotated` / `event.duplicate` / `inbound.error`
- `summarizer.error` / `summarizer.budget-exceeded`

## Rationale

| 案 | 実装コスト | 拡張性 | 結合度 |
|---|---|---|---|
| 固定パイプライン | 低 | 低 | 高 |
| Event Bus | 中 | 高 | 低 |
| Observable/RxJS | 高 | 最高 | 中 |

Event Bus を選択。理由:
- ゼロ依存原則(外部ライブラリ不要、30行で実装可)
- 各 Adapter/Processor が独立してテスト可
- 新機能追加が subscribe 呼び出し1つ
- Carmack: 実装コスト最小 / Pike: インターフェース最小

## Consequences

- handler 失敗が他 handler を止めない(try/catch + Promise)
- Bus はグローバルシングルトン(DI なし)
- 同期発火のため handler 内非同期は fire-and-forget
- 将来の Web Worker 隔離には postMessage ブリッジで対応可能
