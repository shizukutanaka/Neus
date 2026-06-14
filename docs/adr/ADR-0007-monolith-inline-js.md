# ADR-0007 — index.html モノリス + インラインESモジュール採用

**Date**: 2026-05-12
**Status**: ACCEPTED (v0.1.0 — revisit at v0.2.0)

## Context

v0.1.0 で index.html は 120KB の単一ファイル。全機能(Event Bus / Store / FTS / Vault / Crypto / Network / Keyword / Onboarding ...)が `<script type="module">` 内インラインESモジュールに収まっている。

短所(G10判定時に検出):
1. CSP `script-src 'unsafe-inline'` が必須(インラインスクリプトのため)
2. v8 coverage 計測不可(ブラウザ専用インライン)
3. ファイル肥大時のメンテ性低下
4. Diff 表示の困難

## Decision

v0.1.0 はモノリス維持。v0.2.0 で `app.js` への外部化を実施。

## Rationale

### 短期(v0.1.0) で残す理由

| 観点 | 評価 |
|---|---|
| Pike: 単純性 | 1ファイル = 配布が単純 |
| Carmack: 性能 | HTMLとJSが1リクエストで取得、HTTP/2でも僅差 |
| デプロイ | Cloudflare Pages に index.html を置くだけ |
| Service Worker キャッシュ戦略 | 1ファイル前提で設計済(stale-while-revalidate) |
| Subresource Integrity | 単一ファイルのため不要 |
| 開発速度 | 機能間の依存解決不要、即座に追加可能 |

### 長期(v0.2.0) で外部化する理由

| 観点 | 評価 |
|---|---|
| CSP 強化 | `script-src 'self'` のみで完結、`'unsafe-inline'` 除去 |
| 並列キャッシュ | index.html(改変頻度高) と app.js(改変頻度低) を分離 |
| ツール対応 | bundler / minifier / source map 適用可能 |
| カバレッジ | vitest がエンドツーエンドで計測可能 |
| diff レビュー | 機能別ファイル分割で PR が読みやすい |

## North Star 4問チェック

1. 漏洩可能性増やすか? → No(機能不変)
2. 運用コスト増やすか? → No
3. メンテ工数恒久増か? → **短期No / 長期Yes**(現状の単純性を捨てる)
4. 法的リスク増やすか? → No

短期の Yes、長期の No が逆転する閾値: index.html ≥ 200KB または ファイル機能が 16 モジュール超。

## v0.2.0 外部化計画

```
v0.1.0
  index.html (120KB, インライン)

v0.2.0
  index.html (15KB, HTML/CSSのみ)
  app.js     (105KB, ES module)
  app.js.map (source map)
  sw.js (更新)
```

外部化時の作業:
1. `<script type="module">` の中身を `app.js` に移動
2. `<script type="module" src="/app.js"></script>` に置換
3. `_headers` の CSP を `script-src 'self'` に変更
4. `sw.js` の cache に `/app.js` を追加
5. `check-html.mjs` を `check-app-js.mjs` に分離
6. v8 coverage を `app.js` 対象で計測、80% 達成

## Consequences

- v0.1.0 リリース時の Known Limitations に「CSP `'unsafe-inline'` 必須」を明記
- v0.2.0 マイルストーンに「JS外部化 + CSP厳格化」を追加
- 外部化までは check-html.mjs が品質ゲートを担う
- v0.1.x パッチリリース時は内部化のまま継続(機能追加優先)

---

## Update (v0.10.0, 2026-05-30): CSP strengthening without externalization

### 再評価
v0.2.0で計画した外部化は、その後の進化で見送りが妥当と判断:
- stale-while-revalidate(v0.7.0)、SW更新通知、単一ファイル配布が深く根付いた
- 外部化は「1ファイル配布の単純性」というNeusの核心的価値を損なう
- HTTP/2環境では1リクエスト取得の性能差は僅少

### 代替策: ハッシュベースCSP + 攻撃面の厳格化
外部化せずにXSS耐性を最大化:

1. **本番(_headers)**: `script-src 'self' 'sha256-...'` — インラインスクリプトのハッシュを許可し **`unsafe-inline`を完全除去**。`scripts/compute-csp-hash.mjs`で自動計算
2. **メタタグ(フォールバック)**: file://やヘッダー未対応環境向け。`unsafe-inline`を持つが、本番では_headersが優先
3. **インラインイベントハンドラ除去**: フォントの`onload`属性をJS化(CSP違反要素の排除)
4. **攻撃面の厳格化**: `object-src 'none'`、`base-uri 'self'`、`form-action 'none'`、`frame-ancestors 'none'`(_headers)、`connect-src`をWorker+API許可リストに限定

### 整合性保証
- `check-html.mjs`に**CSPハッシュ整合性チェック**を追加
- スクリプト変更時にハッシュ更新を忘れると本番でアプリが壊れる → CIで即検出
- 実ブラウザ77 E2Eで全機能がCSPと衝突しないことを実証

### Status: 外部化は恒久的に見送り、ハッシュベースCSPで代替(ACCEPTED)
