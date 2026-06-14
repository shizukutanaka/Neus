# Security Policy

## サポート対象バージョン

| Version | Supported |
|---|---|
| 0.2.x   | YES |
| 0.1.x   | NO (upgrade推奨) |

## 脆弱性報告

セキュリティ問題を発見した場合、**公開Issueに投稿しないでください**。

代わりに以下のいずれかで報告:

1. **GitHub Security Advisory** (推奨): https://github.com/shizukutanaka/neus/security/advisories/new
2. **Email**: 該当時にREADMEで案内

24時間以内に初回応答、72時間以内に対応方針を共有します。

## 対応プロセス

1. 報告受領 → 24h以内に確認応答
2. 影響範囲の調査 → 7日以内
3. パッチ作成 → 30日以内(CVSS Highの場合7日以内)
4. CVE申請(該当時)
5. リリース + 報告者クレジット(任意)

## セキュリティモデル

### 信頼境界

```
┌─────────────────────────────────────────────────┐
│ ブラウザ端末(信頼)                              │
│  - index.html                                   │
│  - IndexedDB(暗号化APIキー / イベント / 設定)│
│  - File System Access(Vault — readwrite)       │
│  - WebCrypto(AES-GCM / PBKDF2)               │
└──────────────────┬──────────────────────────────┘
                   │ HTTPS (TLS 1.2+)
┌──────────────────▼──────────────────────────────┐
│ Cloudflare Worker(信頼境界外、ステートレス)   │
│  - _worker.js: RSS-only proxy                   │
│  - 認証なし・ログなし・State保持なし            │
│  - SSRF防止(プライベートIP拒否)                │
└──────────────────┬──────────────────────────────┘
                   │ HTTPS (TLS 1.2+)
┌──────────────────▼──────────────────────────────┐
│ 第三者 RSS / API サーバー(信頼境界外)         │
│  - HTTPS Public RSS feeds                       │
│  - Anthropic / OpenAI / Gemini APIs(BYOK)     │
└─────────────────────────────────────────────────┘
```

### データの流れ

| データ | 保管場所 | 暗号化 | サーバー送信 |
|---|---|---|---|
| APIキー | IndexedDB | AES-GCM(パスフレーズ設定時) | なし |
| パスフレーズ | メモリのみ(sessionPassphrase) | なし | なし |
| Event本文 | IndexedDB | なし(v1.1で実装予定) | なし |
| Vault content | ローカルファイル | なし(OSが管理) | なし |
| サーバーログ | なし | - | - |

## 既知の脅威モデル

| 脅威 | 対策 | 状態 |
|---|---|---|
| XSS via RSS content | `escapeHtml` 全箇所適用 | 対策済 |
| XSS via DOM injection | `innerHTML` は信頼済みデータのみ | 対策済 |
| SSRF via Worker proxy | プライベートIP拒否 / Content-Type検証 | 対策済 |
| Tampering(改竄) | Cloudflare Pages → TLS / Sigstore署名 | 対策済 |
| MITM | HSTS / TLS強制 | 対策済 |
| Brute-force on passphrase | PBKDF2 300,000 iterations | 対策済 |
| API key 漏洩(ブラウザ侵害) | AES-GCM暗号化 + メモリのみのパスフレーズ | 対策済 |
| API key 漏洩(LocalStorage) | LocalStorageを使用しない | 対策済 |
| Periodic Sync abuse | `periodicsync` イベントは同一origin限定 | SW仕様で保証 |
| Notification spam | ユーザーopt-in必須 | 対策済 |
| CSP bypass | `script-src 'self' 'unsafe-inline'` | 一部緩和(v0.3.0で完全化) |

## CSP制限の明示

v0.2.0では index.html のインラインESモジュールのため、CSPに `'unsafe-inline'` が必要。これによりインラインXSSへの防御力が弱まる。

緩和策:
- 全Event入力に `escapeHtml` 適用
- innerHTML は CONFIG / DICT などの信頼データのみ使用
- v0.3.0 で外部JS化 + `script-src 'self'` 厳格化を予定(ADR-0007)

## 監査

- 自動: GitHub Actions で `npm audit`(毎push)、`gitleaks`(シークレットスキャン)
- 静的: `scripts/check-html.mjs` 33点(セキュリティ確認10点含む)
- テスト: `tests/worker.test.mjs` SSRF防止41件

## 開示ポリシー

Coordinated Disclosure を採用:

- 報告者の承諾なしに公開しない
- パッチリリース後、報告者クレジット(任意)
- CVE申請は CVSS 7.0以上で実施

## 連絡先

- GitHub Security Advisory(推奨)
- 緊急時のみ: README記載のメール
