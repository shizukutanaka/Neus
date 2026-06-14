# ADR-0011 — FTS IDF重み付け検索 + オンデバイスRSの優位性記録

**Date**: 2026-05-30
**Status**: ACCEPTED (v0.4.1で実装)

## Context

arxiv.org から全文検索ランキングとプライバシー保護パーソナライゼーションの研究を調査(第2回)。ゼロ依存・ローカルファースト制約下で適用可能な知見を抽出した。

## 調査した研究と判断

### 採用: BM25のIDF概念をFTSに導入

| 研究 | 知見 |
|---|---|
| BM25-V (arxiv 2603.05781) | BM25のIDFがありふれた語を下げ、稀少で識別力のある語を強調する |
| Hybrid Search分析 (arxiv 2508.01405) | BM25は非線形TF飽和と文書長正規化の2ヒューリスティックを持つ |
| OpenSearch最適化 (arxiv 2411.04403) | 高IDFトークンで予備検索→全トークンで再ランクが効率的 |

**問題**: 現状のFTSスコアは `score = ヒットgram数 / クエリgram数` で、全gramを等価扱い。
ありふれたgram("の", "ing")と稀少gram("rust")が同じ重み → 検索精度が低い。

**実装**: 各gramにIDF重みを導入。
- `IDF = log(1 + (N - df + 0.5)/(df + 0.5))` — BM25のIDF式(常に正)
- df = そのgramを含む文書数(index.get(gram).size で取得済み)
- スコア = Σ(マッチgramのIDF) / Σ(全クエリgramのIDF) — 0〜1正規化
- TF項はNeusがSetベース(gram有無)のため省略し、文書間のIDF重み付けで近似

### 設計の正しさの裏付け: オンデバイスRS

| 研究 | 知見 | Neusとの関係 |
|---|---|---|
| Apple特許 11907963 (オンデバイスRS) | デバイス上で個人データからユーザーベクトル生成、デバイス上モデルで判定 | Neusは既にこれを体現(全ローカル) |
| Federated News Rec (arxiv 2507.15460) | クライアントが勾配をサーバー集約、Shamir秘密分散で保護 | **却下**: サーバー必須 |
| Privacy-Utility trade-off (arxiv 2511.22515) | DP機構は一貫してプライバシー強化するが有用性を下げる | Neusはサーバー送信ゼロ → DP不要 |

**結論**: 連合学習・差分プライバシーは「サーバーにデータを送る前提」での保護技術。
Neusはそもそもサーバー送信がゼロ(全処理ローカル)なので、これらの保護機構が**原理的に不要**。
これはオンデバイスRSの理想形であり、Neusの設計の正しさを裏付ける。新規実装は不要。

### 却下(制約に反する)

| 研究 | 却下理由 |
|---|---|
| Federated Learning推薦 | サーバー集約必須。サーバーレス制約に反する |
| 学習スパース表現(SPLADE等) | ニューラルモデル学習が必要。ゼロ依存に反する |
| LLMリランキング (InsertRank) | クラウドLLM依存 |

## Decision

FTS検索のスコアリングを単純ヒット数からIDF重み付けに変更。プライバシー機構は現状(全ローカル)を維持し、新規実装しない。

## Consequences

- **+**: 検索精度向上 — 稀少語(識別力の高い語)を含む文書が上位に来る
- **+**: スコアが0〜1に正規化され、ftsScoreMin閾値の意味が明確に
- **+**: 性能影響なし(実測 median 0.5ms @1000件、IDF計算はO(マッチ文書数))
- **+**: ゼロ依存・ローカル完結を維持
- **-**: TF(用語頻度)は考慮しない(Setベースのため)。短文main検索では十分だが、長文では精度の上限あり

## North Star 4問チェック

| Q | 評価 |
|---|---|
| Q1 漏洩可能性 | 不変(ローカル処理) |
| Q2 運用コスト | 不変 |
| Q3 メンテ工数 | 不変(数式のみ、保守対象増えず) |
| Q4 法的リスク | 不変 |

## References

- BM25-V Sparse Visual Word Scoring: https://arxiv.org/pdf/2603.05781
- Balancing the Blend (Hybrid Search): https://arxiv.org/html/2508.01405v2
- OpenSearch IDF heuristic: https://www.arxiv.org/pdf/2411.04403
- On-device privacy-preservation (Apple): https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11907963
- Privacy-Utility-Bias Trade-offs: https://arxiv.org/abs/2511.22515
