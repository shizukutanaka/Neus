# ADR-0002 — BYOK(Bring Your Own Key)AI要約方式採用

**Date**: 2026-05-12
**Status**: ACCEPTED

## Context

AI要約機能を提供するためにはどこかで LLM API を呼ぶ必要がある。サーバー側でAPIキーを管理すれば UX は簡単だが、プライバシー・コスト・ハッキングリスクが増大する。

## Decision

BYOK 方式を採用。APIキーはユーザーが自身のブラウザ内 IndexedDB に保存し、クライアントから直接 API を呼ぶ。サーバーにキーを送信しない。

対応プロバイダ: Anthropic / OpenAI / Google Gemini

## Rationale

| 案 | プライバシー | コスト | UX |
|---|---|---|---|
| サーバー側管理 | 低(キー漏洩リスク) | 高(サーバー課金) | 高 |
| BYOK | 高(端末内完結) | 低($0) | 中(キー入力要) |
| WebLLM(オフライン) | 最高 | 0 | 低(2GB DL) |

BYOK を選択。理由:
- G0.5 個人情報極小化原則: APIキーはサーバーに渡らない
- 月次コスト $0 を維持
- 要約不要のユーザーは全設定スキップ可

P5 で AES-GCM 暗号化を追加してキーの端末内保護も実現。

## Consequences

- 初回設定のフリクションが高い(キー入手・入力)
- Anthropic は `anthropic-dangerous-direct-browser-access` ヘッダーが必要
- CORS 制約によりブラウザ直接呼び出し不可のプロバイダが将来追加された場合は Worker 経由に変更
- ブラウザを閉じてもキーは IndexedDB に残る(意図的、パスフレーズで保護)
