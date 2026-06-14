# ADR-0004 — Tauri/Capacitorのv1.1/v1.2への段階繰延

**Date**: 2026-05-12
**Status**: ACCEPTED

## Context

当初 Plan.md で Tauri 2(Desktop) + Capacitor 6(Mobile)を v1.0 に含めていた。North Star 整合性チェックで再評価した。

## Decision

v1.0 は Web/PWA のみ。Tauri を v1.1 へ、Capacitor を v1.2 へ繰り延べる。

## Rationale

North Star 4問チェック:
1. 漏洩可能性を増やすか? → Tauri は OS ネイティブ API 追加、No
2. 運用コストを増やすか? → OS別バイナリ署名・配布が必要、Yes → 代替は「PWA でカバー」
3. メンテ工数を恒久的に増やすか? → Yes(macOS notarization / Windows Authenticode / Android keystore)
4. 法的リスクを増やすか? → App Store 規約準拠、確認コスト増

PWA 単体で以下が達成可能:
- File System Access API → Vault 書き出し
- Share Target API → モバイル共有受信
- Service Worker → オフライン動作
- Install prompt → ホーム画面追加

v1.0 をシンプルに絞ることで 17 作業日のスケジュールを維持。

## Consequences

- v1.0 では iOS Safari の制限(File System Access 未対応)が残る
- Capacitor v1.2 では IMAP メール購読、ファイル監視を追加予定
- Tauri v1.1 では ベクトル検索・グラフビュー・通知を追加予定
