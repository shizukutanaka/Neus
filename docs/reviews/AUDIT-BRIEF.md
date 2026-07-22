# AUDIT-BRIEF — Neus クロスレビュー共有指示書

CLAUDE.md「クロスレビュー(AI 2名独立判定)」を運用可能にした具体ブリーフ。**Opus レビュアーは
`OPUS.md`、Sonnet レビュアーは `SONNET.md`** を主指示書とし、両者ともまず本ファイルを読む。
両者は**互いの出力を読まず独立に**レビューし、最後に人間が突き合わせる(独立性が交差検証の価値の
源泉。片方の結論に引きずられないこと)。

対象: Neus v0.13.0(local-first Personal Information Hub PWA)。現行仕様の正は `SPEC.md`、
変更履歴は `CHANGELOG.md`、過不足の台帳は `docs/FEATURE-AUDIT.md`、設計判断は `docs/adr/`。

---

## 0. 絶対規則(逸脱不可)

### 不変条件(CLAUDE.md G0)
1. 個人データのサーバ送信ゼロ — Worker は中継のみ、状態保持禁止
2. ゼロ依存原則 — 外部ライブラリ追加は要 ADR、原則禁止
3. ゼロ設計思考 — 慣性に抵抗、3案比較で選定
4. Carmack / Martin / Pike — 性能 / クリーン / 簡潔 の3軸採点
5. 絵文字禁止 — UI / ドキュメント全箇所
6. アクセント色 `#00C4CC` — CTA / focus / ブランドのみ
7. Apple HIG 準拠 — 視線フロー 見→比較→行動 の3ステップ以内

### 禁止事項
localStorage / sessionStorage 使用 / 個人情報のサーバ送信 / Worker 内での状態保持(KV・DO は
要 ADR)/ 文字列 eval・動的 import の不検証実行 / 競合ソフト名(旧名 "Lensy")混入。

### 重要分岐(Human-in-the-loop 必須 — 編集せず ADR を起票して停止)
認証ロジック / 課金(Stripe) / 外部 API 追加 / Plugin Permission モデル /
データモデル(InformationEvent)の破壊的変更 / マスターパスフレーズの暗号化方式変更。
**これらに触れる改善は「提案 + ADR ドラフト」までで止め、実装しない。**

### Style(コード変更時)
関数 ≤ 40 行 / 引数 ≤ 3 / ネスト ≤ 3。命名 PascalCase(型)/ camelCase(関数・変数)/
UPPER_SNAKE_CASE(定数)。コメントは英語。AI 生成箇所は `// AI generated (reviewed)`。
UI は i18n で JA/EN 両対応。

---

## 1. 検証規律(ここを外すと必ず壊す)

- **テスト**: `npm test`(vitest、現在 ~1,277 件)。バグ修正は再現テストを先に足す。
- **文字列アンカーテスト(最重要の落とし穴)**: 多くのテストが**ソースの正確な文字列**を
  `expect(html).toContain('…')` で検証し、`_worker.js` のロジック(例 `PRIVATE_HOST_RE`)は
  テスト側に**コピーを複製し "stays in sync via ci check" として二重管理**している。
  → `index.html` / `_worker.js` を1文字でも変えたら、対応するミラー文字列・アンカーテストを
  同時に更新する。「ソースだけ直してテスト赤」は典型的な事故。
- **CSP ハッシュ再生成**: `index.html` のインライン `<script>`/`<style>` を変えたら必ず
  `npm run build:csp`(`scripts/compute-csp-hash.mjs`)。`scripts/check-html.mjs` が `_headers` と
  メタ CSP のハッシュ一致・a11y/security 不変条件を検証。`npm run lint:html` で確認。
- **lint**: `npm run lint`(`node --check`)+ `npm run lint:html`。
- **INP/性能**: 全件スキャンは `i%100===0` で yield(`FTSIndex.rebuild` 参照)。新たな同期全件
  処理を足さない。

## 2. アーキテクチャ地図

- **`index.html`**(~4,900 行、ゼロ依存インライン ES モジュール): トップレベル IIFE モジュール群
  `Store`(IndexedDB)/ `Bus`(pub-sub)/ `Crypto`(AES-GCM+PBKDF2)/ `VaultWriter` /
  `FTSIndex`(N-gram + BM25 風 IDF)/ `VaultMatcher` / `KeywordRules` / `RSSPoller` /
  `WordCollector` / `TagLearner` / `InterestProfile` / `Summarizer`(BYOK)/ `MarkdownExporter` /
  `WordExporter` / `StorageGuard` / `SourceFailTracker` / `AutoSync` / `ShareTarget` /
  `Onboarding` / `Perf` ほか。Plugin API は `window.neus`(`Object.freeze`、返却は `structuredClone`)。
- **`_worker.js`**(~240 行、ステートレス Cloudflare Worker): `/rss` と `/json` のみ。SSRF は
  `PRIVATE_HOST_RE`(IPv4 + WHATWG hex 正規化 IPv6)+ `fetchValidated`(全リダイレクトホップ
  再検証、上限5)+ `/json` ホスト許可リスト + `readCapped`。無状態・無ログ。
- **`sw.js`**(~130 行): `neus-shell-v3`、shell は stale-while-revalidate、periodicsync は単一
  タブへ委譲、起床通知は Cache API 経由の同意ミラー参照。

## 3. 現状の長所/短所(着手前に `docs/FEATURE-AUDIT.md` を必読)

**長所(§3「確認済み」— 直す対象にしない)**: XSS 補間衛生の徹底 / 復元アトミック性 /
Worker SSRF 多層防御 / FTSIndex 整合性 / StorageGuard「Vault 復元可能物だけ削除」/
SourceFailTracker 健全リセット + 内部エラー除外 / periodicsync 単一委譲 / VaultMatcher
fail-closed / `publishedAt` 非捏造。

**短所・改善(§1)**:
- 要 ADR(勝手に実装しない): 関連リンク §1-3 / ベクトル検索 §1-5 / wrangler §1-4 / 外部調査 §1-10。
- 記録のみ: `normalizeUrl` 強化(**⚠ 既存 hash 不一致 = 一時的重複窓。jaccard 救済範囲確認後のみ**)/
  「fetched N」意味不一致(ingestion 待ち合わせ機構が要る中〜大改修。カウンタ差し替えでは直らない)/
  skipWaiting(この環境で SW ライフサイクル検証不能、取り消し済み。信頼できる検証手段が無い限り
  再投入しない)。

**再提案禁止(§2 却下済み)**: モノリス分割・外部依存追加(ADR-0007 恒久却下)等。

## 4. 記録先(実装まで進めた場合)
`SPEC.md` の `### 10.N 第M次監査` を新設(現在 §10.20 / round 31。次は §10.21)/ `CHANGELOG.md` の
`[Unreleased]` / `docs/FEATURE-AUDIT.md` の該当 §1 更新 / 設計判断は `docs/adr/` の次番号(`ls` で確認)。

## 5. 出力フォーマット(両者共通)

```
- [重大度: high|medium|low] <一文の欠陥>
  - file: <repo 相対パス>
  - anchor: <関数名 or 一意な安定文字列。行番号でなく>
  - failure: <具体入力/状態 → 誤動作/クラッシュ の再現筋>
  - fix: <最小修正。ゲート抵触なら「要 ADR」明記>
```

高重大度は**実コードを読んで再現を確認してから**報告する。ゲート抵触は実装せず ADR 明記。
