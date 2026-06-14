# ADR-0006 — Bonsai 1.7B WebGPU オンデバイス推論採用(v1.1)

**Date**: 2026-05-12
**Status**: ACCEPTED (v1.1 target)

## Context

v1.0 の BYOK(Bring Your Own Key)方式では、API キー未設定ユーザーが要約機能を利用できない。
v1.1 のフォールバックオプションとして、ブラウザ内完結型のローカル LLM を検討した。

旧案(Plan.md 初版): WebLLM + Llama 3.2 1B (~700MB)
新案: Bonsai 1.7B (~290MB) + WebGPU

## Decision

v1.1 で Bonsai 1.7B(PrismML、1-bit 量子化) を WebGPU で実行するオンデバイス推論を追加する。

- BYOK 未設定時のフォールバックとして自動提示
- WebGPU 非対応ブラウザでは BYOK または要約スキップに fallback
- モデルウェイト(290MB GGUF)は Cache API でキャッシュ、2回目以降は即起動

### ゼロ依存例外(ADR-0006-E1)

WebGPU compute shader を直接記述するか、WebGPU ランタイム(MLC WebLLM または Transformers.js)を CDN 経由で lazy load するかを選択する。

**判定**: CDN lazy load を許容。理由:
- WebGPU compute shader の自前実装は数千行規模(Pike: 複雑すぎる)
- CDN script は `import()` で遅延読み込み、Bonsai選択時のみ実行
- index.html の初期サイズ・パフォーマンスに影響しない
- ADR として明示することでゼロ依存原則からの逸脱を可視化

## Rationale

### Bonsai vs 旧案(WebLLM + Llama 3.2 1B)

| 比較項目 | Bonsai 1.7B | Llama 3.2 1B |
|---|---|---|
| サイズ | 290MB | ~700MB |
| 品質 | Llama 3.2 7B クラス相当 | 1B相応 |
| ライセンス | **Apache 2.0** | MIT/Llama license |
| ブラウザ実行 | WebGPU(HFデモ実証済) | WebLLM経由 |
| リリース | 2026年3月(新鮮) | 2024年(枯れている) |
| 商用制限 | **ゼロ** | Meta制限(700M MAU超) |

### ライセンス確認(必須)

- **Apache 2.0**: 商用利用・改変・再配布を無制限許可
- Meta Llama ライセンスと異なりユーザー数制限なし
- Khosla Ventures($16.25M)が支援、持続性リスク低
- AnythingLLM がリリース当日に統合 → エコシステム採用を確認

### North Star 4問

1. 漏洩可能性増やすか? → **No**(端末内完結、APIキー不要、通信ゼロ)
2. 運用コストを増やすか? → **No**($0、HuggingFaceから無料DL)
3. メンテ工数恒久増か? → **Low**(モデル更新は任意、BYOK fallback が常時有効)
4. 法的リスク増やすか? → **No**(Apache 2.0 確定済み)

## Consequences

- 初回起動時に290MBダウンロードが発生(オプトイン形式)
- WebGPU 非対応(Firefox, Safari 現状)では BYOK fallback に縮退
- 要約プロンプト最適化: Bonsai は英語プロンプトでの性能が高い傾向
- v1.1 リリース前に Bonsai 1.7B + WebGPU の実機検証が必要(G3.2 判定: 2026年3月リリース、v1.1まで半年の実績蓄積を待つ)
- CHANGELOG.md に「ゼロ依存例外: WebGPU ランタイム」を明記
