# ADR-0005 — プラグインサンドボックス(Web Worker隔離)採用

**Date**: 2026-05-12
**Status**: ACCEPTED

## Context

Lensy はサードパーティプラグインを受け入れる設計(Plugin SDK)。プラグインが Event Bus の任意トピックに publish できると、他モジュールへの干渉や XSS が発生し得る。

## Decision

サードパーティプラグインを Web Worker 内で実行し、Bus 通信を postMessage に制限する。

```
[Plugin Web Worker] --postMessage--> [Plugin Bridge] --Bus.publish(approved-topic)--> [Main]
```

Permission 宣言:
- `fetch`: 外部 HTTP アクセス許可
- `vault-write`: Vault への書き込み許可
- `bus-publish`: 指定 topic のみ publish 許可
- `store-read`: IndexedDB の read-only アクセス許可

## Rationale

| 案 | 隔離度 | 実装コスト | パフォーマンス |
|---|---|---|---|
| 直接実行(信頼) | 無 | 低 | 高 |
| Function スコープ + Proxy | 低 | 中 | 高 |
| Web Worker 隔離 | 高 | 中 | 低(IPC コスト) |
| iframe sandbox | 高 | 高 | 低 |

Web Worker を選択。理由:
- Carmack: DOM へのアクセスなし → 干渉不可
- Martin: 単一責任 — プラグインは入力変換のみ
- Pike: 並行性を明示 — Worker は独立したスレッド

内蔵 Adapter(RSSPoller等)はサンドボックス不要(コアコードとして信頼)。

## Consequences

- postMessage のシリアライズコスト(大きなペイロードで顕在化)
- Worker 内では `window` / `document` / `IndexedDB` に直接アクセス不可
- Permission 未宣言の Bus topic への publish は Bridge で拒否
- Plugin SDK ドキュメント(docs/PLUGIN_SDK.md)が必要 — v1.0 後に整備
