# CLAUDE.md — Lensy

## Why

Personal Information Hub. サーバーレス・端末内完結・個人データ漏洩不可。
詳細は `Plan.md` / `goal.md` 参照。

## Map

- `index.html` — PWA本体(全UIロジック)
- `_worker.js` — Cloudflare Worker(ステートレスRSSプロキシ)
- `sw.js` — Service Worker(キャッシュ)
- `manifest.json` — PWA設定 + Share Target
- `Plan.md` — 実装計画(現在 v0.3.0)
- `goal.md` — KPI / マイルストーン(現在 v0.2.0)
- `docs/adr/` — 設計判断記録(未作成、P0着手予定)

## Rules

### 不変条件(G0準拠)

1. **個人データのサーバ送信ゼロ** — Worker は中継のみ、状態保持禁止
2. **ゼロ依存原則** — 外部ライブラリ追加は要ADR、原則禁止
3. **ゼロ設計思考** — 慣性に抵抗、3案比較で選定
4. **Carmack / Martin / Pike** — 性能 / クリーン / 簡潔の3軸採点
5. **絵文字禁止** — UI / ドキュメント全箇所
6. **アクセント色 `#00C4CC`** — CTA / focus / ブランドのみ
7. **Apple HIG準拠** — 視線フロー 見→比較→行動 の3ステップ以内

### 禁止事項

- localStorage / sessionStorage 使用(状態は IndexedDB か メモリのみ)
- 個人情報のサーバ送信
- Worker内での状態保持(KV / Durable Objects 使用は要ADR)
- 文字列 eval / 動的 import の不検証実行
- 競合ソフト名混入(検索置換で残骸残らないよう注意)

### 重要分岐(Human-in-the-loop 必須)

- 認証ロジック変更
- 課金(Stripe)ロジック変更
- 外部API追加
- Plugin Permission モデル変更
- データモデル(InformationEvent)の破壊的変更
- マスターパスフレーズの暗号化方式変更

## Workflows

### 新機能追加

1. Plan.md / goal.md と整合性確認(North Star 4問チェック)
2. ADR起票(影響大の場合)
3. 実装 → 単体テスト → 統合テスト
4. クロスレビュー(AI 2名独立判定)
5. Lighthouse / カバレッジ再計測

### バグ修正

1. 再現テスト追加(先)
2. 修正
3. テスト通過確認
4. CHANGELOG.md に Fixed セクション追記

### リリース

1. G10 全7項目チェック
2. 署名ビルド + クリーンインストール検証
3. CHANGELOG.md 追記
4. タグ付け `v{MAJOR}.{MINOR}.{PATCH}`
5. wrangler pages deploy

## Style

- 日本語ベース、UI は i18n でJA/EN対応
- コードコメントは英語(国際OSS前提)
- 関数 ≤ 40行、引数 ≤ 3、ネスト ≤ 3
- 命名: PascalCase(型)/ camelCase(関数・変数)/ UPPER_SNAKE_CASE(定数)
- AI生成コード箇所は `// AI generated (reviewed)` 注記
