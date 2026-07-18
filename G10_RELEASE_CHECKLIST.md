# G10 リリースチェックリスト

`Plan.md` §10「完了定義 (DoD)」の G10 全7項目を、各リリースでこのテンプレートを複製して
記録する。全項目 PASS で正式リリース(`CLAUDE.md`「リリース」ワークフロー / `DEPLOY.md` STEP 8)。

対象バージョン: **v0.13.0**  /  日付: 2026-07-17

| # | 項目 | 判定 | メモ |
|---|------|------|------|
| G10.01 | Linter 警告ゼロ(`npm run lint` / `npm run lint:html`) | ☐ | |
| G10.02 | 自動テスト全通過(`npm test`、カバレッジ ≥ 80%) | ☐ | 1,277 tests passing(カバレッジは `npm run test:coverage` で確認) |
| G10.03 | 脆弱性スキャン完了(Critical/High ゼロ) | ☐ | |
| G10.04 | クロスレビュー完了(独立判定2名) | ☐ | 監査ラウンド 6–31 を `SPEC.md` §10 に記録 |
| G10.05 | ドキュメント最終確認(README / LICENSE / Schema / UX) | ☐ | |
| G10.06 | PWA 署名ビルド + Lighthouse Performance 90+ | ☐ | スコア記録: |
| G10.07 | ベータ確認(主要フロー全動作・クラッシュゼロ・主観評価 ≥ 4/5) | ☐ | `DEPLOY.md` STEP 7 のシナリオ表を使用 |

判定記法: `☐`(未) / `PENDING` / `CONDITIONAL PASS` / `PASS`。

> G10.06 / G10.07 は実機/ブラウザ実測が要るため、`DEPLOY.md` の STEP 6–7 を実施後に
> `CONDITIONAL PASS` → `PASS` へ更新し、Lighthouse スコアとベータ結果をこの表に追記する。
