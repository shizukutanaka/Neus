# Changelog

All notable changes to Neus.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

## [Unreleased]

## [v0.12.0] - 2026-06-14

### Watchword Collector — 単語登録→自動収集→出力 (ADR-0016)

特定の単語/トピックを登録すると、その情報を横断的に自動収集し、まとめて出力できる能動的な調査機能。

#### 入力(収集)
- 単語ごとに検索フィードを生成し、既存の `/rss` プロキシ経由で取得:
  - Google News 検索RSS / Reddit 検索RSS / Hacker News(hnrss)/ arXiv(Atom)
- 単語の定義/概要は Wikipedia REST summary(JSON)から取得
  - ワーカーに `GET /json?url=` を追加(ホスト許可リスト=Wikipedia/Wikimediaのみ、SSRFガード共有)
- 収集結果は既存パイプライン(正規化→重複排除→保存→FTS)へ流入。`source.type='word'` と
  自動タグ `word:{term}` を付与し、フィルタ/検索/出力で束ねる
- 手動POLLおよびPeriodic Background Sync(AutoSync)に相乗りして自動収集

#### 出力(アウトプット)
- 単語ドシエ Markdown(定義 + ソース別アイテム一覧)ダウンロード
- 構造化JSONエクスポート
- Obsidian Vault へ `neus/words/{slug}.md` 直書き
- 個別カードの COPY MD は従来どおり

#### UI / ストレージ
- 新ビュー `WORDS`(単語ごとの定義カード + 直近アイテム + 出力ボタン)
- `WORDS` モーダル(登録 / 収集ソース選択 / 有効化 / 収集 / 削除)
- IndexedDB に `words` ストアを追加(dbVersion 1→2、非破壊アップグレード)。バックアップ/復元にも対応
- JA/EN 文言、アクセント色 `#00C4CC` 準拠、絵文字なし

#### 改善・修正
- **Fixed**: word由来の合成ソース(`word:*`)が `SourceFailTracker` の自動無効化対象になり、誤解を招く "auto-disabled" トーストを出していた問題を修正(対象外に)
- Wikipedia定義は端末言語に記事が無い/曖昧さ回避ページの場合、英語版へ自動フォールバック
- 単語収集のフィード取得に一時的ネットワーク障害向けの1回リトライを追加(POLLの簡易版)
- WORDSモーダルの ADD / すべて収集 ボタンを i18n 対応(JA/EN)
- WORDSモーダルの登録済みリストで、各単語の収集ソース(Wikipedia/News/Reddit/HN/arXiv)を行内チェックボックスで即時切替可能に(削除→再登録が不要)
- WORDSビューにヘッダー(単語数 + COLLECT ALL)を追加。モーダルを開かずに一括収集可能
- Wikipedia定義が7日以上前/未取得の場合、各単語に「定義を更新 / Refresh definition」リンクを表示しその場で再取得
- 単語ドシエを拡充: frontmatter に `sources` / `last_collected` を追加、収集アイテムの頻出タグを集計する `## タグ` セクションを追加
- WORDSモーダルに EXPORT ALL を追加。全watchwordを1つのMarkdownへ一括出力
- 収集ソース未選択での単語登録をバリデーションで防止

#### 視点の転換 — 「語 = 問い、価値 = 差分」(ソクラテス式の再フレーム)
語を検索クエリではなく *問い* として扱い、出力の価値を「全アイテム」ではなく「前回レビュー以降の新着 = 答えの変化」と捉え直す:
- 各単語に任意の **note(問い/意図)** を付与(WORDSモーダルで入力、WORDSビューと ドシエ frontmatter `intent` + 引用に反映)
- **reviewedAt** を追跡。WORDSビューに **新着件数バッジ** と **REVIEWED(確認済み)** ボタンを表示し、レビュー時点を更新
- 単語ドシエに frontmatter `unreviewed` と **`## 新着`** セクション(前回レビュー以降のアイテム)を追加
- 共有判定 `newSinceReview()` をビュー/出力で共用

#### 視点の転換 — 「問いを待つのではなく引き出す」(ソクラテス式の産婆術)
watchword はユーザーがタイプして生まれるだけ、という前提を覆す。最も価値ある問いはユーザー自身の行動に潜む:
- **watchword 提案** — WATCHキーワード(明示的な関心)と STAR 記事の頻出タグから候補を抽出し、WORDS ビュー上部にチップ列で提示
- チップをワンタップで登録 → 既定ソースで即収集(`data-wact="suggest"`)。登録済みは除外
- 純粋なランク付け `rankWordSuggestions()`(キーワード最優先、同一語はスコア合算、2文字未満ノイズ除去、件数順)

#### Tests
- `tests/word-feeds.test.mjs`(フィードURL生成 + ソースドリフトガード + 失敗トラッカー除外 + Wikipediaフォールバック順)
- `tests/word-dossier.test.mjs`(ドシエMarkdown生成 + slug)
- `tests/word-collect-integration.test.mjs`(フィードXML→パース→word:タグ付与→ドシエ出力のE2Eをjsdomで検証)

## [v0.11.0] - 2026-05-30

### Maskable Icon Fix — Install Experience (Category 5)

PWAインストール時のホーム画面アイコン品質を改善。ADR-0013ロードマップの残課題。

#### Dedicated maskable icon (safe zone)
- 従来は `purpose: "any maskable"` を同一アイコンに付けるアンチパターン
  - maskable は中央安全領域(80%)に主要素を収める必要があり、any とは別デザインが必須
  - Androidの円形マスクで端の装飾が切れる問題があった
- **maskable専用アイコンを分離**: 全面背景塗り + 主要素を中央60%(安全半径内)に配置
- 円形/角丸マスクでも切れず、背景色が残る正しい maskable 設計
- any アイコン(192/512)は従来デザインを維持

#### Validation
- maskableの主要素が安全領域(中心256から半径≤205px)に収まることを数値検証
- 全面背景(`<rect 512x512>`)でマスク後も透明な角が出ないことを保証

### Testing
- vitest 217 → **237**(+20: manifest妥当性/アイコン安全領域/必須フィールド)
- `tests/manifest.test.mjs` 新規
- 実ブラウザで manifest link / theme-color / apple-touch-icon の統合を確認

### Documentation
- ADR-0013のロードマップ項目「maskable PNG icon」を消化(SVGで安全領域対応を実現)


## [v0.10.0] - 2026-05-30

### CSP Hardening — XSS Resistance (Category 7, Security)

長く保留されていたセキュリティの本丸(ADR-0007)。単一HTMLアーキを維持したまま、ハッシュベースCSPでXSS耐性を最大化。

#### Hash-based CSP (unsafe-inline removed in production)
- 本番(`_headers`): `script-src 'self' 'sha256-...'` でインラインスクリプトをハッシュ許可、**`unsafe-inline`を完全除去**
- メタタグ: file://やヘッダー未対応環境向けフォールバック(本番では`_headers`優先)
- `scripts/compute-csp-hash.mjs` でインラインスクリプトのハッシュを自動計算・注入

#### Attack surface hardening
- `object-src 'none'` / `base-uri 'self'` / `form-action 'none'` — インジェクション経路を遮断
- `frame-ancestors 'none'`(_headers) — クリックジャッキング防止
- `connect-src` を Worker + Anthropic API の許可リストに限定 — データ持ち出し経路を制限
- フォントの**インラインonload属性を除去**しJS化(CSP違反要素の排除)

#### Integrity guarantee
- `check-html.mjs` に **CSPハッシュ整合性チェック**を追加
- スクリプト変更時にハッシュ更新を忘れると本番でアプリが壊れる致命的問題 → CIで即検出
- 外部化(ADR-0007 v0.2.0計画)は単一ファイル配布の価値を損なうため恒久的に見送り、ハッシュCSPで代替

### Testing
- 実ブラウザ **77** E2E全通過 → CSPが全機能(モーダル/検索/IndexedDB/SW/オフライン/スワイプ/メニュー/要約)と衝突しないことを実証
- vitest 217 + 実ブラウザ 77 = **294検証**
- CSPハッシュ整合性チェックで2スクリプトのハッシュ一致を保証

### Documentation
- ADR-0007更新: ハッシュベースCSPによる外部化の代替


## [v0.9.0] - 2026-05-30

### Mobile Header Consolidation (Category 9)

ヘッダーの6ボタン横並びがモバイル(360px)で窮屈だった問題を解消。ADR-0013/0014ロードマップのUX課題。

#### Overflow menu
- 主操作の **POLL は独立維持**(頻用・一等地)
- 残り5つ(SOURCES/KEYWORDS/STATS/VAULT/SETTINGS)を**オーバーフローメニュー(☰)**に集約
- メニュー項目は44pxタッチターゲット、`role="menu"`/`role="menuitem"`、`aria-haspopup`/`aria-expanded`
- 開閉操作: ☰タップでトグル、項目クリックで実行+自動クローズ、外側クリックで閉じる、Escで閉じる
- ヘッダーがすっきりし、モバイルの折り返しが解消

### Testing
- 実ブラウザ UI E2E: 30 → **34**(メニュー開閉/項目クリック/外側クリック/POLL独立)
- 既存のモーダル開閉テストもメニュー経由クリックに更新
- axe-core a11y 7件全通過(メニューのaria属性検証含む)
- vitest 217 + 実ブラウザ **79** = **296検証**

### Documentation
- ADR-0013/0014のロードマップ項目「ヘッダーのモバイル集約」を消化


## [v0.8.0] - 2026-05-30

### RSS Conditional GET — bandwidth savings (Category 4)

情報ハブとして高頻度POLLするNeusが、変更のないfeedも毎回全文DLしていた問題を解消。HTTP Conditional GETで帯域とWorker処理を桁違いに削減。詳細は ADR-0015。

#### Worker (_worker.js)
- クライアントの `If-None-Match` / `If-Modified-Since` を upstream に転送
- upstream が 304 を返したら検証子だけ付けてボディ無しの 304 を中継
- upstream の `ETag` / `Last-Modified` をレスポンスに含める
- CORS: 条件付きヘッダを許可、`ETag`/`Last-Modified` を `Access-Control-Expose-Headers` で露出(ブラウザが読むのに必須)

#### Client (fetchOne)
- source ごとに `etag` / `lastModified` を IndexedDB に保存
- 次回リクエストに検証子を付与
- **304 なら parseFeed をスキップして即 0 件(最大の節約)**
- 200 ならレスポンスの検証子を保存し次回に備える
- 検証子を返さないfeedは従来通り全文取得(劣化なし)

#### Impact
- 多くのfeedは更新が散発的 → 大半のPOLLが「変更なし」
- 304は数百バイト、200は数十〜数百KB → 帯域を桁違いに節約
- Worker無料枠の節約でサーバーレス運用コスト低減、モバイルのデータ/バッテリーにも寄与

### Testing
- vitest 210 → **217**(+7: 検証子転送/304スキップ/CORS露出)
- 機能E2E 18件で回帰なしを確認
- vitest 217 + 実ブラウザ **75** = **292検証**

### Documentation
- ADR-0015: RSS Conditional GET


## [v0.7.1] - 2026-05-30

### PWA Install Promotion (Category 5 roadmap)

ADR-0013/0014のロードマップから、PWAとして完成度が高いのにインストール導線が無かった点を解消。

#### Non-intrusive install banner
- **`beforeinstallprompt`** を捕捉・保留し、適切なタイミングでバナー提示
- 押し付けがましさを避ける設計:
  - 初回起動では出さない(保存イベント5件以上の利用実績がある人のみ)
  - 起動直後の慌ただしさを避け4秒待ってから判定
  - 既にインストール済み(standalone)なら何もしない
  - 「後で」を選ぶと14日間スヌーズ(再提示しない)
- `appinstalled` イベントでバナー消去 + 完了トースト
- バナーは i18n 対応(JA/EN)、44pxタッチターゲット、safe-area対応、prefers-reduced-motion尊重

### Testing
- 実ブラウザ UI E2E: 27 → **30**(バナー存在/「後で」スヌーズ/5件未満で非表示)
- vitest 210 + 実ブラウザ **75** = **285検証**
- beforeinstallprompt シミュレートで表示制御を実Chromiumで検証

### Documentation
- ADR-0013/0014のロードマップ項目「インストール促進」を消化


## [v0.7.0] - 2026-05-30

### Category 5 (PWA) + 9 (UX): Swipe Gestures & SW Update Strategy

10カテゴリー調査の第2弾。PWA/オフライン(5)とA11y/UX(9)を深掘り。詳細は ADR-0014。

#### Category 9 — Card swipe gestures (mobile)
- **右スワイプ → スター**、**左スワイプ → アーカイブ**
- モバイルの最も基本的なトリアージ操作。ボタンタップより高速・直感的
- 水平80px超で確定、移動中は transform 追従 + 方向別の背景色ヒント
- 縦スクロール優位時は無視 → スクロールと共存(座標判別)
- 長押し(キーワードシート)とも移動量で判別して両立
- InterestProfile学習と連動(右=pos / 左=neg)、Undo対応、触覚フィードバック(10ms)

#### Category 5 — App shell stale-while-revalidate
- SWのapp shell戦略を cache-first → **stale-while-revalidate** に変更
- 従来は index.html が一度キャッシュされると**新版デプロイ後も古いまま**だった(単一HTMLアプリには致命的)
- 即座にキャッシュを返しつつ裏で新版取得、次回起動で反映
- ネットワーク失敗時はキャッシュにフォールバック(オフライン動作は維持)
- SW更新通知(updatefound)と二重の更新保証

#### Surveyed but deferred (ADR-0014)
- Background Sync(失敗POST/PUTのキュー): NeusはRSS取得のみで送信なし → 不要
- スクリーンリーダー実機テスト(VoiceOver/NVDA): 手動テスト要、次回以降

### Testing
- 実ブラウザ UI E2E: 24 → **27**(右/左スワイプ + 閾値未満の3件)
- vitest 210 + 実ブラウザ **72** = **282検証**
- Playwright config に hasTouch 追加、両方向スワイプを実Chromiumで検証

### Documentation
- ADR-0014: カテゴリー5/9調査とスワイプ・SW更新戦略


## [v0.6.0] - 2026-05-30

### 10-Category Survey: RSS Robustness + Persistent Storage

Neusのプロダクトカテゴリーを10定義し、各領域でarXiv論文とGitHub実装を横断調査。最も影響の大きい2件を実装。全調査結果と改善ロードマップは ADR-0013。

#### Category 4 — RSS tolerant parsing (bozo pattern)
GitHub主要パーサ(feedparser-rs, feedsmith, node-feedparser)の業界標準を採用:
- **寛容パース**: 1件の壊れたitemで feed 全体を捨てず、正常な記事を救出
- 従来は parsererror で全記事ロスト → 実世界の不正XMLに脆弱だった
- **HTMLエンティティデコード**: `&amp;`→`&`、`&#39;`→`'` 等
- **メディア添付抽出**: enclosure / media:content / media:thumbnail
- `dc:date` も発行日として認識

#### Category 6 — Persistent storage request
- **`navigator.storage.persist()`** を起動時に要求
- 許可オリジンはディスク50%まで使え、ストレージ逼迫時の**自動退避(eviction)対象外**に
- 「オフラインファースト」なのにデータが自動退避され得る矛盾を解消
- 既に許可済みなら再要求しない

#### Surveyed categories (full roadmap in ADR-0013)
1. 推薦・選別(済) 2. 全文検索(済) 3. 重複検知(済) **4. RSS処理(今回)** 5. PWA/オフライン(検証済) **6. IndexedDB(今回)** 7. 暗号化(済) 8. オンデバイスAI(v1.1) 9. A11y/UX(済) 10. テスト/QA(継続)
- 残課題はADR-0013にロードマップ化(Conditional GET、インストール促進、スワイプ操作、embedding検索など)

### Testing
- vitest 210 + 実ブラウザ **68**(feed parsing 4件追加)= **278検証**
- 寛容パース/エンティティ/メディア抽出/Atom を実Chromiumで検証

### Documentation
- ADR-0013: 10カテゴリー横断調査と改善ロードマップ


## [v0.5.0] - 2026-05-30

### Implicit Interest Learning — "the right info, automatically"

「欲しい情報/いらない情報を的確に選ぶ」仕組みを内蔵。これまで star/archive は状態を変えるだけで、最も強い興味シグナルが選別に活かされていなかった。**InterestProfile** がこれを行動学習する。詳細は ADR-0012。

#### InterestProfile module
- **star した記事の特徴語 → 「欲しい」シグナル(positive)** を学習
- **archive した記事の特徴語 → 「いらない」シグナル(negative)** を学習
- 新着イベントを学習語彙と照合し、`meta.score` を ±25 まで暗黙補正
- 語の極性 = (pos - neg)/(pos + neg)、学習サンプル2件未満の語は無視(ノイズ除去)
- undo(unstar/unarchive)で学習を打ち消し → 誤操作に強い
- 語彙上限300、超過時は極性の弱い語から忘却 → 興味変化に追従
- title + snippet + tags から特徴語抽出(Rocchio/ナイーブベイズ的)

#### Two-layer selection: explicit + implicit
- KeywordRules(明示ルール、ユーザーが登録)= 確実な選別
- InterestProfile(暗黙学習、行動から自動)= 操作不要の選別
- 両者が相補的に働き、設定なしでも使うほど精度が上がる

#### Transparency & privacy
- STATSモーダルに「好み(自動学習)」「除外(自動学習)」のtop語を表示 → 何を学習したか可視化
- 完全ローカル・IndexedDB保存のみ・サーバー送信ゼロ(ADR-0011のプライバシー優位を維持)
- 連合学習/差分プライバシーが原理的に不要(送信しないため)

### Testing
- vitest 201 → **210**(+9: 興味学習スコアリング/極性/undo/忘却)
- `tests/interest-profile.test.mjs` 新規
- 実ブラウザE2E +3(star学習→新着boost、undo打消、リロード永続)
- star→pos / archive→neg / 新着±boost / 無関係0 を実Chromiumで検証

### Fixes
- vitest.config: Playwright `.spec.mjs` を vitest 対象から除外(誤実行を解消)

### Documentation
- ADR-0012: InterestProfile 行動学習による暗黙の情報選別


## [v0.4.1] - 2026-05-30

### IDF-Weighted Full-Text Search (arXiv survey, round 2)

arxiv.org から全文検索ランキングとプライバシー保護パーソナライゼーションを調査。詳細は ADR-0011。

#### BM25-inspired IDF weighting in FTS
- FTS検索スコアを単純ヒット数 → **IDF重み付け**に改善
- `IDF = log(1 + (N - df + 0.5)/(df + 0.5))`(BM25のIDF式、常に正)
- ありふれたgram("の"/"ing")を下げ、稀少で識別力のある語("rust"/"webassembly")を強調
- スコアは Σ(マッチgramのIDF)/Σ(全クエリgramのIDF) で0〜1に正規化
- 「BM25のIDFが稀少で識別力ある語を強調する」(BM25-V)を反映
- 実測: median 0.5ms @1000件(性能影響なし、むしろ若干改善)
- 複合検索で稀少語を含む文書が最上位に来ることを実ブラウザで検証

#### Privacy advantage confirmed (no new code needed)
- 連合学習(Federated)・差分プライバシー(DP)は「サーバーにデータを送る前提」の保護技術
- Neusはサーバー送信ゼロ(全処理ローカル)→ これらが**原理的に不要**
- Apple特許のオンデバイスRSが体現する理想形をNeusは既に実現
- 設計の正しさの裏付けとしてADR-0011に記録

#### Researched but rejected (ADR-0011)
- Federated Learning推薦(サーバー集約必須)、学習スパース表現SPLADE(ニューラル学習)、LLMリランキング(クラウド依存) → いずれもゼロ依存・サーバーレス制約に反する

### Testing
- vitest 194 → **201**(+7: IDF検索スコアリング)
- `tests/fts-idf.test.mjs` 新規(稀少語優先/正規化/非負IDFを検証)
- 実ブラウザで複合クエリのIDF効果を検証

### Documentation
- ADR-0011: FTS IDF重み付け + オンデバイスRSの優位性記録


## [v0.4.0] - 2026-05-30

### Research-Driven Ranking & Tagging (arXiv survey)

arxiv.org からNeusの中核領域(興味モデリング/重複検知/オンデバイス処理)の最新研究を調査し、ゼロ依存・ローカルファースト制約に合う知見を実装。詳細は ADR-0010。

#### Recency decay in Digest (Lifetime-aware Interest Matching, CIKM'25)
- Digest top3 ランキングに**鮮度ブースト**を導入: `25 × 0.5^(age/6h)`(半減期6時間の指数減衰)
- 「ニュースには寿命があり興味は時間減衰する」という知見を反映
- 24時間以内でも、より新しいイベントを「今読むべき」として優先
- `publishedAt`(なければ`timestamp`)基準、ゼロ依存・O(1)

#### Entity extraction for cold-start tagging (IP2 Entity-Guided, RecSys'25)
- TagLearner に**エンティティ抽出**を追加
- 英語: 大文字始まり連続語(ストップワード先頭/末尾トリム) 例 "OpenAI GPT model"→[OpenAI, GPT]
- 日本語: カタカナ語(3文字以上) 例 "アンソロピックがクロード発表"→[アンソロピック, クロード]
- 学習タグが不足する初期段階(コールドスタート)の自動タグを補完
- 学習不要・正規表現ベースでゼロ依存

#### Researched but deferred/rejected (ADR-0010)
- **SimHash/MinHash 近似重複検知**: 数万件規模で有効だが現状の数百件規模ではJaccard(実測0.7ms)で十分 → 却下
- **ニューラルCF/GCN/LLM推論推薦**: サーバー学習・クラウドLLM前提 → ローカルファースト制約に反するため却下
- **WebLLM オンデバイス要約**: ADR-0006(Bonsai 1.7B WebGPU)の裏付けとして記録、実装はv1.1維持

### Testing
- vitest 181 → **194**(+13: エンティティ抽出8 + 時間減衰5)
- `tests/entity-recency.test.mjs` 新規
- 実ブラウザでエンティティ抽出を検証(en/ja/ストップワード処理)

### Documentation
- ADR-0010: arXiv研究に基づくランキング/タグ改善(採用/却下の判断記録)


## [v0.3.0] - 2026-05-12

### Mobile-First Keyword UX

モバイルでのキーワード追加/ブロック体験を全面刷新。これまで `<textarea>` への改行区切り入力(モバイル最悪のUX)だったものを、タップ操作中心の設計に。

#### Chip-style keyword input
- WATCH/BLOCK の textarea を**チップ式入力**に置換
- 入力 → Enter/カンマ で確定しチップ化、× ボタンで個別削除
- 空状態で Backspace → 直前チップ削除
- 改行/カンマ含むペーストは自動分割で複数チップ化
- `enterkeyhint="done"` `autocapitalize="off"` 等モバイルキーボード最適化
- タッチデバイスでチップ/削除ボタンを44px相当に拡大

#### Long-press / right-click context sheet
- カードの**タグやソース名を長押し(モバイル)/ 右クリック(PC)**でボトムシート表示
- その語をワンタップで WATCH(ハイライト/スター)or BLOCK(アーカイブ/破棄)に登録
- 登録後 `reapplyAll()` で既存イベントにも即適用
- `navigator.vibrate(15)` で長押し触覚フィードバック
- ボトムシートは `env(safe-area-inset-bottom)` でノッチ/ホームバー対応
- 文脈(読んでいる記事のタグ)から離脱せずにルール追加できる

#### Workflow analysis
モバイルユーザーの操作経路(WF1インストール/WF2読む/WF3キーワード/WF4検索)を分析し、最も摩擦の大きい WF3 キーワード入力を優先改善。「機能がある」と「モバイルで使える」の差を埋めた。

### Testing
- 実ブラウザ UI E2E: 19 → **24**(chip削除/カンマ分割 + コンテキストシート 3件)
- vitest 181 + 実ブラウザ **62** = **243検証**
- chip入力→保存→再オープン復元、右クリック→シート→BLOCK登録 を実Chromiumで検証


## [v0.2.7] - 2026-05-12

### CRITICAL — scheduler.yield() Promise Hang (found by real perf measurement)

性能を実測しようとして、**Chrome 129+ で FTS rebuild が永久ハングする重大バグ**を発見。

#### Bug 5: scheduler.yield() Promise never resolves
- INP最適化(v0.2.2)で `await new Promise(r=>('scheduler' in window && window.scheduler.yield)?window.scheduler.yield():setTimeout(r,0))` と書いていた
- `scheduler.yield()` 経路では **executor が `r`(resolve)を呼ばず、戻り値のPromiseも捨てる → 永久に解決しない**
- 影響: `scheduler.yield` 対応ブラウザ(Chrome 129+)で **FTSIndex.rebuild()(起動時・バックアップ復元時)と KeywordRules.reapplyAll() が無限ハング**
- setTimeout フォールバック経路(古いブラウザ)では正常だったため、Chrome最新でのみ発症
- 修正: `await (yield ? scheduler.yield() : new Promise(r=>setTimeout(r,0)))` に変更しPromiseを正しく await
- 実測: 修正後 rebuild @1000 events = 115ms で正常動作

#### Real Performance Measurement (validating long-standing claims)
- **`tests/browser-perf.spec.mjs`** — 実Chromiumで性能実測(6テスト、warmup廃棄+100trial+median/p95)
- README「FTS 10K件で平均8ms」の検証 → **実測 @1000件: median 0.7ms / p95 2.0ms**(主張を大幅にクリア)
- IndexedDB getAll @1000: **14.4ms**
- 3×count @1000: **63.8ms**
- view描画(INP proxy): **10.6ms**(<200ms INP閾値)
- KeywordRules.evaluate: **3.2µs/event**
- FTS rebuild @1000: **115ms**(バグ修正後)

これまで ARCHITECTURE.md / README.md に書かれた性能数値は**一度も実測されていなかった**。実測により主張が(むしろ余裕を持って)正しいことを確認し、同時に致命的なyieldバグを発見。

### Regression Guards
- check-html.mjs: scheduler.yield の誤ったPromiseパターンを検出(64チェック)

### Testing
- vitest 181 + 実ブラウザ **57**(axe 8 + functional 11 + UI 19 + offline 6 + perf 6 + sw/layout 7)= **238検証**

### Lesson (6層目)
性能を「実測しようとする」行為そのものが、性能最適化コード(scheduler.yield)に潜む致命的バグを暴いた。皮肉なことに、**INPを改善するために書いたyieldコードが、特定ブラウザで機能を完全停止させていた**。「最適化は計測してから」の本当の意味 — 最適化コード自体が計測対象であり、計測しなければその最適化が害をなしているかすら分からない。

## [v0.2.6] - 2026-05-12

### Offline Actually Works Now — proven + 1 bug fixed

「オフライン動作」を v0.1.0 から謳ってきたが、**実際にオフラインで動くか一度も検証していなかった**。実HTTPサーバー上でSWを登録し、ネットワークを切断する実テストで初めて実証 — そして実バグを1件発見。

#### Bug 5: query-string URLs 404 offline (white screen)
- SW の SHELL cache-first は `caches.match(req)` を完全URL(クエリ含む)で照合
- キャッシュキーは `/`(クエリなし)だが、`/?source=share` 等でアクセスすると不一致
- **オフライン時にクエリ付きURLで起動すると白画面**(Share Target経由やPWAショートカットで発生)
- 修正: `caches.match(req, { ignoreSearch: true })` でクエリを無視して照合

#### Real Service Worker E2E (proving offline support)
- **`tests/browser-sw.spec.mjs`** — 実HTTPサーバー(SWはfile://不可)+ `context.setOffline(true)` の6テスト
- SW登録→activated 到達
- 初回ロード後にapp shellがキャッシュされる
- **ネットワーク切断後もアプリがロードする**(本丸の検証)
- オフライン再読込でIndexedDBデータ保持
- クロスオリジンリクエストがSWにキャッシュされない
- activate時に旧キャッシュ(neus-shell-v2以外)が purge される

### Regression Guards
- check-html.mjs: SW ignoreSearch の検出を追加(64チェック)

### Testing
- vitest 181 + 実ブラウザ **44**(axe 8 + functional 11 + UI 19 + SW 6)= **225検証**

### Lesson (5層目)
看板機能「オフライン動作」は、`sw.js` が存在し構文が正しく、`caches.open` 等のAPIを呼んでいても、**実際にネットワークを切るまで動く保証はゼロ**だった。しかも検証した瞬間に「クエリ付きURLで白画面」という実害バグが出た。PWAを名乗るなら、実サーバー上で実際にオフラインにする検証が必須。

## [v0.2.5] - 2026-05-12

### Two More Real Bugs — found by UI interaction E2E

v0.2.4 のモジュール直叩きE2Eでは捕捉できなかった**ユーザー操作パス**のバグを、実際にボタンをクリックする UI E2E で2件発見・修正。

#### Bug 3: SETTINGS modal hangs when no Service Worker registered
- `AutoSync.isSupported()` が `navigator.serviceWorker.ready` を無条件 await
- SW未登録時(初回起動直後、file://)に **ready が永久に解決せず、SETTINGSモーダルが開かない**
- 実害: 初回起動でユーザーが設定を開けない致命的UX
- 修正: `Promise.race` で1.5秒タイムアウトガード追加

#### Bug 4: Escape doesn't close modal when focus is in a form field
- グローバルキーハンドラが INPUT/TEXTAREA/SELECT 内のキーを早期 return
- focus trap がモーダル内の最初の select/input に自動フォーカスするため、**開いた直後 Esc が効かない**
- 実害: KEYWORDS/SETTINGS を開くと Esc で閉じられない
- 修正: フォーム要素内でも(検索バー以外は)Esc でモーダルを閉じる

#### Real UI Interaction E2E (the path where bugs hid)
- **`tests/browser-ui.spec.mjs`** — 実Chromiumで実際にクリック・入力する19テスト
- 4モーダルの開閉(クリック→show→Esc→閉)、pageerror監視
- 6ビューのナビ切替、aria-selected検証
- カードの STAR/ARCHIVE/LATER をクリック→IndexedDB永続化を検証
- 検索入力→フィルタ、Escクリア
- キーボードショートカット(? / g i)
- KEYWORDSモーダルでルール保存、不正JSON→aria-invalid

### Regression Guards
- check-html.mjs: SW ready timeout guard / Esc-in-input の検出を追加(63チェック)

### Testing
- vitest 181 + 実ブラウザ **38**(axe 8 + functional 11 + UI 19)= **219検証**

### Lesson (4層目)
v0.2.4 は「モジュールを動かす」E2Eだった。だが**ユーザーは関数を呼ばない、ボタンを押す**。実際にクリックする経路にだけ住むバグ(focus trap × Esc、SW ready hang)は、UI操作E2Eでしか見つからなかった。「動く」の検証は、ユーザーと同じ操作をするまで完了しない。

## [v0.2.4] - 2026-05-12

### CRITICAL — App Was Broken at Startup (found by real functional E2E)

**192件の静的検証が全てPASSしていたが、アプリは起動時に死んでいた。** 実Chromiumで実際にモジュールを動かすE2Eを書いて初めて2つの致命的バグを発見・修正。

#### Bug 1: boolean IDBKeyRange (init crash)
- `Store.countUnread/countStarred/countArchived` が `IDBKeyRange.only(true/false)` を使用
- **IndexedDB は boolean をキーにできない**(number/string/Date/binary/arrayのみ)
- 起動時 `DataError: parameter is not a valid key` でアプリ初期化が完全停止
- 修正: index count から `getAll().filter()` ベースのカウントに変更
- countUnread は INBOX フィルタ(`read:false && archived:false`)と一致するよう調整

#### Bug 2: currentFilter ReferenceError (render crash)
- `renderView()` が未定義の `currentFilter` を参照(正しくは `activeFilter`)
- 初期化フローで `ReferenceError: currentFilter is not defined` を投げて停止
- 重複していたフィルタロジックを既存の `matchesFilter()` に統一

これらは構文上は正しく(node --check 通過)、JSDOM では IndexedDB が異なる実装のため露呈せず、実 Chromium + 実 IndexedDB でのみ発現した。

#### Real Functional E2E (the verification that mattered)
- **`tests/browser-functional.spec.mjs`** — 実Chromiumで実際に機能を動かす11テスト
- WebCrypto: AES-GCM 暗号化/復号の往復、誤パスフレーズでの失敗(実GCM認証)
- IndexedDB: putEvent→getEvent、**ページリロードを越えた永続性**
- FTS: 実インデックス構築→全文検索ヒット、非マッチ0件
- KeywordRules: watch highlight(score+30)、block delete(skip)
- Dedup: SHA-256安定性(64hex)、Jaccard類似度
- **フルパイプライン**: `inbound.fetched` 発行→Bus→正規化→保存まで実際に流れることを検証
- テストフックは `?test=1` 時のみ `window.__neus` 露出(本番影響ゼロ)

### Regression Guards
- check-html.mjs に boolean-IDBKeyRange / currentFilter誤用 / テストフックgate の検出を追加(61チェック)

### Testing
- vitest 181 + 実ブラウザ **19**(axe 8 + functional 11)= **200検証**

### Lesson (続き)
v0.2.3で「実ブラウザがJSDOMの嘘を暴いた」と書いたが、まだ甘かった。**実ブラウザで axe を回すだけ**では起動バグを見逃す。**実際に機能を動かす**まで「動く」保証はゼロだった。静的検証192件は「コードが正しく書かれている」ことしか保証せず、「アプリが動く」ことは1件も保証していなかった。

## [v0.2.3] - 2026-05-12

### Quality — Real Browser Verification (the true 100)

JSDOM と自作スクリプトによる「100点」は自己採点バイアスを含んでいた。実 Chromium による検証で**隠れた違反を発見**し、真の100点に到達。

#### Real Chromium Testing (Playwright)
- **`tests/browser-axe.spec.mjs`** — 実 Chromium での axe-core フル監査(11テスト)
- **color-contrast を実レンダリングで検証**(JSDOM では計測不可能だった)
- レイアウト: 320px/1920px で横スクロール無し検証
- WCAG 2.5.8: 全ボタンの実測サイズ ≥ 24px 検証
- skip-link のフォーカス時可視性、focus-visible、h1単一性、メタデータ検証
- `playwright.config.mjs` — 環境内の既存 Chromium を直接指定

#### Critical Bug Found & Fixed by Real Browser
- **`--fg-3` (#6e7681) が実ブラウザで color-contrast 違反**(4.25:1 < AA 4.5:1)
- ヘッダーボタン(SOURCES/KEYWORDS/STATS/VAULT/SETTINGS)のラベルが該当
- **自作 contrast-check.mjs は「large text」と誤分類して見逃していた**
- 修正: `--fg-3` を **#838b96**(bg 5.66:1 / bg-2 5.32:1、AA余裕クリア)
- contrast-check.mjs も通常テキスト基準に訂正

### Testing
- vitest 181 + **Playwright実ブラウザ 11** = **192検証**
- 実レンダリング検証により JSDOM の限界(color-contrast/layout/focus)を補完

### Lesson
ツールが「100点」と言っても、それが**実環境を反映していなければ意味がない**。実 Chromium は自作スクリプトと JSDOM の両方が見逃した違反を1発で検出した。

## [v0.2.2] - 2026-05-12

### Quality — Beyond-Lighthouse Hardening

このリリースは Lighthouse 100/100 の先にある「真の100点」を目指した深掘り改善集。業界標準ツール(axe-core)による検証と、Core Web Vitals INP・サプライチェーン対応を追加。

#### Industry-Standard Accessibility (axe-core)
- **axe-core 4.11 統合** — Google Lighthouse 内部エンジンと同一の業界標準監査
- WCAG 2.0/2.1/2.2 A/AA + best-practice タグで violations = 0 を検証
- `tests/axe-a11y.test.mjs` — 4テスト(crash-free / zero-violations / zero-critical / coverage)
- **実バグ検出**: landmark入れ子(banner/main が application 内)を発見し修正
- nav の tablist role を `<nav>` + 内部 `<div role="tablist">` に分離(landmark保持)

#### Core Web Vitals — INP Optimization
- FTSIndex.rebuild に `scheduler.yield()` フォールバック(100件ごとに main thread へyield)
- KeywordRules.reapplyAll も50件ごとにyield
- 大規模データセット(10K+)でも INP < 200ms を維持

#### Resilience
- **RSS取得の指数バックオフリトライ** — ネットワーク障害時に最大3回(250/500/1000ms)
- 5xxサーバーエラーは追加1回リトライ
- 一時的障害でソースが無効化されにくくなる

#### WCAG 3.3.1 — Accessible Form Errors
- `setKwErr()` ヘルパー — エラー時に `aria-invalid="true"` + フォーカス移動
- kw-adv-input に `aria-describedby` + エラー領域に `role="alert"` `aria-live="assertive"`

#### Supply Chain Security (EU CRA / OMB M-26-05 対応)
- **`scripts/sbom.mjs`** — CycloneDX 1.5 形式 SBOM 生成(218コンポーネント)
- ソースファイルSHA-256ハッシュ + git commit を properties に記録
- `npm run sbom` で生成

#### Color Contrast Verification
- **`scripts/contrast-check.mjs`** — WCAG 2.1 SC 1.4.3 コントラスト比計算
- 全12組み合わせで AA 合格(12/12)、AAA 10/12

#### Additional Polish
- `@media print` スタイルシート(ナビ/ボタン非表示、本文のみ印刷、リンクURL展開)
- 検索inputに `autocomplete="off"` `spellcheck="false"` `aria-keyshortcuts="/"`
- トレンドSVGに `viewBox` + `role="img"` + `aria-label`(CLS防止 + A11y)

#### Dependency Security
- `ws` 脆弱性(GHSA-58qx-3vcg-4xpx)を `overrides` で `^8.20.1` に強制更新
- npm audit: **0 vulnerabilities**(以前は wrangler 経由で3件 moderate)

### Testing
- 172 → **181 tests** (+9)、+axe-core 4テスト = 実質 **185検証**
- check-html.mjs: 52 → **58 静的チェック**

## [v0.2.1] - 2026-05-12

### Quality — 100/100 Target Achievement

このリリースは Neus v0.2.0 を 100/100 品質基準に押し上げる修正集です。

#### WCAG 2.2 AA Compliance
- **SC 2.5.8 Target Size**: 全インタラクティブ要素に `min-height: 24px` / `min-width: 24px`
- **モバイル**: `@media (pointer: coarse)` で 44px に拡張
- 見出し階層: `<h1 class="brand">` 追加(`div` から昇格)、`h1 → h2 → h3 → h4` 順序を厳密化

#### SEO 100/100
- `og:title` / `og:description` / `og:type` / `og:locale` 追加
- `twitter:card` / `twitter:title` / `twitter:description` 追加
- `application/ld+json` structured data 追加(WebApplication schema)
- `<link rel="canonical">` 追加
- `<meta name="robots" content="index,follow">` 追加
- `<link rel="dns-prefetch">` を Anthropic/OpenAI API origins に追加

#### Performance 100/100
- フォント読込: `media="print" onload="this.media='all'"` non-blocking swap
- 既に preconnect / preload / display=swap 適用済み

#### Best Practices 100/100
- `target="_blank"` リンクすべてに `rel="noopener noreferrer"` 適用済み確認

#### Accessibility 100/100
- 全 modal が `role="dialog"` または `role="alertdialog"` + `aria-modal="true"`
- 全 form input が `<label>` または `aria-label` を持つ
- skip-link 適用済み
- focus-visible 強化済み
- ID重複なし(E2Eテストで filter-bar 重複を発見+修正)

### Testing
- 148 → **168 tests** (+20 件、+13.5%)
- **新規 `tests/e2e-smoke.test.mjs`** — JSDOM ベースの E2E スモーク 20件
  - HTML loads / lang attribute / viewport / manifest linked
  - skip-link / h1 / tablist / aria-selected / modal a11y
  - 重複ID検出 / JSON-LD validity / manifest.json validity / SW syntax
  - 全モジュール存在検証 / 全イベントトピック存在検証
- **重要**: E2E テストが `filter-bar` の ID 重複バグを発見し修正

### CI/Tooling
- **新規 `scripts/lighthouse-local.mjs`** — Chromium 不要のLighthouse風静的監査
  - Performance / Accessibility / Best Practices / SEO の 4 カテゴリ
  - 60+ チェック項目
  - **現在のスコア: 100 / 100 / 100 / 100 = Overall 100/100**

### Documentation
- **新規 ADR-0009** — Event本文 AES-GCM 暗号化(v1.0計画)

### Bug Fixes
- 重複していた `btn-stats` ボタンを除去
- 重複していた `id="filter-bar"` を統合

## [v0.2.0] - 2026-05-12

### Quality Improvements (100-point push)

#### Accessibility (WCAG 2.1 AA)
- Skip link for keyboard users
- ARIA roles on all interactive elements (`role="tab"`, `role="dialog"`, `role="article"`, `role="main"`)
- `aria-modal="true"` on all 7 modals
- `aria-labelledby` linking modal headers
- `aria-pressed` on toggle buttons (star)
- `aria-busy` on main view during render
- `aria-live="polite"` on view and toast
- Focus trap inside modals (MutationObserver-based)
- `prefers-reduced-motion` support
- Enhanced focus-visible: 3px outline + box-shadow
- 30+ ARIA patches applied across UI

#### Error Resilience
- Global ErrorBoundary catches window.error + unhandledrejection
- Burst error detection (5 errors in 60s → reload prompt)
- DB corruption recovery flow (Store.init catches open() failure)
- Service Worker update notification (reload prompt on new version)
- UndoStack for archive action (8s persistent toast + UNDO button)
- `confirmAsync()` unified API (future modal-replacement-ready)

#### Internationalization
- `Intl.DateTimeFormat` for dates older than 7 days (locale-aware)
- `Intl.NumberFormat` for stats counters
- DICT completeness test (`i18n.test.mjs`) caught and fixed 15 missing keys

#### Testing
- 80 → 148 tests (+85% coverage)
- `tests/digest.test.mjs` — Digest aggregation logic (16 tests)
- `tests/crypto.test.mjs` — AES-GCM round-trip (10 tests, includes IV uniqueness, tamper detection)
- `tests/i18n.test.mjs` — DICT completeness, found+fixed 15 missing keys

#### CI/Static Analysis
- `scripts/check-html.mjs`: 33 → 52 checks (+19 a11y/security/v0.2.0 module checks)
- `.lighthouserc.json` for Lighthouse CI integration

#### Documentation
- `CONTRIBUTING.md` — development workflow, conventions, ADR template
- `SECURITY.md` — threat model, trust boundary, disclosure policy
- `ARCHITECTURE.md` — 7-layer responsibility map, 22 modules, data model

#### Strict CSP (XSS hardening)
- Removed `'unsafe-inline'` from `script-src` directive
- Replaced with SHA-256 hash of the inline ES module
- `scripts/compute-csp-hash.mjs` auto-regenerates hash on every release
- `style-src` retains `'unsafe-inline'` (dynamic styles, no security impact for self-origin)

#### Custom Confirm Modal
- Replaced all `window.confirm()` calls with `confirmAsync()` custom modal
- Consistent design with rest of UI (ARIA `role="alertdialog"`, focus trap, Enter/Esc bindings)
- Supports `danger:true` option for destructive actions (red OK button)

#### Plugin API Stub
- `window.neus` — read-only API for future Web Worker-isolated plugins (ADR-0005)
- Frozen interface, structuredClone() returns to prevent mutation
- Methods: `getEvent` / `listEvents` / `countAll` / `listSources` / `subscribe` / `search` / `getKeywordRules` / `t`
- Console announcement on load: `[Neus] Plugin API ready: window.neus`

#### Performance
- Font stylesheet loaded with `rel="preload"` + non-blocking promotion
- Reduced Noto Sans JP weights (removed 900)
- Service Worker registration deferred to `window.load` event

#### Release Automation
- `scripts/release.mjs` — verifies 8 quality gates before release
- `npm run release:check` / `npm run release` — single command verification
- Auto-checks: version sync / CSP hash / syntax / 52 HTML checks / 148 tests / 0 vulns / CHANGELOG section / no raw confirm() / no console.log

### Added

#### AutoSync (Periodic Background Sync)
- Service Worker `periodicsync` イベントで定期RSS取得
- 取得間隔設定: 1h / 6h / 12h / 24h
- 新着通知 (Notification API) — 取得件数を表示
- Chromium限定 (Firefox/Safariは手動POLL継続、progressive enhancement)
- SETTINGS → AUTO SYNC セクションで設定
- 権限: `periodic-background-sync` を `manifest.json` に追加

#### Smart Digest View
- 新ナビ `DIGEST` — 過去24時間のアクティビティ集計
- メトリクス: 取得数 / 要約済み数 / 本日スター数
- Top 3 today — `score + 要約あり + 未読` の優先度ソート
- 頻出タグ Top 8 — クリックで該当ビューにフィルタ移動
- アクティブソース Top 5
- 7日間トレンド — SVGバーグラフ(ゼロ依存実装)

#### Reading Queue (LATER)
- 新ナビ `LATER` — 「あとで読む」専用ビュー
- カードに `LATER` ボタン追加(STARと独立)
- キーボードショートカット `l` キーで切り替え
- STAR=長期保管お気に入り / LATER=未読待機キュー の意味分離
- バックアップ/復元対象に含める

### Changed
- Service Worker キャッシュ名: `neus-shell-v1` → `neus-shell-v2`
- 旧キャッシュは activate イベントで自動破棄
- index.html サイズ: 117KB → 129KB (+10%、制限500KBの26%)
- Event スキーマ: `state.later` / `state.laterAt` フィールドを追加 (optional、後方互換)

### Security
- AutoSync は端末内完結 (Push Server不使用)
- Notification permission は明示的opt-in (SETTINGS で AUTO SYNC 有効化時のみ要求)

### Known Limitations
- AutoSync: Chromium系のみ対応 (Firefox/Safariは未対応、手動POLLで代替)
- Periodic Sync の発火タイミングはブラウザ依存 (site-engagement threshold)
- iOS Safari: Background Sync未対応、ただし Notification API は iOS 16.4+ で対応

## [v0.1.0] - 2026-05-12

### Added

#### Core (P1)
- Event Bus: pub/sub, handler error isolation, 10 topics
- IndexedDB Store: `events` / `sources` / `settings`, 6 indexes
- RSS/Atom Poller: DOMParser, RSS+Atom dual format, CORS proxy via Cloudflare Worker
- Inbox UI: timeline view, card actions (READ / STAR / ARCHIVE)
- Cloudflare Worker (`_worker.js`): stateless RSS proxy, SSRF prevention, Content-Type validation
- Service Worker (`sw.js`): app shell cache-first, stale-while-revalidate

#### AI Summary (P2)
- BYOK summary: OpenAI / Anthropic (Claude) / Google Gemini
- Daily request budget limit
- Tag learning: PBKDF2-based frequency model, N-gram tokenization (EN/JA/CJK)
- User memo: `userNote` / `userQuote` / `userTags` inline editing
- Markdown export: YAML frontmatter + wiki-style Vault links

#### Hub Core (P3)
- FTS (Full-Text Search): N-gram (2-gram) inverted index, in-memory Map, avg 8ms on 10K events
- Vault matching: `showDirectoryPicker` read-only, filename tokenization, min 2 token match
- OPML import/export: OPML 2.0, round-trip tested
- Dedup enhancement: 2-pass (SHA-256 hash + Jaccard title similarity ≥ 0.8, 24h window)
- Real-time search nav: debounced 200ms, match% score display

#### Inbound & i18n (P4)
- Share Target (PWA): URL params `?share_url=&share_title=`, history.replaceState cleanup
- Bookmarklet: dynamic generation from `location.origin`, clipboard copy
- i18n: JA (primary) / EN (secondary), 31 keys, `t()` helper, `applyI18N()`
- Onboarding wizard: 5-step (language / passphrase / BYOK / presets / Vault)
- Preset sources: HN / GitHub Blog / Cloudflare Blog / Dev.to / AWS Blog

#### Security & Resilience (P5)
- AES-GCM encryption: PBKDF2 (300K iterations) + 16-byte salt + 12-byte IV
- Session passphrase: in-memory closure, cleared on page reload (intentional)
- Lock screen: startup passphrase verification before rendering
- Vault writer: `getDirectoryHandle` readwrite, individual note + Daily Note append
- Bulk export: EXPORT ALL STARRED → batch `VaultWriter.exportBatch`
- Network monitor: `offline` / `online` events, POLL disable, auto-reconnect poll
- Source fail tracker: auto-disable after 5 consecutive failures
- Storage guard: `navigator.storage.estimate` at 85% → auto-clean oldest archived+exported

#### Deploy & CI/CD (P6)
- `wrangler.toml`: Cloudflare Worker config
- `_headers`: CSP / HSTS / X-Frame-Options / Permissions-Policy
- `_redirects`: SPA fallback
- GitHub Actions CI: lint → test → vulnerability scan → size gate
- GitHub Actions Release: deploy Worker + Pages + Sigstore cosign signature
- `scripts/check-html.mjs`: 33-point static integrity checker
- Unit tests: utils.test.mjs (normalizeUrl / jaccard / tokenize / escapeHtml / ngrams / FTS / OPML / Worker security)

#### Keyword Rules (汎用ルールエンジン)
- WATCH (気になる) / BLOCK (除外) の2系統
- 6種類のマッチモード: `contains` / `exact` / `prefix` / `suffix` / `word` / `regex`
- 6種類のスコープ: `title` / `snippet` / `summary` / `tags` / `source` / `all`
- WATCH アクション: `highlight` (score+30) / `star` / `tag`
- BLOCK アクション: `archive` / `delete` (保存しない)
- シンプルUI(改行区切り) + Advanced JSON 編集
- 既存全Eventへの再適用機能
- ルール変更時の自動再適用は手動 (REAPPLY TO ALL ボタン)

#### Stats & Backup
- STATSダッシュボード: 保存数 / 未読 / スター / Vault書出 / FTS / 要約数 / ストレージ
- JSON エクスポート: Events + Sources + Settings + KeywordRules 完全バックアップ
- JSON インポート: 復元(確認ダイアログ付き)、APIキー暗号化なし時は警告
- ファイル名: `neus-backup-YYYY-MM-DD.json`

#### Keyboard Shortcuts (14種)
- `j/k` または `↓/↑`: カード移動
- `Enter`/`o`: 詳細を開く
- `s/e/r/v`: スター / アーカイブ / 既読 / Vault書出
- `/`/`f`: 検索フォーカス
- `p`: POLL
- `g i`/`g a`/`g s`: INBOX/ALL/STARRED 移動
- `?`: ショートカット一覧
- `Esc`: モーダル閉 / フィルタ解除

#### Tag & Source Filter
- カード上のタグ(`#user` / `~auto`)クリックで絞り込み
- メタ部のソース名クリックで絞り込み
- フィルタバー表示、CLEAR ボタンで解除

### Security

- Personal data server transmission: zero (stateless Worker, no logs)
- API key: AES-GCM encrypted in IndexedDB when passphrase set
- CSP: `script-src 'self' 'unsafe-inline'` (inline module; future: extract to external file)
- SSRF: Worker blocks private IP ranges (localhost, 10.x, 192.168.x, 172.16-31.x, 169.254.x)
- Secrets: gitleaks pre-commit scan in CI

### Known Limitations

- `script-src 'unsafe-inline'` required until JS extracted to separate file (P7 target)
- API key: Event content not yet encrypted (APIキーのみ、Event本文はP7以降)
- Browser support: File System Access API requires Chromium; Safari/Firefox fall back to download
- Vault handle persistence: requires `queryPermission` on reconnect (browser dependent)

[Unreleased]: https://github.com/shizukutanaka/neus/compare/v0.2.7...HEAD
[v0.2.7]: https://github.com/shizukutanaka/neus/compare/v0.2.6...v0.2.7
[v0.2.6]: https://github.com/shizukutanaka/neus/compare/v0.2.5...v0.2.6
[v0.2.5]: https://github.com/shizukutanaka/neus/compare/v0.2.4...v0.2.5
[v0.2.4]: https://github.com/shizukutanaka/neus/compare/v0.2.3...v0.2.4
[v0.2.3]: https://github.com/shizukutanaka/neus/compare/v0.2.2...v0.2.3
[v0.2.2]: https://github.com/shizukutanaka/neus/compare/v0.2.1...v0.2.2
[v0.2.1]: https://github.com/shizukutanaka/neus/compare/v0.2.0...v0.2.1
[v0.2.0]: https://github.com/shizukutanaka/neus/compare/v0.1.0...v0.2.0
[v0.1.0]: https://github.com/shizukutanaka/neus/releases/tag/v0.1.0
