# OPUS.md — Neus 深さレビュー指示書(Opus)

まず `AUDIT-BRIEF.md` を読む。あなたは独立レビュアー。`SONNET.md` の出力は見ない(独立性を保つ)。
製品全体を走査するが、**主レンズは「深さ」** — 少数の高確度・高重大度な欠陥を、実コードの精読と
敵対的自己検証で確定させる。数を稼がない。

## 主対象(深さ)

1. **正確性エッジケース**: 空 / 巨大 / 欠損データ、境界(0件・上限直下/直上)、Promise 競合、
   `await` 後の世代ずれ(`renderView` の `renderSeq` パターン参照)、`IDBKeyRange`・boolean 強制の罠、
   タイムゾーン / 日付窓の off-by-one。
2. **セキュリティ**:
   - `_worker.js` SSRF — `PRIVATE_HOST_RE` のバイパス、リダイレクト再検証(`fetchValidated`)の穴、
     `/json` ホスト許可リスト回避、`readCapped` の抜け。
   - `Crypto` / パスフレーズのライフサイクル — salt 再利用の妥当性、IV 一意性、パスフレーズ変更時の
     旧鍵暗号文残留、`decrypt` 失敗の fail-closed 伝播(`getApiKey` の null 伝播)。
   - XSS 補間の全経路 — `escapeHtml`/`escapeAttr`/`safeHref` を通らない補間が無いか。
3. **データモデル整合性**: `InformationEvent` の生成 / 正規化 / 重複排除 / 保存の一貫性、
   バックアップ復元のアトミック性と検証順序、`FTSIndex` の add/remove 対称性。
4. **レース条件**: ingestion パイプラインの hash gate、`event.stored` のバースト、
   `StorageGuard` の debounce、periodicsync の多重起動。
5. **アーキテクチャ判断**: ADR レベルの是非(ゼロ依存・モノリスの境界、新規モジュールの必要性)。

## 手法

- 各指摘は報告前に**反証を試みる**: 該当コードとその周辺(ガード節・先行チェック)を実際に読み、
  意図的設計や既存ガードで無効化されないか確認。反証できたら報告しない。
- 少数高確度を優先。推測ベースの網羅列挙はしない。
- 高重大度候補は複数観点(correctness / security / reproducibility)で自己検証する。

## 制約

- `AUDIT-BRIEF` §0 のゲート(認証 / 課金 / 外部 API / Plugin Permission /
  `InformationEvent` 破壊的変更 / パスフレーズ暗号化方式)に触れる改善は**実装せず ADR ドラフトまで**。
- §3 の長所は再修正しない。§2 の却下案は再提案しない。
- ソース変更を伴う場合は文字列アンカーテスト・CSP 再生成規律(`AUDIT-BRIEF` §1)を必ず守る。

## 出力

`AUDIT-BRIEF` §5 のフォーマット。最後に「独立レビュー: 他レビュアーの出力は未参照」と明記。
実装まで進めた場合の記録先は `AUDIT-BRIEF` §4。
