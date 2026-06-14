# Contributing to Neus

Neus は単独開発ですが、外部からのIssue・PRを歓迎します。本ドキュメントは貢献のガイドラインを示します。

## 開発環境

- Node.js 22+
- Chrome / Edge(File System Access API テスト用)
- ローカルHTTPSサーバー(任意、`npx serve`等)

## セットアップ

```bash
git clone https://github.com/shizukutanaka/neus.git
cd neus
npm install
npm run dev       # python3 -m http.server 8080
```

## 開発フロー

1. Issue で議論 → 設計の合意を得る(大きな変更の場合)
2. ブランチを切る(`feat/x`, `fix/y`)
3. 実装 + テスト追加
4. PR 提出 — 以下を満たすこと:
   - `npm run lint` PASS
   - `node scripts/check-html.mjs` PASS
   - `npm test` PASS(全件)
   - `npm audit` 0 vulnerabilities
   - CHANGELOG.md `[Unreleased]` に記載

## コーディング規約

### 設計原則

- **ゼロ依存維持**: 本番コードに外部ライブラリを追加しない
- **単一HTMLファイル**: index.htmlへの集約を維持(v0.3.0で外部化予定、ADR-0007)
- **Carmack/Martin/Pike**: 性能・クリーン・簡潔の3軸
- **North Star 4問チェック**:
  1. 漏洩可能性を増やすか?
  2. 運用コストを増やすか?
  3. メンテ工数を恒久的に増やすか?
  4. 法的リスクを増やすか?

### 命名

- 関数・変数: `camelCase`
- クラス・モジュール定数: `PascalCase` / `UPPER_SNAKE_CASE`
- DOM ID: `kebab-case`
- 翻訳キー: `namespace.key.subkey`

### コミットメッセージ

[Conventional Commits](https://www.conventionalcommits.org/) を採用:

- `feat:` 新機能
- `fix:` バグ修正
- `docs:` ドキュメント
- `test:` テスト追加・修正
- `refactor:` リファクタリング
- `chore:` ビルド・補助ツール変更
- `feat!:` 破壊的変更(BREAKING CHANGE)

例:
```
feat(digest): add 7-day trend SVG chart
fix(crypto): handle empty passphrase in decrypt
docs(README): clarify BYOK setup steps
```

## テスト

### 既存スイート(全6スイート、148件)

| ファイル | 対象 |
|---|---|
| `tests/utils.test.mjs` | 純粋関数(normalizeUrl/jaccard等) |
| `tests/worker.test.mjs` | _worker.js のSSRF防止等 |
| `tests/keyword-rules.test.mjs` | KeywordRules ロジック |
| `tests/digest.test.mjs` | DIGEST 集計 |
| `tests/crypto.test.mjs` | AES-GCM round-trip |
| `tests/i18n.test.mjs` | DICT完全性 |

### テスト追加の指針

- **純粋関数**: vitest で単体テスト
- **DOM操作**: jsdom で軽量検証 / E2Eは将来の Playwright で
- **WebAPI mock**: tests/setup.mjs にモック追加
- 新機能には必ず1テスト以上

## ADR(Architecture Decision Record)

設計上の判断は `docs/adr/ADR-NNNN-title.md` に記録する。テンプレート:

```markdown
# ADR-NNNN — タイトル

**Date**: YYYY-MM-DD
**Status**: PROPOSED / ACCEPTED / DEPRECATED

## Context
状況説明

## Decision
決定内容

## Rationale
判断根拠 — 比較・トレードオフ

## Consequences
結果 — 良い影響・悪い影響
```

## レビュー

PR は AI 2名 + 自動チェック(CI)で判定:

| Reviewer | 観点 |
|---|---|
| A | セキュリティ・脆弱性・プライバシー |
| B | アーキテクチャ・テスト・ドキュメント |

両方APPROVED で マージ可。

## リリース

セマンティックバージョニング:

- **MAJOR**: 破壊的変更
- **MINOR**: 後方互換の機能追加
- **PATCH**: バグ修正

リリース手順は `DEPLOY.md` 参照。

## 質問・議論

- バグ報告 → [GitHub Issues](https://github.com/shizukutanaka/neus/issues)
- 機能提案 → Issue で議論後、設計合意 → PR
- セキュリティ報告 → `SECURITY.md` 参照(非公開チャンネル)

## ライセンス

MIT License — 貢献はMITライセンス下でリリースされることに同意していただきます。
