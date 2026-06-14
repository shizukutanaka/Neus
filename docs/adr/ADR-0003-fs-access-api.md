# ADR-0003 — File System Access API + Obsidian Vault直書き採用

**Date**: 2026-05-12
**Status**: ACCEPTED

## Context

Lensy の最終出力先として Obsidian Vault へのエクスポートが求められる。出力手段の選択肢を評価した。

## Decision

File System Access API (`showDirectoryPicker`) でユーザーが指定した Obsidian Vault フォルダに直接 Markdown ファイルを書き込む。

## Rationale

| 案 | 実装 | プライバシー | UX |
|---|---|---|---|
| Obsidian Plugin | 中 | 高 | 高(シームレス) |
| File System Access API | 中 | 高(端末内) | 中(ディレクトリ選択) |
| クリップボード → 手動貼付け | 低 | 高 | 低 |
| Dropbox / Google Drive API | 高 | 低(クラウド送信) | 中 |

File System Access API を選択。理由:
- 外部サービスへのデータ送信ゼロ
- Obsidian Plugin 開発の外部依存なし
- Chromium 系ブラウザで広く対応済み
- `readwrite` 権限でDaily NoteへのAppend + 個別ノート生成が可能

## Consequences

- Safari / Firefox では Blob download fallback に縮退
- Directory handle を IndexedDB に保存して再起動時に復元(権限再要求あり)
- `readwrite` 権限は明示的なユーザー操作(ピッカー)が必要
- Obsidian Plugin 連携は v2.0 以降の検討事項
