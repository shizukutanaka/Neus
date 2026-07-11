# FEATURE-AUDIT.md — 機能過不足の監査リスト

**検証日**: 2026-07-10
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

### 1-1. socraticPrompts の優先順位機構【解決済み・round 26 で補正】

- **問題**: `index.html` の `function socraticPrompts(word,events)` は約20の発火条件を持つが、
  出力は `return out.slice(0,3)` で **push 順の先頭3件** に切られていた。優先度・関連度による
  選別は存在せず、条件が同時に多数成立する語(例: 無効化 + 問い未設定 + ソース沈黙 +
  未確認10件超、といった「よくある放置状態」でも容易に4件以上同時成立する)では、関数後段の
  プロンプト(`verdict-churn` / `resolved-from-agnostic` / `only-research` /
  `disabled-still-open` 等)が構造的に表示されない(飢餓)ことをコードで確認した。
- **共起分析の結果**: `verdict==='open'` の語だけでも `falsifier-seen` / `certain-unresolved` /
  `verdict-churn` / `disabled-still-open` / `no-questions` / `silence` / `unreviewed` の
  最大7条件が独立に同時成立し得る(相互排他ではない)。starvation は理論上ではなく実際に
  起こり得ると判断し、実装に進んだ。
- **状態**: 修正済み。関数冒頭のコメントで既に宣言されていた優先順位
  「結論の妥当性 > 反証条件 > 証拠の質 > 自己矛盾 > 探究の怠り」を
  `TIER_VALIDITY=1,TIER_FALSIFIABILITY=2,TIER_EVIDENCE=3,TIER_CONTRADICTION=4,TIER_NEGLECT=5`
  として数値化し、各 `out.push()` に `tier` を付与。末尾で
  `out.sort((a,b)=>a.tier-b.tier)` してから `slice(0,3)` する(Array.sort は ES2019+ で
  安定ソートのため、同一 tier 内は既存の push 順=優先意図を保ったまま)。
  既存の各 if/else-if ブロック内の相互排他性(例: falsifier-seen が stale 系を抑制)は無変更。
- **round 26 の補正**: 独立レビューで、同一 tier 内の条件が全て相互排他とは限らないと
  発覚(例: `certain-unresolved` と `disabled-still-open` は共起しうる)。同一 tier が
  並ぶと Array.sort の安定性=push 順に戻り、tier 内で同じ飢餓が再発していた。相互排他が
  保証されない条件に小数のサブ優先度(`TIER_CONTRADICTION+0.1` 等)を付与して解消。
- **アンカー**: `const TIER_VALIDITY=1,TIER_FALSIFIABILITY=2,TIER_EVIDENCE=3,TIER_CONTRADICTION=4,TIER_NEGLECT=5;` /
  `out.sort((a,b)=>a.tier-b.tier);` / `tier:TIER_CONTRADICTION+0.1`
- **残債解消(round 27)**: `socraticPrompts` 自体は CLAUDE.md の関数 ≤40行規約を約95行で
  超過していた。tier ごとの判定を5つのヘルパー関数(`validityPrompts`/
  `falsifiabilityPrompts`/`evidencePrompts`/`contradictionPrompts`/`neglectPrompts`)へ
  切り出す refactor で解消(各12〜24行)。`socraticPrompts` は5関数の出力を連結し、
  `sort`+`slice(0,3)` するだけの13行の集約関数になった。tier定数・各条件のロジック・
  発火文言・優先順位(小数サブ優先度含む)は一切不変(振る舞いのテストは全て既存の
  ままパス)。「`function socraticPrompts` 内に留まる」ことを前提に書かれていた5件の
  index.html 文字列位置アサーション(`tests/word-prompt-priority.test.mjs` 等)は
  該当ヘルパー関数の範囲を見るよう更新。
- **アンカー**: `function validityPrompts(word,events){` / `function contradictionPrompts(word,events){` /
  `...validityPrompts(word,events),...falsifiabilityPrompts(word),...evidencePrompts(word,events),...contradictionPrompts(word,events),...neglectPrompts(word,events),`

### 1-2. キーワード検知 OS アラート【解決済み】

- **問題**: `Plan.md` §4.9 (v1.1) に「通知 / アラート(購読キーワード検知)」とあったが未実装
  だった。`KeywordRules` の WATCH ルールは一致時に star / highlight / tag しかできず、
  OS 通知は `AutoSync` の「新着 N 件」通知(内容非依存)しか存在しなかった。
- **状態**: 修正済み。WATCH ルールに独立した `notify` 真偽値フィールドを追加(既存の
  `action`(star/highlight/tag)とは排他ではなく併用可能 — 「スターしつつ通知」の
  ような組み合わせが自然なため)。簡易UIに `#kw-watch-notify` チェックボックスを追加し、
  ON で保存すると `AutoSync.requestNotificationPerm()`(既存の許可リクエストヘルパーを再利用)
  を呼ぶ。パイプラインは block によるアーカイブ後は抑制(star/highlight/tag と同じ block優先
  規約)し、同一 tag `'neus-watch'` で通知を出すため連続一致で通知が積み上がらない
  (最新の一致に置き換わる)。
- **アンカー**: `id="kw-watch-notify"` / `const notifyRule=matched.watch.find(r=>r.notify);` /
  `tag:'neus-watch'`

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
- **2026-07 外部調査による更新(ベクトル検索のみ)**: 査読済み論文 WebANNS
  (ACM SIGIR 2025、arXiv:2507.00521、DOI 10.1145/3726302.3730115)が、Wasm+
  IndexedDB遅延ロード+メモリ管理ヒューリスティクスの3技法で、ブラウザ内ANN検索の
  P99レイテンシを従来比最大743.8倍改善(約10秒→約10ms)、メモリ最大39%削減と報告。
  「ブラウザでは時期尚早」という繰延理由への直接の反証となる新証拠。ただし研究
  プロトタイプであり監査可能な出荷ライブラリではなく、数値は著者自己申告
  (独立再現なし)。**この記述自体は ADR-0004/0006 を覆さない** — 覆すには新規 ADR
  起票+人間の承認が必要(選択肢: (a)繰延継続 (b)同3技法の最小自前実装
  (c)将来の成熟ライブラリのベンダリング)。ベクトル検索以外の項目(グラフビュー等)の
  繰延判断に変化なし。

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

### 1-8. findByHash→putEvent の hash 重複レコード競合【解決済み・round 26 で補正】

- **問題**: `Store.findByHash`→`Store.putEvent` は非アトミックな check-then-act。
  `Bus.publish` は fire-and-forget(購読ハンドラを await しない)で、`_collectOne` は
  1単語の全有効フィードを `Promise.all` で並行取得するため、同一記事が2つの異なる
  ソースから取得されると、複数の書き込み経路(`event.normalized` / `ShareTarget.ingest` /
  ドシエ import)が「未存在」を読んでから書き込み、重複レコードを作り得た。`hash`
  インデックスは意図的に `unique:false`(unique 制約にすると、このバグに起因する既存の
  重複ハッシュを持つインストールで IDB スキーマアップグレード自体が失敗するリスクがあり、
  競合そのものより危険)。
- **round 25 の初回修正には2つの欠陥が独立レビューで発覚**: (1) 「先行を読んで await
  してから自分のゲートを map に書く」方式は2者間の競合しか正しく直列化できず、3者以上が
  同時到達すると2番目・3番目が互いのゲート登録を追い越し合い、同じ競合が再現していた。
  (2) ゲートは `event.normalized` にのみ適用され、同じ非アトミック性を持つ
  `ShareTarget.ingest` とドシエ import ループは無防備だった。
- **状態**: 修正済み(round 26)。共有ヘルパー `withHashGate(hash,fn)` に一般化し、
  map への書き込みを await 前に同期的に行う keyed-promise-chain
  (`(hashGates.get(hash)||Promise.resolve()).then(fn,fn)`)へ変更(N者間の直列化を
  正しく保証)。`event.normalized`・`ShareTarget.ingest`・ドシエ import の3経路全てが
  この共有ヘルパーを経由する。`InformationEvent` のスキーマ・IndexedDB インデックス・
  `links[]` の意味論には一切触れない、純粋な内部並行制御機構(データモデル変更ではない)。
- **アンカー**: `const hashGates=new Map();` / `function withHashGate(hash,fn){` /
  `const chained=(hashGates.get(hash)||Promise.resolve()).then(fn,fn);`

### 1-9. Vault エクスポートのテンプレートカスタマイズ【小〜中規模・外部調査由来の採用候補】

- **出所**: 2026-07 の外部調査(敵対的3票検証済み、確信度: 高)。PKM同期の業界標準である
  Readwise 公式 Obsidian プラグインは、エクスポート形式をユーザー編集可能な Jinja2
  テンプレートで制御できる(見出し・メタデータ・タグの出方を利用者が決める)。
- **現状**: Neus の Vault 書き出し(イベント単票・単語ドシエとも)は固定形式。
  frontmatter のキー構成や本文セクションの並びを利用者が変えられない。Obsidian 側の
  既存 Vault 規約(Dataview クエリ、テンプレートプラグイン等)に合わせたい利用者は
  書き出し後に手修正するしかない。
- **方向性**: 外部依存ゼロのまま、`{{title}}` / `{{url}}` / `{{tags}}` 程度の最小
  プレースホルダ置換によるテンプレート文字列を設定画面に持たせる案(Jinja2 のような
  制御構文は不要 — ループ・条件分岐を入れると eval 相当の複雑性とセキュリティ面の
  検討が必要になり、ゼロ依存・簡潔原則に反する)。frontmatter は YAML 破壊を防ぐため
  `yamlScalar()` エスケープを必ず通すこと。
- **注意**: `InformationEvent` のスキーマには触れない(出力形式のみ)。着手時は
  CLAUDE.md ワークフロー(Plan.md 整合確認 → 実装 → テスト → CHANGELOG)に従う。
- **アンカー**: `function yamlScalar` / `## 定義` (ドシエ組み立て) / `mdImgLink`

### 1-10. 外部調査の未完了トラック【調査タスク・コード変更なし】

- **出所**: 2026-07 の外部調査は4トラック構成だったが、Track 3(反証可能性・自問UXの
  HCI研究 — 本プロダクト最大の独自機能であるソクラテス式問答装置の学術的裏付け)と
  Track 4(BYOK APIキーのブラウザ保存・CSP強化・SSRF安全プロキシ設計の 2024-2026 年の
  CVE/ベストプラクティス — 最もセキュリティ敏感な面)で検証を生き残った主張がゼロだった。
- **意味**: 「関連文献・勧告が存在しない」という結論ではなく「この調査パスでは検証可能な
  主張を抽出できなかった」という空白。候補ソース自体は見つかっている(例: CHI 2025 の
  認知バイアス HCI スコーピングレビュー、DOI 10.1145/3706598.3713450)ため、
  該当文献を直接読む専用フォローアップ調査が次の一手。
- **アンカー**: (コードなし)`docs/FEATURE-AUDIT.md` 本項

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
| `index.html` インラインスクリプトを `app.js` へ外部化(v8 coverage 計測のため) | **既に検討・恒久却下済み(ADR-0007)**。v0.2.0 で計画されたが v0.10.0 で永久見送りに再評価: 「1ファイル配布の単純性」という核心的価値を損なう。代替としてハッシュベース CSP + `check-html.mjs`(52項目静的検査)+ 大量の文字列固定テストを品質ゲートとして採用済み。`vitest.config.js` の coverage 設定コメントに同じ経緯が明記されている。**coverage% が計測不能なのは既知・受容済みのトレードオフであり、再提案しないこと** |
| `priorBelief` の事後編集 | 編集可能にすると `cognitiveShift`(先入観と裁決の逆転検出)が事後の自己正当化で無効化される。不変が保護機構 |
| CRDT(Automerge)によるマルチデバイス同期基盤 | 2026-07 外部調査で検討。Automerge v3 は大幅成熟(メモリ約10分の1、Ink & Switch 専任保守)したが Rust/WASM 外部依存でゼロ依存原則に抵触し、かつ Neus にマルチデバイス同期の要件自体が存在しない(単一端末+IndexedDB で完結)。要件が生まれたら ADR から再検討 |
| 既製のブラウザ内ベクトル検索ライブラリ導入(client-vector-search / ruvector-wasm) | 2026-07 外部調査で検討。前者は transformers.js+約30MBモデル同梱で依存過多、後者は2025年11月誕生・単独保守で成熟度不足。ベクトル検索自体の再評価は §1-5 の WebANNS 注記を参照(要ADR) |

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

1. **§1-9 Vault エクスポートのテンプレート化** — 人間の承認ゲート不要で着手可能な唯一の
   採用候補(出力形式のみ、データモデル不変)。
2. **§1-3 関連リンク** — ADR 起票と人間の承認を経てから。
3. **§1-10 フォローアップ調査(Track 3/4)** — コード変更なしの調査タスク。
4. **§1-4 wrangler 更新** — wrangler dev を検証できる環境で専用ブランチとして。
5. **§1-5 ベクトル検索の再評価 ADR** — WebANNS の新証拠を踏まえ、人間の判断を仰ぐ。

§1-1・§1-2・§1-6・§1-7・§1-8 は解決済み。残る未対応は §1-3・§1-4・§1-5・§1-9・§1-10。
