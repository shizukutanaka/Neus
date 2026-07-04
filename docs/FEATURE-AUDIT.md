# FEATURE-AUDIT.md — 機能過不足の監査リスト

**検証日**: 2026-07-02
**対象**: v0.12.0 + Unreleased(ブランチ `claude/word-registration-app-t1kbaq`)
**ステータス**: 全項目コード検証済み(推測による所見は含まない)

## この文書の読み方(AI エージェント向け)

この文書は、複数ラウンドの監査(コード監査+ソクラテス式問答法による機能セット自己吟味)の
**現在の結論**を一覧化したものである。目的は2つ:

1. 将来のセッションが「何が不足しているか」を再調査なしで把握し、着手できるようにする
2. **却下済みの案を再提案しない**ようにする(§2 と §3 が該当。監査のたびに同じ false-positive
   を再発見するコストを削減する)

各主張には grep 可能なアンカー(関数名・識別子・設定キー)を付けてある。行番号は変動するため
使わない。項目を解決または新たに却下した場合は、この文書を更新すること。
監査の時系列の詳細(何をどう反証したか)は `SPEC.md` §10 の各ラウンド記録を参照。

---

## 1. 不足(未対応 — 実装すべき候補)

優先順に列挙。着手時は CLAUDE.md のワークフロー(Plan.md 整合確認 → 影響大なら ADR → 実装 →
テスト → CHANGELOG)に従うこと。

### 1-1. socraticPrompts の優先順位機構【最優先・中規模】

- **問題**: `index.html` の `function socraticPrompts(word,events)` は約18の発火条件を持つが、
  出力は `return out.slice(0,3)` で **push 順の先頭3件** に切られる。優先度・関連度による選別は
  存在しない。条件が同時に多数成立する語では、関数後段に置かれたプロンプト
  (`verdict-churn` / `resolved-from-agnostic` / `only-research` / `disabled-still-open` など)が
  構造的に表示されない(飢餓)。
- **前提条件**: 実装前に、どの条件が実際に同時成立しやすいかの共起分析を行うこと。
  現在も一部は意図的な優先制御がある(例: `falsifier-seen` は先頭 push + stale 系を抑制する
  `!fhits.length` ガード)。この既存の意図を壊さずに全体の順位付けへ一般化する設計が必要。
- **アンカー**: `function socraticPrompts` / `return out.slice(0,3)`

### 1-2. キーワード検知 OS アラート【小〜中規模】

- **問題**: `Plan.md` §4.9 (v1.1) に「通知 / アラート(購読キーワード検知)」とあるが未実装。
  現状 `KeywordRules` の WATCH ルールは一致時に star / highlight / tag しかできず、
  OS 通知は `AutoSync` の「新着 N 件」通知(内容非依存)しか存在しない。
- **実装の入口**: WATCH 一致時に既存の通知経路(`new Notification(...)` を使う
  periodic-poll-request ハンドラ付近のパターン)を拡張する。通知は opt-in にすること。
- **アンカー**: `KeywordRules` / `matched.watch` / `'neus-new'`(通知 tag)

### 1-3. イベント間の関連自動リンク【中規模・要 ADR】

- **問題**: `Plan.md` §4.9 の「関連付け自動化(類似度ベース、リンク自動生成)」が未実装。
  `InformationEvent.links[]` フィールドと `jaccard()` / `tokenize()` 基盤は既にあるが、
  links が使われるのは dedup(同一記事の別URL追記)のみで、「類似するが別の記事」を
  繋ぐ機構は無い。
- **注意**: `links[]` の意味論(現在: 同一記事の別URL)を変える変更のため、
  CLAUDE.md の「データモデルの破壊的変更」に準じて **ADR 起票と人間の承認が先**。
- **アンカー**: `links:[...]` / `function jaccard` / `dedupTitleThreshold`

### 1-4. wrangler 依存の High 脆弱性 5件【中規模・専用環境が必要】

- **問題**: `npm audit --audit-level=high` が `ws` / `undici` / `vite` / `wrangler` /
  `miniflare` の High 5件で失敗する。これは `scripts/release.mjs` のリリースゲートの
  一項目なので、**現状のままではリリース検証が通らない**。
- **リスク評価**: すべて devDependency(wrangler の推移的依存)。出荷される
  `index.html` / `_worker.js` / `sw.js` には一切含まれず、エンドユーザー露出はゼロ。
- **なぜ未対応か**: `npm audit fix` は wrangler のメジャー更新を伴い 60+ の推移的
  パッケージが入れ替わる。`wrangler dev` の動作確認ができる環境で、機能ブランチとは
  分離した専用パスとして実施すべき。
- **アンカー**: `package.json` の `devDependencies.wrangler` / `scripts/release.mjs` の
  `npm audit --audit-level=high`

### 1-5. Plan.md v1.1 の大型項目【大規模・意図的繰延】

- ベクトル検索(IndexedDB 上 HNSW)/ グラフビュー / Tauri デスクトップシェル /
  Bonsai WebGPU オンデバイス推論。`Plan.md` §4.9〜4.10 に定義済みで、繰延は設計判断
  (ADR-0004 / ADR-0006)。欠陥ではないが「不足」としては最大の項目群。

### 1-6. `summarizer.budget-exceeded` トースト連発【小規模・解決済み】

- **問題**: `index.html` の `Summarizer.summarize()` は日次予算超過後、
  `if(s.budget&&dailyCount>=s.budget){Bus.publish('summarizer.budget-exceeded',{});return null;}`
  で毎回イベント発火していた。購読側 `Bus.subscribe('summarizer.budget-exceeded',()=>toast(...))`
  に一度きりのガードが無く、`event.tagged`(新規イベントがタグ付けされるたび)ごとに同じ
  エラートーストが連続表示されていた。POLL/COLLECT ALL で一括取り込みされると特に顕著。
  トーストは `role="status"` の aria-live 領域のため、スクリーンリーダーが同一メッセージを
  連続読み上げるアクセシビリティ上の問題も伴っていた。
- **状態**: 修正済み。`Summarizer` の閉包内に日付キーごとの通知済みフラグを持たせ、
  1日1回のみ通知するように変更。
- **アンカー**: `Bus.publish('summarizer.budget-exceeded',{})` / `budgetNotified`

### 1-7. BYOK 日次予算に `0` を設定すると意味が反転し無制限になる【小規模・解決済み】

- **問題**: 設定画面 `<input type="number" id="set-byok-budget" min="0" value="100">` は `0`
  の入力を許可していたが、保存時 `budget:Number($('#set-byok-budget').value)||0` を経て、
  消費判定 `if(s.budget&&dailyCount>=s.budget)` の短絡評価により `budget:0`(falsy)は
  予算チェック自体をスキップしていた。「日次0件に制限したい」つもりで `0` を入力したユーザーは、
  意図と正反対に無制限に課金が発生していた。
- **状態**: 修正済み。判定を `typeof s.budget==='number'&&dailyCount>=s.budget` へ変更し、
  `0` を明示的な「予算ゼロ=常にブロック」として扱うようにした。
- **アンカー**: `typeof s.budget==='number'&&dailyCount>=s.budget`

---

## 2. 過剰(却下済み — 再提案しないこと)

以下は監査で検討し、**コードを根拠に却下した**案。同じ提案を繰り返さないこと。

| 却下した案 | 却下理由(1文) |
|---|---|
| 反証候補(falsifier hit)を却下した理由の専用フィールド | 既存の `verdict.note`(`verdictNotePatch`)が status を変えずに自由記述でき、その用途を既に担う |
| `curious`(事前信念の既定値)が結論に至った際の問い直しプロンプト | curious はほぼ全語に既定で付くため、発火が常態化し信号がノイズになる(`agnostic` のみ特例化済み = `resolved-from-agnostic`) |
| `gaps.errored`(取得失敗)への silence 型エレンコスプロンプト | 取得失敗は運用障害であり対象についての情報を持たない。沈黙(=信号なしという発見)と混ぜると「死角≠空白」の設計意図を壊す |
| `relatedWords` のエレンコス(問答装置)への組込み | relatedWords はナビゲーション支援(共起発見)であり、探究の妥当性を問う認識論的機構ではない |
| dedup 候補絞込みのための N-gram 転置インデックス | ADR-0019 の `dedupCompareMax=300` への `.slice` 1行で解決済み。個人利用規模に対して過剰設計 |
| `priorBelief` の事後編集 | 編集可能にすると `cognitiveShift`(先入観と裁決の逆転検出)が事後の自己正当化で無効化される。不変が保護機構 |

---

## 3. 設計通りと確認済み(欠陥として再報告しないこと)

監査で「バグでは?」と疑われたが、検証の結果**意図された正しい設計**と確認された項目:

- **`converging` ステータス**: `open` と重複しない。`VERDICT_DIRECTION` で `answered` と同じ
  affirm 方向を担い、「結論へ傾いている」という中間状態を表す。
- **GitHub Topics の `other` 層分類**: `sourceTier` の discussion 判定に github が無いのは
  意図的。リポジトリはコード成果物であり「議論」ではない。
- **Zenn / GitHub の 404-as-silence**: トピックフィードの 404 は「該当トピック無し=信号なし」
  であり取得失敗ではない。`signalGaps` の `topicFeeds` Set で処理。
- **`publishedAt` の非捏造規約**: フィードに日付が無ければ `undefined` のまま。全消費箇所が
  `publishedAt||timestamp` で救済(SPEC.md §6.4 で規約化、回帰テスト有)。
- **`lastFetched` = 収集時の生件数**: 実在件数(dedup/block 後)と乖離するのは仕様。
  実在件数は modal の `countFor` が別途表示。
- **SW の stale-while-revalidate**: デプロイ直後に旧版が1セッション残るのは、cache-first の
  「永遠に古いまま」問題を解消した上での意図的トレードオフ(sw.js 内コメント参照)。
- **VaultMatcher の権限チェック(fail-closed)**: `queryPermission` が unknown を返した場合に
  拒否する挙動は安全側で正しい。「unknown を許可扱い」への変更はセキュリティ後退。
- **StorageGuard の退避対象**: exported+archived のみ自動削除するのは「Vault から復元可能な
  ものだけ消す」不変条件の実装。未エクスポートデータは警告のみで削除しない。

---

## 4. 推奨着手順

1. **§1-1 プロンプト優先順位** — 直近で追加した5プロンプトの価値が実際にユーザーへ届くかを
   左右するため最優先。まず共起頻度の実態調査から。
2. **§1-2 キーワードアラート** — 既存通知経路の小拡張で費用対効果が高い。
3. **§1-3 関連リンク** — ADR 起票と人間の承認を経てから。
4. **§1-4 wrangler 更新** — wrangler dev を検証できる環境で専用ブランチとして。

§1-6・§1-7 は解決済み(2026-07-02)。
