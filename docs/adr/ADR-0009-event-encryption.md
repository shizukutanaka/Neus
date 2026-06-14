# ADR-0009 — Event本文 AES-GCM 暗号化(v1.0計画)

**Date**: 2026-05-12
**Status**: PROPOSED (v1.0 target)

## Context

v0.2.0 時点では APIキーのみ AES-GCM 暗号化されている(Crypto module + sessionPassphrase pattern)。Event本文(`content.title`, `content.snippet`, `content.summary`, `content.body`, `user.note`, `user.quote`)は平文のままIndexedDBに保存されている。

考えられる脅威:
1. **ブラウザ DevTools からの覗き見**: 共用端末で IndexedDB 内容を確認される
2. **Cookie同期/拡張機能**: 悪意ある拡張機能が IDB を読み取り
3. **マルウェア**: ブラウザプロファイルディレクトリへのアクセス
4. **ディスクフォレンジック**: 端末廃棄時のデータ復元

現在の対応:
- HTTPS / SOP / CSP で多層防御
- File System Access API は明示的許可必須
- APIキーのみ暗号化(最重要資産)

## Decision

v1.0 で Event本文の AES-GCM 暗号化を **オプトイン機能** として実装する。

## Rationale

### v0.2.0 で実装しない理由

| 観点 | 評価 |
|---|---|
| 性能 | 10K Event の暗号化/復号は O(N) — 起動時遅延 200ms+ |
| FTS との両立 | 暗号化済みtextからは N-gram索引生成不可、復号後オンメモリ索引 → 起動時間倍増 |
| マイグレーション | 既存ユーザーのデータを変換する仕組みが必要 |
| UX 複雑化 | パスフレーズ忘れ = データロスト の罠が増える |
| 範囲 | コアユーザー(プライバシー重視)以外には過剰機能 |

### v1.0 で実装する理由

| 観点 | 評価 |
|---|---|
| 機能成熟 | v0.2.0 で基本機能完成、品質向上フェーズに移行 |
| 競合差別化 | Feedly/Inoreader はサーバー保管 → クライアントE2Eが訴求点 |
| 法的要件 | EU GDPR / 日本の改正個人情報保護法での「適切な技術的保護措置」要件強化 |
| 信頼境界 | OSレベル(マルウェア/フォレンジック)への防御線を一つ追加 |

## Design (v1.0)

### 暗号化対象フィールド

```js
encryptedFields = [
  'content.title',
  'content.snippet',
  'content.summary',
  'content.body',
  'user.note',
  'user.quote',
];
// excluded: id, timestamp, hash, source, meta.userTags, state.* (検索性能を維持)
```

### マイグレーション戦略

```
v0.x → v1.0 アップグレード:
1. ユーザーが SETTINGS で "Encrypt Event content" を有効化
2. 既存Event を一件ずつ暗号化 → state.encrypted = true マーク
3. FTS索引は復号後にオンメモリ再構築(起動時のみ)
4. パスフレーズ忘れの警告ダイアログ表示
```

### Schema変更

```js
content = {
  title: string,      // either plaintext OR base64(IV + ciphertext)
  ...
}
state = {
  ...
  encrypted: boolean,  // この Event が暗号化されているか
}
```

### 性能影響

- 起動時: 復号 N=10K で 500-1000ms 追加 → スプラッシュ画面で隠す
- 検索: FTS索引はメモリ内なので変更なし(起動時に1回作る)
- 保存: 1 Event 当たり ~2ms 追加 — ユーザー体感無し

## Alternatives Considered

### A. 全Event強制暗号化
**棄却**: パスフレーズ未設定ユーザーには使えない、UX劣化

### B. フィールド単位の細粒度暗号化
**棄却**: 実装複雑、得るものが少ない

### C. SQLCipher 風 transparent encryption
**棄却**: IndexedDB に該当機能がない、自前実装は重い

### D. 既存の VaultWriter 出力のみ暗号化
**棄却**: VaultはユーザーがObsidianで読みたいので暗号化すると本末転倒

## Consequences

- **+**: マルウェア / 物理アクセス耐性向上
- **+**: プライバシー訴求として差別化
- **+**: GDPR / 個人情報保護法での「適切な保護措置」を満たしやすい
- **-**: 起動時間 +500-1000ms
- **-**: パスフレーズ忘れ = データロスト の問題、UI で警告必要
- **-**: テストが複雑化(暗号化ON/OFF両系統)

## North Star 4問チェック

| Q | 評価 |
|---|---|
| Q1 漏洩可能性 | **減**(暗号化レイヤー追加) |
| Q2 運用コスト | 同(サーバーレス維持) |
| Q3 メンテ工数 | **微増**(暗号化ON/OFF 両系統テスト) |
| Q4 法的リスク | **減**(GDPR / 個人情報保護法対応強化) |

## 実装条件

v1.0 リリース前に:
1. パフォーマンス計測(N=1K/10K/100K 暗号化所要時間)
2. パスフレーズ忘れフロー設計(警告 → 部分復旧可否判定)
3. マイグレーション自動化(既存ユーザーへの透過適用)
4. テストスイート拡張(暗号化ON/OFF 両系統で全機能テスト)

## References

- ADR-0002: BYOK 採用(APIキー暗号化の前例)
- WebCrypto API: https://www.w3.org/TR/WebCryptoAPI/
- IndexedDB encryption patterns: https://nolanlawson.com/2021/08/22/encrypted-indexeddb-with-the-web-crypto-api/
