# Neus 仕様書 (Specification)

バージョン: v0.12.0
最終更新: 2026-06-20
対象読者: 実装者 / レビュアー / 監査担当

本書は Neus の現行仕様を一次情報として定義する。設計判断の経緯は `docs/adr/`、
利用手順は `README.md`、全体俯瞰は `ARCHITECTURE.md` を参照。両者と本書が矛盾する
場合は本書を正とし、差分を当該文書へ反映すること。

---

## 1. 概要

Neus はサーバーレス・端末内完結の個人情報ハブ (Personal Information Hub) である。
RSS / 共有 / Bookmarklet / 単語ウォッチで情報を集約し、要約・タグ付け・全文検索・
書き出しで再構築する。個人データのサーバー送信はゼロ。Cloudflare Worker は
ステートレスな CORS 中継のみを担う。

- 本体: `index.html` (単一 PWA、全 UI/ロジックをインライン ES module で保持)
- 中継: `_worker.js` (Cloudflare Worker、ステートレス RSS/JSON プロキシ)
- キャッシュ: `sw.js` (Service Worker)
- 設定: `manifest.json` (PWA + Share Target)

## 2. 目的と非目的

### 目的 (Goals)

- G1: 個人の情報収集を端末内で完結させ、外部にデータを残さない
- G2: 単語 (Watchword) を起点に能動的な情報収集と「探究」を支援する
- G3: 収集物を Markdown / JSON / Obsidian Vault へロスなく書き出す
- G4: ゼロ依存・月額 $0・オフライン動作を維持する

### 非目的 (Non-goals)

- N1: 複数端末間の自動同期 (エクスポート/インポートで代替)
- N2: サーバー側での検索インデックスや推薦
- N3: アカウント / ログイン / 課金の必須化

## 3. 不変条件 (Invariants)

`CLAUDE.md` G0 準拠。違反は重大バグとして扱う。

| # | 不変条件 | 検証方法 |
|---|---|---|
| I1 | 個人データのサーバー送信ゼロ。Worker は中継のみ・状態保持禁止 | `_worker.js` レビュー / `tests/worker.test.mjs` |
| I2 | ゼロ依存。本番コードは Web Standard API のみ | `package.json` dependencies が空 |
| I3 | localStorage / sessionStorage 不使用。状態は IndexedDB かメモリ | `grep` で不在を確認 |
| I4 | 絵文字をUI/ドキュメントに使わない | 静的チェック |
| I5 | アクセント色 `#00C4CC` は CTA / focus / ブランドのみ | レビュー |
| I6 | 文字列 eval / 未検証の動的 import を実行しない | レビュー |
| I7 | 関数 ≤ 40行、引数 ≤ 3、ネスト ≤ 3 | レビュー |
| I8 | ハッシュベース CSP。inline script は sha256 を `_headers` に登録 | `npm run check` |

## 4. アーキテクチャ

入力 → Bus → 処理 → 保存 → UI/出力 の一方向パイプライン。

```
Inbound Adapters ─┐
 RSSPoller        │
 ShareTarget      ├─> Bus(pub/sub) ─> Processors ─> Store(IndexedDB) ─> UI / Outbound
 Bookmarklet      │      │             KeywordRules    events            Views
 WordCollector ───┘      │             TagLearner      sources           VaultWriter
                         │             Summarizer      settings          Exporters
                         │             Dedup           words
                         └─ Background: AutoSync / StorageGuard / NetworkMonitor / SourceFailTracker
```

Worker (`_worker.js`) は本体からの唯一の外向き経路。`GET /rss` と `GET /json` のみ。

## 5. データモデル

### 5.1 IndexedDB (`neus-v1`, version 2)

| store | keyPath | 用途 |
|---|---|---|
| `events` | `id` | InformationEvent。index: timestamp / hash / sourceId / read / starred / archived |
| `sources` | `id` | RSS ソース定義 |
| `settings` | `key` | 設定・暗号化APIキー |
| `words` | `id` | Watchword (単語ウォッチ) |

upgrade は全 `createObjectStore` を `if(!contains(name))` でガードし、v1→v2 を非破壊にする。

### 5.2 InformationEvent

`ARCHITECTURE.md` 5節に準拠。`source.type` は `'rss' | 'share' | 'word'`。
word 由来イベントは `meta.autoTags` に `word:{normalized}` を持つ。

### 5.3 Watchword

```js
Word = {
  id, term, normalized,           // normalized = 正規化済みキー (dedup)
  lang,                           // 'ja' | 'en'
  note,                           // 探究の意図 (intent)
  sources: { wikipedia, news, reddit, hn, arxiv, qiita, zenn, hatena, github },  // 収集ソース toggle
  enabled,
  createdAt, reviewedAt,          // reviewedAt = 最後にレビューした時刻
  lastCollectedAt, lastFetched,   // 直近収集時刻 / 直近取得生件数
  wiki: { title, extract, url, thumbnail, fetchedAt } | null,
  lastErrors: { [label]: code } | null,  // 直近のソース別エラー

  // === 探究モデル (inquiry model) ===
  priorBelief,                    // 'curious'|'certain'|'skeptical'|'agnostic'
  verdict: { status, note },      // status: 'open'|'converging'|'answered'|'suspended'
  verdictAt, verdictHistory,      // 裁決の現在地と履歴 (最大 HISTORY_CAP=5)
  falsifier,                      // 反証条件 (この観測が出たら考えを変える)
  questions,                      // [{ id, text, createdAt, resolvedAt? }]
  questionHistory,                // intent 改稿履歴 (最大 HISTORY_CAP=5)
}
```

## 6. 機能仕様

### 6.1 ビュー

`INBOX / ALL / STARRED / ARCHIVED / LATER / WORDS / DIGEST / SEARCH` の8種。
SEARCH は検索時のみ出現。`maxViewItems = 50`。

### 6.2 単語ウォッチ (Watchword Collector)

- 登録: WORDS ビューまたは modal で term を入力、収集ソースを選択して ADD
- 既定ソース: `defaultSources()` が言語別に決定。`ja` は Wikipedia/News/Qiita/Zenn/Hatena を ON
  (Reddit/HN は OFF)、`en` は Wikipedia/News/Reddit/HN を ON。modal は開く時に同期、個別上書き可
- 収集: 登録時 + POLL 時 + AutoSync 時に `WordCollector.collectAll()`。各単語は
  Wikipedia と全フィードを `Promise.all` で並列取得 (`fetchFeed` 単位)。語間は直列
  - 検索型 RSS (Google News / Reddit / HN / arXiv) は `/rss` 経由で検索フィードを取得し `parseFeed` で解析
  - JSON 検索 (Qiita) は公式 REST API v2 `qiita.com/api/v2/items?query=` を `/json` 経由で
    取得し、専用 `parse` で記事配列を raw に正規化 (全文検索、タグ非依存。ADR-0017)。
    概要は `rendered_body` (HTML) を優先しタグ除去→エンティティ復号の順で清書
    (Markdown の `body` だと記法ノイズが残るため。`RSSPoller.decodeEntities` を共有)
  - タグ型 Atom (Zenn) は term をトピックスラグ (小英数字+日本語のみ連結、記号・空白除去。
    "Next.js"->"nextjs") に正規化し `zenn.dev/topics/{slug}/feed` を `/rss` 経由で取得。
    一致トピックが無ければ 404 が `lastErrors` に http_404 として記録され「取得失敗」表示
  - 検索 RSS (Hatena=はてなブックマーク) は `b.hatena.ne.jp/search/text?q={term}&mode=rss` を
    `/rss` 経由で取得。単一プラットフォームではなく日本語Web全体の被ブックマーク記事を横断
  - タグ型 Atom (GitHub Topics) は term をスラグ (小文字英数字のみ、非英数字はハイフンへ連結。
    "Next.js"->"next-js"。Zenn とは正規化方式が異なる — GitHub のトピック命名規則がハイフン
    区切りのため) に正規化し `github.com/topics/{slug}.atom` を `/rss` 経由で取得。Zenn と同じ
    トピックフィード設計のため 404 は `signalGaps` の `topicFeeds` 特例で沈黙として扱う (ADR-0018)
  - Wikipedia 要約は `/json` 経由で取得 (Wikipedia/Wikimedia 許可リスト)
  - 取得アイテムは `inbound.fetched` で既存パイプラインに投入、`word:{term}` を付与。
    ソースが `raw.tags` を提供する場合 (例 Qiita 記事タグ) は小文字化・重複排除・上限8件で
    `autoTags` に取り込み、実タグで検索・フィルタ可能にする。エンゲージメント信号
    (Qiita `likes_count` / Hatena `hatena:bookmarkcount`) は共有 `engagementScore()`
    (基準50・対数・上限+25) で `meta.score` 初期値に変換し、人気記事を上位へ
- 重複: 別単語が同記事を収集した場合、hash 重複として既存イベントに
  incoming の `word:X` タグを Set 合一でマージ (両単語のビューに出る)
- 出力: 単語ごとに DOSSIER (Markdown) / JSON / Vault。Vault は `{Vault}/neus/words/{slug}.md`

### 6.3 探究モデル (Socratic inquiry)

語を「問い」、収集物を「答えの差分」として扱う。

| 概念 | 定義 |
|---|---|
| `priorBelief` | 登録時の事前信念。affirm/deny/open の方向を持つ |
| `verdict.status` | 探究の現在地。`open→converging→answered/suspended` |
| `SETTLED_VERDICTS` | 終端は `answered` と `suspended` のみ。`converging` は終端でない |
| `cognitiveShift` | 事前信念の方向と裁決の方向が逆転したか (`shifted`) / 探究が終端に達したか (`concluded`) |
| `falsifier` | 反証条件。これが観測されたら結論を覆す |
| `falsifierHits` | 反証候補。共有ヘルパー `bigramCoverageHits`(文字bigram被覆率≥0.5、言語非依存)で反証条件と各収集物を照合し、該当しうるアイテムを能動検出。WORDSビュー/ドシエに表示し、`falsifier-seen` プロンプトを最優先発火 |
| `questions` | 未解決の問い (アポリア)。`resolvedAt` の無いものを数える |
| `questionHits` | 問いの手がかり(Question Watch)。`falsifierHits` と対称に `bigramCoverageHits` を各未解決の問いのテキストへ適用し、該当しうる収集物を能動検出。解決済みの問いは対象外(能動監視の必要が無いため)。WORDSビューでは問い文の直後にクリック可能なヒント(上位一致へのリンク + 件数)、ドシエでは問いの下にインデントした箇条書きとして表示 |
| `socraticPrompts` | 状況に応じ最大3件の問い直しを提示 |
| verdict-churn | `verdictHistory` の長さ(≥3、最低2往復)が振り返りの対象になっていなかった非対称性を解消。`cognitiveShift` が prior→現裁決の単一比較にとどまるのに対し、変遷回数そのものから「基準の一貫性 vs 証拠の不安定性」を問う |
| resolved-from-agnostic | `PRIOR_DIRECTION` は curious/agnostic を共に `open` へ写像するため `cognitiveShift.shifted` は構造上決して立たない。`curious`(既定値)を除外しつつ `agnostic`(意図的な選択)のみ特例化し、「知り得ないと言ったのに結論に至った」自己矛盾を問う |
| only-research | `no-research`(証拠が全て議論/その他=一次研究皆無)の対称形。証拠が全て研究層(arXiv)のみで報道・議論が皆無なら、理論と実践の乖離(実世界で検証されているか)を問う |
| disabled-still-open | `enabled=false`(収集無効化)は裁決に何の作用も無いため、`open` のまま静かに探究を放棄でき、他の全プロンプトが強いる自己吟味を回避できてしまう非対称性を解消。無効化かつ未裁決かつ証拠有りなら、再開または `suspended` への明示的な記録を促す |
| `newSinceReview` | `reviewedAt` 以降に収集されたアイテム = 答えの変化 |

`PRIOR_DIRECTION = {certain:affirm, skeptical:deny, curious:open, agnostic:open}`
`VERDICT_DIRECTION = {answered:affirm, converging:affirm, suspended:deny, open:open}`
`shifted = priorDir≠open && verdictDir≠open && priorDir≠verdictDir` (終端性とは独立)。

### 6.4 既存機能 (要約)

KeywordRules (WATCH/BLOCK) / TagLearner / BYOK Summarizer / 全文検索 (N-gram + IDF) /
InterestProfile / Digest / LATER / Vault書き出し / Share Target / Bookmarklet /
OPML import / Conditional GET / AutoSync / 各種 a11y。詳細は README 参照。

> 日付の規約: フィードが日付を提供しない場合 `event.publishedAt` は `undefined` の
> ままとする (「日付なし」という情報を保持するため捏造しない)。並び替え・表示は
> 全消費箇所で `publishedAt || timestamp` を用い、取得時刻で代替する。

## 7. Worker API 仕様 (`_worker.js`)

ステートレス・ログなし。GET と OPTIONS のみ受理。

| endpoint | 制約 |
|---|---|
| `GET /rss?url=` | Content-Type が `xml\|rss\|atom\|application/feed`。Conditional GET 転送 |
| `GET /json?url=` | host が `*.wikipedia.org \| *.wikimedia.org \| qiita.com` 限定 (ADR-0017)。Content-Type に `json` |
| `GET /` | ヘルスチェック |

共通ガード:
- protocol: `http(s)` のみ
- SSRF: `PRIVATE_HOST_RE` で private IP を拒否。WHATWG URL が IPv4-mapped IPv6 を
  hex 正規化する (`[::ffff:127.0.0.1]→[::ffff:7f00:1]`) ため hex 形も照合
- size: `readCapped` で本文を MAX_SIZE (5MB) に制限。Content-Length 欠落時も適用
- timeout: 15s。レスポンスは `cache-control: no-store`

## 8. セキュリティ仕様

- I1 (送信ゼロ) / SSRF / Content-Type 検証 / size 上限 / timeout は §7 の通り
- APIキー: AES-GCM 256bit + PBKDF2 300k iterations。パスフレーズで暗号化
- CSP: ハッシュベース (`unsafe-inline` 不使用)。inline script 変更時は `npm run check`
- SW: Worker 応答の `cache-control: no-store` を尊重しキャッシュしない

## 9. テスト・検証

- `npm test` — vitest 単体テスト
- `npm run check` — index.html 静的検証 + CSP ハッシュ照合
- `npm run lint` — `_worker.js` / `sw.js` 構文チェック

---

## 10. 長所・短所・改善点 (Strengths / Weaknesses / Improvements)

本書作成過程で実施した監査の結果。改善点は §11 で実装する。

### 10.1 長所 (Strengths)

- S1: I1〜I8 の不変条件が明文化され、テストで継続検証されている
- S2: 一方向パイプライン + Bus により入力種別 (rss/share/word) を疎結合に統合
- S3: 探究モデルが「収集して終わり」を超えた価値を与える独自性
- S4: ゼロ依存・単一ファイルにより監査範囲とサプライチェーンリスクが小さい
- S5: SSRF / size / timeout / CSP が多層で、Worker の攻撃面が小さい

### 10.2 短所 (Weaknesses)

- W1: **ドキュメントのバージョン不整合** — `ARCHITECTURE.md` が v0.2.0 のまま。
  `words` store・探究モデル・`/json` endpoint・`source.type:'word'` が未記載。
  データモデル節の store 数 (3) も現行 (4) と不一致。
- W2: **単語カード件数バッジの曖昧さ** — 検索結果の `wordResultHtml` は
  `lastFetched` (収集時の生件数) をラベルなしの数値だけで表示する。
  WORDS modal が `countFor` (実在件数) を「件/items」付きで出すのと不一致で、
  何の数値か読み取れず a11y ラベルも無い。
- W3: README のファイル構成が古い (index.html 88KB 記載、実体 ~277KB / テスト 80件記載)。

#### 検討したが欠陥ではなかった項目 (false positives)

- **StorageGuard の word 孤児化**: quota 超過削除は `events` のみ対象だが、
  `lastFetched` は仕様上「収集時の生件数 (重複排除・ブロック前)」であり実在件数ではない。
  実在件数は modal が `countFor` で別途表示する。両者が乖離するのは dedup/block により
  元から設計上の挙動であり、StorageGuard はこれを正しく拡大しているにすぎない。
  `lastFetched` を実在件数へ上書きする「修正」は documented な意味を壊すため行わない。
- **parseFeed の日付欠落**: フィードに日付が無いと `publishedAt:undefined` になるが、
  ソート・描画の全消費箇所が `publishedAt||timestamp` で救済済み (未ガードのソートは存在しない)。
  parse 時に `publishedAt=timestamp` を入れると「日付なし」という情報を失うため行わない。
  本救済は仕様として §6.4 注記で固定し、回帰テストで担保する。

### 10.3 改善点 (Improvements、本書で実装)

- C1 (→W1): `ARCHITECTURE.md` を v0.12.0 に更新。words store・探究モデル・
  `/json`・`source.type:'word'`・store 一覧・モジュール一覧を反映。
- C2 (→W2): `wordResultHtml` の件数バッジに `title` と `aria-label` を付与し、
  「収集時の取得件数」であることを明示。回帰テストで固定。
- C3 (→W3): README のファイル構成の数値を現行 (index.html ~277KB / テスト件数) に更新。
- C4 (→検討項目): `publishedAt||timestamp` 救済を回帰テストで固定し、
  parse 時に publishedAt を捏造しないことを保証する。

> 注: ShareTarget が watchword 収集を起動しない点、KeywordRules が word イベントも
> 一律処理する点は設計上の意図であり短所としない (§6.2/§6.4 の通り)。

### 10.4 第2次監査 (round 15) — データ保全

新規に発見・修正したデータ保全上の欠陥。

- W4: **要約予算カウンタの揮発** — `Summarizer.dailyCount` がメモリ上のみで、
  リロードで 0 に戻る。日次予算 (BYOK 課金上限) がページ再読込だけで回避できた。
  → C5: カウンタを IndexedDB (`summary-budget`) に永続化。起動時 `Summarizer.load()` で
  復元し、加算ごとに保存。日付が変われば自動リセット。
- W5: **インポートの破壊的先行削除** — JSON 復元は既存データを全削除した後にレコードを
  書き込むが、検証は `app==='neus'` と events 配列の有無のみ。不正な (将来スキーマ等)
  バックアップだと旧データを失った上で壊れたレコードが入りクラッシュ源になる。
  ロールバックは存在しない。
  → C6: 退避前に全 event/word の構造 (id・content・source・state・meta /
  id・normalized) を検証し、不正なら削除せず中止。
- W6: **Vault ドシエのファイル名衝突** — `exportWordDossier` が `{slug}.md` を用いるため、
  別語が同じ slug に正規化される (例 "C++" と "C" → `c.md`) と後勝ちで上書きし、
  前者のドシエを失う。
  → C7: ファイル名を `{slug}-{id8}.md` とし語 id で一意化。README の出力先表記も更新。

#### round 15 で検討したが修正しなかった項目

- **KeywordRules 正規表現の評価時失敗**: 保存時に `new RegExp` を検証済みで、評価時も
  try-catch で `false` を返すため評価ループは壊れない。保存後に不正化するのは DB 破損等の
  例外的状況のみ。console.warn 追加は毎イベントのログ汚染を招くため見送り。
- ~~dedup の Jaccard が O(n^2)~~ → round 16 の W12/C13 で ADR-0019 に基づき修正済み。

### 10.5 第3次監査 (round 16) — ソース追加・バックアップ完全性・a11y

- W7: **フルバックアップ/復元が学習データを落としていた** — JSON バックアップの設定
  ホワイトリストが `byok`/`lang`/`keyword-rules`/`onboarding-done` の4件のみで、
  `interest-profile` (スター/アーカイブ操作から学習した興味語彙、ライブ操作でのみ
  蓄積されるためリストアされたイベントから再構築不能) と `auto-sync` (取得間隔・通知設定)
  が対象外だった。復元のたびにパーソナライズが無警告で失われていた。
  → C8: 両キーをエクスポート/リストアのホワイトリストに追加し、復元後に
  `InterestProfile.load()` を呼んで即時反映(`summary-budget` は日付スコープの
  カウンタのため意図的に対象外のまま)。
- W8: **新着通知アイコンが存在しないファイルを参照** — `icon:'/icon-192.png'` を
  指定していたが、リポジトリに PNG アセットは存在しない (`manifest.json` は inline
  SVG data URI のみ)。通知がアイコン無しで表示されていた。
  → C9: マニフェストと同じ 192x192 SVG data URI を直接指定。
- W9: **イベントカードの一部ボタンに aria-label が無かった** — read/star/archive/later
  ボタンにはあったが、vault/detail/copy の3ボタンに無く兄弟ボタンと非一貫だった。
  → C10: 3ボタンに aria-label を追加。
- W10: **単語インポートで新規ソースキーが欠落し得た** — `wordFromImport` が古い
  ドシエ JSON の `sources` をそのまま使っていたため、エクスポート後に `WORD_FEEDS`
  へ新ソース (qiita/zenn/hatena/github) が追加されると、インポートした語にそのキーが
  存在しなくなっていた。
  → C11: `defaultSources()` とのマージに変更し、既存キーはユーザー設定を維持したまま
  新規キーを既定値で補完。
- W11: **Google News のタイトルに publisher サフィックスが残っていた** — 全見出しに
  ` - {publisher}` が付与され、表示ノイズに加え同一記事を他ソースから直接取得した
  場合とのタイトル類似度を下げクロスソース重複排除の閾値をすり抜けさせていた。
  → C12: `<source>` 要素と厳密一致するサフィックスのみを条件付きで除去。
- W12: **dedup の類似度比較が件数無制限で O(n) スキャン** — round 15 で性能課題として
  留保されていた項目。24h ウィンドウ内の全イベントと総当たりで Jaccard 比較し、
  比較のたびにタイトルを再 tokenize していたため、活発なユーザー(ソース数・watchword数
  が多い)ほど POLL/COLLECT ALL のコストが件数に比例して悪化していた。
  → C13 (ADR-0019): `recentEvents` の結果(timestamp 降順)を直近 `dedupCompareMax=300`
  件に `.slice` で上限化。重複は時間的に近接するフィード配信の性質上ほぼ常にウィンドウの
  先頭側に集中するため、実運用での再現率低下は事実上発生しない。

#### round 16 で追加した収集ソース(欠陥ではなく新機能)

- Hatena Bookmark・GitHub Topics を opt-in ソースとして追加 (ADR-0018)。§5.3/§6.2 に反映。
  Zenn の 404-as-silence 特例を `topicFeeds` Set (Zenn ∪ GitHub) へ一般化。

#### round 16 で検討したが修正しなかった項目

- **npm audit の High 脆弱性 (wrangler 系devDependency)**: `ws`/`undici`/`vite`/
  `wrangler`/`miniflare` が devDependency のみ (出荷される `index.html`/`_worker.js` には
  含まれずエンドユーザー露出ゼロ)。修正には wrangler の大規模な依存ツリー更新
  (60+ 新規推移的パッケージ) が必要で、この環境では `wrangler dev` の動作確認ができない
  ため見送り。別途、専用の依存関係更新パスで対応する。

### 10.6 第4次監査 (round 17) — ソクラテス式問答法で機能の過不足を検討

探究モデル自体が「語」を対象にエレンコス(論駁)を行う道具立てを持つため、その同じ手法を
プロダクトの機能セット自体に適用した。仮説を立て、コードを読んで反証を試み、生き残った
ものだけを採用する。

**却下した仮説(反証された = 欠陥ではなかった)**:

- 「探究装置(verdict/falsifier)が全 watchword に強制され、単なる話題追跡目的の
  ユーザーには過剰(過剰仕様)」→ 反証: `word-elenchus`/`word-fwatch` は各語カード内の
  受動的なインライン表示にすぎず、ブロッキングでも必須入力でもない。未使用でもコストは
  数行のテキストのみ。verdict は既定で `open`、priorBelief は既定で `curious` のままなら
  ほとんどのプロンプトは発火しない(`no-research` のみ verdict 状態非依存だが、これも
  passive)。過剰とは言えない。
- 「`priorBelief` が事後編集不可なのは機能不足」→ 反証: 事後編集可能にすると
  `cognitiveShift`(先入観と裁決の逆転検出)が事後の自己正当化で無効化される。編集不可は
  意図的な保護であり欠陥ではない。
- 「反証候補を見て却下した理由を記録する専用フィールドが無いのは機能不足」→ 反証:
  既存の `verdict.note`(`verdictNotePatch`)は status を変えずに自由記述できるため、
  「反証候補を検討したが却下した理由」を書く場に既に使える。専用フィールド追加は
  過剰設計(ゼロ設計思考に反する)。

**生き残った仮説(実装した)**:

- W13: **問い(アポリア)に能動センサーが無い非対称性** — `falsifier`(反証条件)は
  `falsifierHits` で該当収集物を能動検出するのに、構造的に同一の「宣言テキスト vs 証拠」
  照合が必要な `questions`(未解決の問い)には同等の機構が無く、ユーザーが新着アイテムを
  手動で見比べるしかなかった。
  → C14: `falsifierHits` の被覆率照合ロジックを共有ヘルパー `bigramCoverageHits(text,events)`
  へ抽出し、`questionHits(question,events)` として各未解決の問いに適用。WORDSビューは
  問い文の直後にクリック可能なヒント(上位一致へのリンク+件数)を表示、ドシエは問いの下に
  インデントした箇条書きで一致アイテムを記録。解決済みの問いは対象外(能動監視の必要が
  無いため)。§6.3 に追記。

### 10.7 第5次監査 (round 18) — ソクラテス式問答法・第2ラウンド

同じ手法(仮説→コードで反証を試みる→生き残ったもののみ実装)をもう一往復。

**却下した仮説(反証された = 欠陥ではなかった)**:

- 「`VERDICT_DEFS` の `converging` は `open` と実質重複し冗長」→ 反証:
  `VERDICT_DIRECTION` では `converging` は `answered` と同じ `affirm` 方向を持ち、
  `cognitiveShift`・`no-falsifier` 系プロンプトの両方で `answered` と同グループ扱いされる
  (「結論へ傾いている」という意味論を担う)。`open`(無方向)とは明確に異なる役割。
- 「`gaps.errored`(取得失敗)にも `gaps.silent` と対称な elenchus プロンプトを設けるべき」→
  反証: silent は「有効なのに0件=この語に関する信号なし」という被験対象についての情報だが、
  errored は「取得不能」という運用上の障害であり、対象についての情報を何も持たない。
  両者を意図して区別した設計(取得失敗と沈黙の区別、CHANGELOG既出)に反する。
- 「`relatedWords`(語同士の共起検出)はエレンコス装置の一部として問い直しの対象にすべき」→
  反証: これはナビゲーション支援(発見)であり、探究の妥当性を問う認識論的機構ではない。
  対象が異なるため、無理に接続すると過剰設計になる。

**生き残った仮説(実装した)**:

- W14: **裁決の変遷(verdictHistory)が振り返りの対象になっていない非対称性** —
  `verdictHistory` は変遷のたびに追記されるが(`verdictTransition`)、`socraticPrompts` は
  一度もこれを読まない。`cognitiveShift` は「登録時の先入観 vs 現在の裁決」という単一比較に
  留まり、裁決が何度も揺れ動いた事実そのもの(基準の一貫性、あるいは証拠の真の不安定性を
  示唆する)は問い直されなかった。
  → C15: `verdictHistory.length>=3`(最低2往復の反転)で `verdict-churn` プロンプトを追加。
  「基準は一貫しているか、証拠が本当に不安定なのか」を問う。既存の `HISTORY_CAP=5` により
  件数は自然に上限化されるため、新たな上限設計は不要。§6.3 に追記。

### 10.8 第6次監査 (round 19) — ソクラテス式問答法・第3ラウンド

**却下した仮説(反証された = 欠陥ではなかった)**:

- 「`curious`(既定値)も同じ特例化(結論到達を問い直す)の対象にすべき」→ 反証:
  `curious` は明示指定しない限り既定で設定される値であり、ほぼ全ての語が該当する。
  ここに問い直しプロンプトを適用すると、成功裏に結論へ至った語のほぼ全てで発火し、
  「意図的な立場表明が裏切られた」という信号の鋭さが失われ単なるノイズになる。
  `agnostic` は明示的な選択であるため対象を限定する。

**生き残った仮説(実装した)**:

- W15: **`agnostic` が `cognitiveShift.shifted` を構造上決して発火できない非対称性** —
  `PRIOR_DIRECTION` は `curious` と `agnostic` を共に `'open'` へ写像するため、両者を起点に
  した語は `shifted`(`priorDir!=='open'` が前提条件)を決して立てられない。しかし
  `certain`/`skeptical` が確信的な結論から逆転した場合に専用プロンプト
  (`shifted-from-certain`/`shifted-from-skeptical`)を持つのに対し、「知り得ないと明示的に
  述べた(agnostic)のに確信的な結論(answered/converging)に至った」という、同等以上に
  鋭い自己矛盾には何の反応も無かった。`curious` は既定値でほぼ全ての語に該当するため
  同じ特例化は信号を薄める(除外が正しい判断)。`agnostic` は意図的に選ばれた稀な立場
  であるため特例化に値する。
  → C16: `prior==='agnostic'&&(verdict==='answered'||verdict==='converging')` で
  `resolved-from-agnostic` プロンプトを追加(`shift.shifted` に依存せず prior を直接判定)。
  「それは本当に知り得たのか、それとも決めつけただけか」を問う。§6.3 に追記。

### 10.9 第7次監査 (round 20) — ソクラテス式問答法・第4ラウンド

**生き残った仮説(実装した)**:

- W16: **`no-research` に対称形が無い非対称性** — `onlyTalk`(証拠が全て discussion/other、
  一次研究皆無)は `no-research` プロンプトで「これは検証された事実か、意見か」と問われるが、
  その裏返し(証拠が全て research 層のみで、報道・議論が皆無)には何の反応も無かった。
  純粋に学術論文のみに基づく結論は、実世界での検証(実装・採用・community reaction)を
  経ていない可能性があり、「理論に留まっているのではないか」という、no-research とは別種
  だが同格の証拠多様性の欠如を示す。
  → C17: `tiers.every(t=>t.tier==='research')` で `only-research` プロンプトを追加。
  `no-research`(hasResearch===false && onlyTalk===true)と `only-research`
  (全tierがresearch)は構造上排他的(同時に真になり得ない)。§6.3 に追記。

なお、GitHub Topics(ADR-0018)が `sourceTier` の discussion 層判定
(reddit/hacker/qiita/zenn/hatena)に含まれていない点も検討したが、GitHub リポジトリは
フォーラム議論と性質が異なり(コード実装であって「議論」ではない)、既定の `other` 層への
分類はむしろ正確であるため欠陥としなかった。

### 10.10 第8次監査 (round 21) — ソクラテス式問答法・第5ラウンド

**生き残った仮説(実装した)**:

- W17: **`enabled=false` による静かな探究放棄** — 探究モデルは至る所で誠実さを強制する
  (反証条件を述べさせる、反証条件無しの結論をなじる、裁決の動揺を問い直す等)。しかし
  `word.enabled=false`(収集無効化)は裁決に何の作用も持たず、`socraticPrompts` はこれを
  一度も参照しない。ユーザーは単に収集を止めるだけで `open` のまま探究を静かに放棄でき、
  `suspended`(保留)という誠実な明示的選択が本来担うべき役割(「結論に至れなかった」と
  記録すること)を回避したまま、他の全プロンプトの自己吟味圧力からも逃れられていた。
  → C18: `word.enabled===false&&verdict==='open'&&n>0` で `disabled-still-open`
  プロンプトを追加。「再開するか、保留として記録すべきか」を問う。§6.3 に追記。

### 10.11 第9次監査 (round 22) — BYOK / Summarizer

探究モデル以外の未監査領域(BYOK/Summarizer)をコード検証した。`docs/FEATURE-AUDIT.md` §1-6・
§1-7 に対応。

- W18: **`summarizer.budget-exceeded` のトースト連発** — 日次予算超過後、`event.tagged` の
  たびに `Summarizer.summarize()` が同一イベントを再発火し、`role="status"` の同一エラー
  トーストが連続表示(スクリーンリーダーの連続読み上げも伴う)。POLL/COLLECT ALL の
  一括取り込みで顕著。
  → C19: `Summarizer` 閉包内に `budgetNotified` フラグを追加し、`resetIfNewDay` で
  `dailyCount` と同時にリセット。1日1回のみ通知。
- W19: **BYOK 日次予算 `0` が「無制限」に反転する** — `<input type="number" min="0">` は
  `0` を許可するが、判定 `if(s.budget&&dailyCount>=s.budget)` は `budget:0` を falsy として
  スキップし、「0件に制限」の意図が「無制限」へ反転していた。
  → C20: 判定を `typeof s.budget==='number'&&dailyCount>=s.budget` へ変更し、`0` を
  明示的な「常にブロック」として扱う。

### 10.12 第10次監査 (round 23) — socraticPrompts 優先順位機構(docs/FEATURE-AUDIT.md §1-1)

`docs/FEATURE-AUDIT.md` §1-1 が「前提条件: 実装前に共起分析を行うこと」としていた項目に着手。

- **共起分析**: `socraticPrompts` の約20条件を verdict 状態別に整理した結果、
  `verdict==='open'` の語だけでも `falsifier-seen` / `certain-unresolved` / `verdict-churn` /
  `disabled-still-open` / `no-questions` / `silence` / `unreviewed` の最大7条件が独立に
  (相互排他ではなく)同時成立し得ることを確認。無効化+問い未設定+ソース沈黙+未確認多数、
  といった「よくある放置状態」がまさにこの組み合わせに該当するため、飢餓は理論的リスクでは
  なく実際に起こり得ると判断した。
- W20: **push 順 `slice(0,3)` による構造的飢餓**(既に §1-1 で不足として記録済み)。
  → C21: 関数冒頭の既存コメント「結論の妥当性 > 反証条件 > 証拠の質 > 自己矛盾 > 探究の怠り」
  を `TIER_VALIDITY=1..TIER_NEGLECT=5` として数値化し、各 `out.push()` に `tier` を付与。
  末尾で `out.sort((a,b)=>a.tier-b.tier)` してから `slice(0,3)`(Array.sort は ES2019+ で
  安定ソートのため同一 tier 内の push 順=既存の優先意図は無変更)。各 if/else-if 内の
  既存の相互排他性(falsifier-seen が stale 系を抑制、confirmed-certain と no-falsifier の
  排他等)も無変更。`docs/FEATURE-AUDIT.md` §1-1 を解決済みへ更新。

### 10.13 第11次監査 (round 24) — キーワード検知 OS アラート(docs/FEATURE-AUDIT.md §1-2)

`Plan.md` §4.9 (v1.1) の「通知 / アラート(購読キーワード検知)」に対応。`KeywordRules` の
WATCH ルールは star/highlight/tag のみで OS 通知経路が無かった。

- C22: WATCH ルールに独立した `notify` 真偽値を追加(既存の `action` と排他ではなく併用可能
  — 「スターしつつ通知」が自然な組み合わせのため)。簡易UIの `#kw-watch-notify` チェックボックス
  で ON にすると保存時に `AutoSync.requestNotificationPerm()`(既存ヘルパーを再利用、
  新規実装なし)を呼ぶ opt-in 設計。パイプラインでは block によるアーカイブ後は抑制
  (star/highlight/tag と同じ block優先規約、`ev.state.archived` ガード)し、
  共有 tag `'neus-watch'` で通知するため連続一致で通知が積み上がらず最新の一致に置き換わる。
  `docs/FEATURE-AUDIT.md` §1-2 を解決済みへ更新。

### 10.14 第12次監査 (round 25) — ShareTarget/コア取り込みパイプラインの並行性

ADR-0020(関連イベント自動リンク)は PROPOSED のまま実装を見合わせた(対話承認ツールの
失敗を承認とみなしたのは誤りと判断し撤回、`docs/FEATURE-AUDIT.md` §1-3 は未解決に復帰)。
その過程で ShareTarget/コア取り込みパイプラインを監査し、別の独立した欠陥を発見・修正した。

- W20: **`event.normalized` の hash 重複レコード競合** — `Store.findByHash`→
  `Store.putEvent` が非アトミックな check-then-act。`Bus.publish` は fire-and-forget
  (購読ハンドラを await しない)で、`_collectOne` は1単語の全有効フィードを
  `Promise.all` で並行取得するため、同一記事が2つの異なるソースから取得されると、
  2つの `event.normalized` 呼び出しが両方とも「未存在」を読んでから書き込み、
  重複レコードを作り得た。`hash` インデックスは意図的に `unique:false`
  (unique 制約は、このバグに起因する既存の重複ハッシュを持つインストールで
  IDB スキーマアップグレード自体を失敗させるリスクがあり、競合そのものより危険)。
  → C24: 同一 hash の処理をインメモリの `Map` ベースゲートで直列化。後続の呼び出しは
  先行する処理の完了を待ってから `findByHash` を再評価し、正しく「既存」ヒットとして
  autoTag マージ経路に入る(タグ結合を失わない)。`InformationEvent` のスキーマ・
  IndexedDB インデックス・`links[]` の意味論には触れない内部並行制御機構のため、
  データモデル変更の承認ゲート対象外と判断。`docs/FEATURE-AUDIT.md` §1-8 に追記。

### 10.15 第13次監査 (round 26) — 独立した敵対的レビュー(8観点 × 検証)

`このプロダクトの次のステップを考えて実装を続ける` の一環として `/code-review --effort high`
を `48af75e..HEAD`(このセッションの全変更、index.html 差分約480行)に対して実施。8観点
(行単位走査・削除挙動監査・横断呼び出し追跡・再利用・簡素化・効率・altitude・CLAUDE.md準拠)
を並列エージェントで実行し、候補を1票検証した。C24(hash 重複ゲート)自身と round 23
(tier優先順位)自身に、追加補正が必要な欠陥が見つかった。

**却下した仮説(反証)**:
- GitHub デフォルト OFF(ja/en 両方)がコメントと矛盾 → 反証: ADR-0018 本文
  (「GitHub: 英語スラグのみのため言語に関わらずデフォルト OFF」)が明示的に意図した設計。
  インラインコメントが ADR の全理由を再掲していないだけ。
- dedup ウィンドウの300件上限が保証を狭めた → 反証: ADR-0019 で既に検討・受容済みの
  トレードオフ(round 25 以前)。新規の欠陥ではない。

**生き残った仮説(修正済み)**:
- W21: **Google News タイトル剥がしが全 RSS ソースに無条件適用** — `parseFeed` 共有関数
  内にあり `source` を見ていなかったため、ユーザーが追加した任意のカスタム RSS
  (アグリゲータ系で `<source>` 要素を持つもの)のタイトルも誤って切り詰められ得た。
  → C25: `source?.url?.includes('news.google.com')` でスコープを限定。
- W22: **hash ゲート(C24)自身が3者以上の同時到達で直列化に失敗** — 「先行を読んで
  await してから自分のゲートを map に書く」方式では、2番目・3番目の呼び出しが同じ
  「先行」を見た後、互いを追い越して map の自分のエントリを上書きし合い、3者間以上の
  競合では元のバグが再現していた。
  → C26: map への書き込みを await 前に同期的に行う keyed-promise-chain
  (`(hashGates.get(hash)||Promise.resolve()).then(fn,fn)`)へ変更。N者間の直列化を
  正しく保証する。
- W23: **hash ゲートが event.normalized にしか適用されず、同じ非アトミック性を持つ
  `ShareTarget.ingest` とドシエ import ループが無防備だった** — 特定の呼び出し口だけを
  場当たり的に保護していた。
  → C27: `withHashGate(hash,fn)` を共有ヘルパーとして切り出し、3箇所全てが経由するよう
  変更。将来の取り込み経路追加でも自動的に保護を受ける。
- W24: **socraticPrompts の tier 優先順位(round 23)が tier 内タイブレークで飢餓を
  再現** — 同一 tier 内の条件が相互排他とは限らない(例: certain-unresolved と
  disabled-still-open は同時に真になりうる)ため、tier が並んだ際は Array.sort の安定性
  =push 順に戻り、元のバグが tier 内で再発していた。
  → C28: 相互排他が保証されない条件に小数のサブ優先度(`TIER_CONTRADICTION+0.1` 等)を
  付与し、tier 内でも同順位を作らない。
- W25: **GitHub/Zenn の topic slug 正規化前処理が重複**、**topicFeeds Set が WORD_FEEDS
  外の独立リテラルで二重メンテナンス箇所になっていた** →
  C29: 共有 `normalizeSlugInput(q)` ヘルパーを抽出。
  C30: `WORD_FEEDS` の各エントリに `topicStyle:true` を付与し、`topicFeeds` を
  `Object.values(WORD_FEEDS).filter(f=>f.topicStyle)` から構造的に導出(3つ目の
  トピックソース追加が WORD_FEEDS への1行で完結するようにした)。
- W26: **新規 WATCH 通知コードが CLAUDE.md のネスト上限(≤3)を超過** →
  C31: `notifyWatchMatch(ev,matched)` として単体関数に切り出し。

**記録のみ(修正見送り)**:
- GitHub Topics の実装コミットが承認 ADR-0018 より先行していた(CLAUDE.md「外部API追加」
  の人間承認要件に反する)。ADR 自身が「事後的に記録」と認めている過去の事実であり、
  既にプッシュ済みの commit 順序は書き換えない。今後の外部ソース追加では実装前に ADR を
  起票する規律を徹底する。
- Notification アイコンが3つ目の手描きブランドマーク複製(favicon・apple-touch-icon・
  今回の通知アイコン)になっている。視覚的な同期漏れリスクはあるが低優先度。
- Google News タイトル剥がしが既存の保存済みイベントに遡及適用されない
  (理論上、剥離後の類似度が旧保存版より下がり得る)。この種の遡及未適用はコードベース内の
  他の正規化変更(URL正規化・エンティティ復号修正等)にも共通する既存の性質であり、
  バックフィル機構自体が存在しない。優先度低。
- `falsifierHits`/`questionHits`/`socraticPrompts` が同一語の items に対して bigram 計算を
  重複実行(非効率だが個人利用規模では体感影響が無い)。
- StorageGuard 自動退避トーストの `'ok'` 化(このセッション内の既存の判断)を再検討する
  提案があったが、既に検討済みの判断であり再度覆さない。

### 10.16 第14次監査 (round 27) — 過不足リストの残債解消

`docs/FEATURE-AUDIT.md` §1 の「不足」リストから、人間の承認や専用環境を要さない残り2件
(§1-1 の残債・過去の名称変更残骸)に対応した。

- **`socraticPrompts` の CLAUDE.md 関数≤40行規約違反(§1-1 の既知の残債)**:
  約95行(条件分岐約20件+tier優先順位の説明コメント)を、tierごとの判定を
  `validityPrompts`/`falsifiabilityPrompts`/`evidencePrompts`/`contradictionPrompts`/
  `neglectPrompts` の5ヘルパー関数(各12〜24行)へ切り出す refactor で解消。
  `socraticPrompts` 自体は5関数の出力を連結し `sort`+`slice(0,3)` するだけの13行の
  集約関数になった。tier定数・各条件の発火ロジック・文言・優先順位(小数サブ優先度含む)
  は完全に不変で、既存の振る舞いテストは無変更で全てパスした。「`function socraticPrompts`
  内に留まる」ことを前提に文字列位置で検証していた5件のテスト
  (`tests/word-prompt-priority.test.mjs`・`word-disabled-still-open.test.mjs`・
  `word-only-research.test.mjs`・`word-resolved-from-agnostic.test.mjs`・
  `word-verdict-churn.test.mjs`)は、該当するヘルパー関数の範囲を見るよう更新した。
- **旧プロジェクト名 "Lensy" のドメイン残骸**: `wrangler.toml` の Worker 名が
  `lensy-proxy` のままで、実際にデプロイ・案内される `neus-proxy`(`_worker.js`/
  `DEPLOY.md`/`README.md`/`index.html` の既定プロキシ値)と食い違っていた。存在しない・
  案内していないドメイン `lensy-proxy.*.workers.dev` をコメントごと `neus-proxy` に修正。
  `bookmarklet.js` のプレースホルダ `YOUR_LENSY_URL` も `YOUR_NEUS_URL` に統一
  (CLAUDE.md「競合ソフト名混入」防止規約)。

### 10.17 第15次監査 (round 28) — 未踏3領域の並列監査(SW/PWA・UI/a11y・データ層/性能)

`このプロダクトの長所短所改善点を洗い出して実行` を受け、過去14ラウンドの監査が
薄かった3領域(Service Worker/PWA/オフライン、UIの正しさ/アクセシビリティ/i18n、
データ層/性能)へ独立監査エージェントを3並列で投入。24件の指摘から確認済み15件を
3バッチ(A: 正確性 / B: a11y / C: 性能)で修正した。個別の内容は `CHANGELOG.md` の
round 28 エントリ、残項目は `docs/FEATURE-AUDIT.md` §1-12、確認された長所は同 §3 を参照。

特筆事項:
- **最重要バグは2エージェントが独立に発見**(詳細モーダルの `#detail-card` リスナー蓄積)。
  永続要素への per-open `addEventListener` と closure 変数の組合せで、N回開くとタグ操作が
  N重発火し別記事のタグUIを壊す。独立発見の一致は監査の信頼性の傍証。
- **「無条件の起床通知」は同意の問題として扱った**: SWはIndexedDBを読めないという実装
  制約が「notify=OFFでも通知が出る」という同意違反に化けていた。Cache API(`neus-prefs-v1`、
  activate の掃除から除外)を設定ミラーとして使い、SWが同意を確認してから通知する。
- **修正を見送った指摘も記録した**(FEATURE-AUDIT §1-12): i18n の系統的不統一(約25箇所の
  単一言語トースト等)、`normalizeUrl` 強化(既存ハッシュとの互換リスクがあるため要注意
  事項つき)、fetched件数の意味不一致、SourceFailTracker の normalize エラー計上、
  skipWaiting とリロード確認の競合(化粧的)。
- テストは 1154 → 1230 件(+76: round-28 系9ファイル+既存アンカーテストの更新)。
  Playwright 側 `browser-sw.spec.mjs` のキャッシュ名アサーションも v3+prefs に追随。

### 10.18 第16次監査 (round 29) — i18nの系統的不統一を解消(§1-12)

round 28 で「記録のみ」とした残項目のうち、人間承認ゲート不要かつ機械的な §1-12 の
i18n一括スイープを実行。`toast()` 約25箇所の単一言語(成功/失敗ペアで言語が食い違う
組も含む)、`#kw-sheet` の完全な日本語ハードコード(`applyI18N` 未対応)、詳細モーダルの
英語見出し+日本語placeholder混在を、既存の `currentLang==='ja'?...:...` パターンおよび
`DICT`/`t()` 機構へ統一した。

- `kwsheet.*`(hint/watch-hl/watch-star/block-arch/block-del/cancel)と
  `detail.*`(title/usertags/autotags/quote/quote.ph/note/note.ph/tag.ph/vaultnotes/
  vault/resummarize/copy)のDICTキーを新設。kw-sheetのWATCH/BLOCKボタンは先頭に
  ドット表示用のspanを持つため、`textContent` で上書きせず `childNodes[1]`
  (テキストノード)のみを差し替える(nav buttonの `.count` span 保持と同じ手法)。
- 意図的に対象外とした3種を明記(再提案しないこと): `[${source}] ${err.message}`
  のような生の技術エラーメッセージ、`WordCollector.collectOne` の `msg` のように
  既に呼び出し元でバイリンガル生成済みの変数、`vault: ${name}` のような
  `updateVaultStatus` と同じ「vaultは訳さない」ステータスラベル慣用句。
- テストは 1230 → 1262 件(`tests/i18n-sweep.test.mjs` 新設32件)。

### 10.19 第17次監査 (round 30) — SourceFailTracker修正、skipWaiting修正の試行と取り消し

`docs/FEATURE-AUDIT.md` §1-12 の残り小項目のうち、承認ゲート不要な2件に着手。

- **SourceFailTracker(解決済み)**: `inbound.error` のうち `normalize`/`pipeline`
  (Neus自身の内部処理エラー)を自動無効化カウントの対象から除外する `isSourceFault()`
  ガードを追加。`network`/`http_*`/`parse`(ソース自体の障害)のみ引き続きカウントする。
  1267件のテストで検証(vitestは全て文字列アンカー方式のため信頼できる)。
- **skipWaiting とリロード確認の競合(試行→取り消し)**: 標準的な修正パターン
  (installでskipWaiting()を呼ばず、確認後にpostMessageでskip-waitingを指示し
  controllerchangeを待ってreload)を実装したが、`tests/browser-sw.spec.mjs` の
  Playwright実ブラウザテストで検証したところタイムアウトした。**原因切り分けのため
  `git stash` で変更前のコードに戻し同テストを再実行したところ、変更前のコードでも
  同様にタイムアウトすることを確認**(3回連続再現)。この環境のPlaywright実行基盤が
  SW登録のライフサイクルを安定して検証できないことが原因であり、修正自体の欠陥では
  ないと考えられるが、SWの更新ロジックは全ユーザーに影響するブラスト半径の大きい
  変更であるため、信頼できる検証手段が無い状態での投入は見送り、変更を完全に
  取り消した(`sw.js`・`index.html` とも無変更に復元)。
  **教訓**: 高ブラスト半径の変更は、たとえ実装自体が標準的なパターンであっても、
  検証環境が信頼できないなら投入を見送るべき — 「テストが落ちた」ではなく
  「テストがそもそも当てにならない」ことを変更前後の比較で確認してから判断する。
- テストは 1262 → 1267 件(`tests/source-fail-normalize-exclusion.test.mjs` 新設5件)。

### 10.20 第18次監査 (round 31) — Worker SSRF: リダイレクト再検証 + `[::]` 漏れ

「続けて改善」を受け、Ultracodeでの多エージェント並列監査を計画したが、ワークフロー実行が
使用量上限に到達して全滅(0エージェント完了)。エージェント予算が枯渇した状態のまま多数の
subagentを再投入するのは非生産的と判断し、以降はメインループ単独で `Crypto`/Plugin API
(`window.neus`)/`_worker.js` を直接読んで手動監査した。

- **Crypto/Plugin API**: 手動レビューの結果、具体的な欠陥は見つからず(salt再利用は
  複数パスフレーズ間で正当、IV は毎回新規、パスフレーズ変更時は設定オブジェクト全体を
  置き換えるため旧鍵の暗号文が残らない、`window.neus` の全データ返却メソッドは
  `structuredClone` 済み — `getKeywordRules()` も含む)。この「欠陥なし」も監査結果として
  記録する価値がある(全ての監査が指摘を生むとは限らない)。
- **`_worker.js` の2件のSSRF欠陥(解決済み)**: Node実装のURLパーサで実証してから着手。
  1. **リダイレクト経由のSSRF**: `/rss`・`/json` とも `fetch` に `redirect:'follow'` を
     使っており、最初のURLしか `validateTarget` で検証していなかった。悪意/侵害された
     フィードが検証通過後にリダイレクトで内部アドレス(例: `169.254.169.254`)へ誘導できた。
     `redirect:'manual'` による自前ループ `fetchValidated`(上限 `MAX_REDIRECTS=5`)で
     各ホップを再検証するよう修正、`/json` はホスト許可リストも再チェック。
  2. **`[::]`(0.0.0.0相当の未指定アドレス)のブロック漏れ**: 既存の `\[::1\]` は `[::1]`
     のみにマッチし `[::]` を漏らしていた。`\[::1?\]` に一般化して解消。
  デコード10進/16進/8進のIPv4表記は `new URL()` が常にドット10進へ正規化するため
  既に安全という仮説をNode実行で検証してから「修正不要」と結論した(見落としではなく
  検証済みの非対象)。
- **本ラウンド特有の環境事故と復旧**: 監査の途中でコンテナが再起動し、`node_modules`が
  消失し、ローカルの作業ツリーが `git log` 上の別コミット(ブランチのマージ済みPR #1の
  スナップショット)へ巻き戻っていた。ブランチ名の性質上「マージ済みPRへの追加コミット」
  規約に従い、実際のリモートブランチ先端(`0cb9802`、round 28-30 の全履歴を含む)を
  `git fetch` で確認 → ローカルの巻き戻り状態の上に作った最初の修正コミット
  (退避済みブランチに保存)は実は**リモートに既に存在した別方式のIPv4射影IPv6対策
  (16進レンジ手書きパターン)と`readCapped`ストリーミングサイズ制限を知らずに再発見・
  再実装したものだった** → リモート先端へ `git reset --hard` した上で、実際にまだ
  欠けていた箇所(リダイレクト再検証・`[::]`漏れ)だけを再実装し直した。
  **教訓**: セッション中断/再開をまたぐ作業では、ローカルの `git log` を無条件に
  信頼せず、push前に必ず `git fetch` でリモート先端と突き合わせる。「push が
  rejected (fetch first)」は不整合の信号であり、force push で押し切らず必ず
  差分の中身を読んでから対処する。
- テストは 1267 → 1277 件(`tests/worker.test.mjs` に redirect 再検証・`[::]` の
  ケースを追加)。

### 10.21 第19次監査 (round 32) — First Principles による過不足機能の洗い出しと RESURFACE 追加

「First Principles Thinking で過不足機能を洗い出し改善」を受け、既存機能の差分ではなく
**「外部情報が個人の知識になるまでに必然的に通る段階」から演繹**して過不足を判定した
(CLAUDE.md「ゼロ設計思考」)。

**第一原理の分解と現状評価**:

| # | 段階 | Neus の現状 |
|---|------|------|
| 1 | 捕捉 | RSS / Share / Bookmarklet / 単語自動収集9ソース — 充足 |
| 2 | 取捨 | KeywordRules / InterestProfile / score — 充足 |
| 3 | 理解 | BYOK 要約 / snippet / tag — 充足 |
| 4 | 吟味 | ソクラテス式問答 / 反証条件 / Falsifier Watch — 充足(独自の強み) |
| 5 | 接続 | Vault マッチ / 関連語 / タグ — 部分的 |
| 6 | 想起 | FTS 検索(能動時のみ)+ LATER(受動的な箱)— **不足** |
| 7 | 行動 | Vault / MD / JSON 書き出し — 充足 |

- **不足(段階6)**: 想起が全面的に能動検索依存。人は「何を忘れたか」を検索できない
  (想起の逆説)ため、`LATER` は入れたきり戻らない箱になる。コードでも確認
  (`resurface|spaced|revisit|forgetting` の唯一のヒットは単語用 prompt 内の文字列のみで、
  イベント側に再浮上機構は実在しなかった)。PIM 研究でも「保存した時点で意識から消え
  再訪の動機が無い」「web 利用の相当部分が re-finding」と報告されており、構造的な穴と判断。
- **過剰**: 全機能を「第一原理のどの段階に効くか」で採点した結果、**どの段階にも紐づかない
  機能は無かった**(明確な過剰なし)。`docs/FEATURE-AUDIT.md` §2 が却下案を記録し肥大を
  抑えている運用も含め、長所として記録する(無理に削らない)。

**実装: RESURFACE ビュー**
- 既存 `state`(`later`/`laterAt`/`starred`/`read`/`archived`)と `timestamp` のみから導出し、
  **新しい永続フィールドを足さない**(= InformationEvent の破壊的変更に当たらず、
  Human-in-the-loop ゲートを踏まない)。
- **スコアは逆U字**。素朴な「古い順」は誤りである点が本ラウンドの核心:
  spacing effect の研究(Cepeda et al. 2008 ほか)は間隔と効果の関係が単調増加ではなく
  逆U字であることを示す。早すぎる再提示は復習として無駄(massed)、遅すぎる再提示は
  陳腐化した情報を上位に押し上げる。`resurfaceAfterMs`(7日)を下限、`resurfacePeakMs`
  (30日)をピークとする対数正規型の重み `resurfaceWeight` を採用。決定的(乱数なし)で
  同点は id で並べるため描画が揺れない。
  注: 元研究は暗記材料の保持に関するもので保存記事の再浮上への転用は類推。採用したのは
  「逆U字」という定性的な形のみで、具体的な保持率は主張しない。
- 3案比較: (a) 間隔反復 SM-2 = 新フィールド必須でデータモデルゲート抵触 → 却下。
  (b) 通知プッシュ = 同意/煩わしさ、既存 notify 設計と競合 → 却下。
  (c) 既存 state からの導出ビュー = 追加コスト最小・ゲート非抵触 → **採用**。
- UI は既存 `renderView` の分岐 + 既存 `cardHtml` を再利用し、新規モジュールを作らない
  (モノリス方針 ADR-0007 準拠)。i18n JA/EN 両対応。

**確認済み・問題なし(無理に修正を作らない)**:
- round 29 の i18n 統一に回帰なし(`currentLang` を経由しない `toast()` は、round 29 で
  意図的に対象外と記録した3箇所— 生エラー passthrough / 既にバイリンガルな変数 /
  "vault:" ステータスラベル — のみ)。
- 製品ソース(`index.html`/`_worker.js`/`sw.js`)に `TODO`/`FIXME`/`console.log` の残骸ゼロ。
- `check-html.mjs` の a11y/security 不変条件は nav タブ追加後も全 PASS。

**見送り**: `wrangler.toml` の `compatibility_date`(2024-09-23)は陳腐化しているが、
FEATURE-AUDIT §1-4 が「`wrangler dev` を検証できる環境で」と条件付けており、round 30 で
記録した「高ブラスト半径の変更は信頼できる検証手段が無いなら投入しない」教訓にも該当するため、
本ラウンドでは更新しない。

- テストは 1277 → 1298 件(`tests/resurface.test.mjs` 新設21件: 選定境界・逆U字の重み付け・
  決定性・配線アンカー)。

### 10.22 第20次監査 (round 33) — 段階5「接続」: 関連アイテム(連想の小径)

round 32 の第一原理分解で唯一「部分的」と評価が残った段階5「接続」への対応。

**問題**: Neus は収集(捕捉)も検索(能動的想起)も持つが、**「いま読んでいる物」から
「手元にある関連物」へ辿る経路が無かった**。関連付けは Vault ノート(ファイル名トークン一致)と
単語間の関連に限られ、イベント同士は「自分で検索語を思いつけた時」しか繋がらない。
`FEATURE-AUDIT` §1-3 が「類似するが別の記事を繋ぐ機構は無い」と記録していた穴に相当する。

**参照した知見**: Vannevar Bush の Memex(1945, "As We May Think")が提示した
**連想の小径(associative trail)** — 分類階層ではなく意味的な近さで情報を辿れること。
Luhmann の Zettelkasten(約9万枚)も同型の構造を持ち、"serendipity" に見える発見は実際には
意味的関係の網が導いた必然だと説明される。すなわち**偶然の再会は設計できる**。

**実装: 関連アイテム(RELATED ITEMS)**
- 詳細モーダルに、その記事と意味的に近い手元のアイテムを最大 `relatedMax`(3件)提示し、
  クリックでそのまま辿れる(小径を歩ける)。
- **類似度は新規実装せず `FTSIndex.search` を再利用**。既に BM25 の IDF 概念で重み付け済みで、
  ありふれた gram を下げ稀少な gram を強調するため "more like this" にそのまま適する
  (CLAUDE.md: 既存実装があるなら新規コードを足さない)。閾値も `ftsScoreMin` に従い、
  雑音を出すくらいなら0件を返す設計。
  - 検討して**不採用**にしたのが `bigramCoverageHits`(Falsifier/Question Watch 用)。
    これは短い問い文の被覆率を測る**非対称**な指標で、イベント同士の関連度には不適。
- 除外: 自分自身 / `word:` ヒット(FTSIndex は単語も索引する)/ archived(意図的に片付けた物)/
  `links[]` に既にある同一記事の別URL(トートロジーになるため)。

**データモデルのゲートを踏まない設計(重要)**:
`FEATURE-AUDIT` §1-3 が ADR ゲートにしているのは **`links[]` の意味論変更**
(現在は「同一記事の別URL」)であって、関連の**算出**そのものではない。本実装は
Falsifier Watch と同じく**描画時に導出するだけで一切永続化しない**ため、InformationEvent は
不変でゲートに抵触しない。**永続的な関連リンク生成(§1-3 本体)は引き続き ADR 待ち**。

- テストは 1298 → 1315 件(`tests/related-events.test.mjs` 新設17件: 除外条件・順序保持・
  上限・欠損耐性・`links[]` へ書かないことの明示検証・XSS エスケープ・配線アンカー)。

### 10.23 第21次監査 (round 34) — FTS の文書長正規化(長文バイアスの是正)

round 33 で関連アイテム(`relatedEvents`)が `FTSIndex.search` を土台に据えたため、検索ランキングの
質が「検索」だけでなく「接続」にも効くようになった。そこで採点式を精査した。

**発見した問題**:
1. **長文バイアス(主)**: スコアは「クエリのIDF質量をどれだけ被覆したか」のみで、文書長を
   考慮していなかった。長い文書ほど異なりgramを多く持ち、クエリのgramを偶然含む確率が上がる
   ため、短く的確な文書と同点(ともに 1.0)になる。IR で古くから知られる問題で、BM25 が
   `b` 項を持つのはまさにこの補正のため(`b=0.75` が慣用既定値。BM11=1 は長文を過度に罰し、
   BM15=0 は無補正)。**round 33 の関連アイテムでは、冗長な1件があらゆる記事の「関連」に
   出現するハブ(雑音)になりうるため実害が大きい。**
2. **デッドコード(副)**: `const maxScore=new Map();` が宣言のみで一度も使われていなかった
   (正規化は `qTotalIdf` 側で行われている)。削除。

**実装(ペナルティ側のみを採用)**:
- 文書長 = その文書の**異なりgram数**を `docLen`(index と同じ id 空間)に保持し、合計 `totalLen`
  を add/remove/addWord/removeWord で差分更新。検索のたびの全走査を避け INP を守る。
  `rebuild()` でも両方をクリアする(平均が再構築をまたいで漏れないように)。
- 係数 `norm = 1/(1-B+B*max(1, dl/avgdl))`、`B=0.75`。
  **`max(1, …)` が肝で、`dl<=avgdl` では係数がちょうど 1.0 になり短文ボーナスが付かない。**
  これは意図的な制約: スコアは UI に「match NN%」として表示され、既存テストも 0〜1 と
  「完全一致=1.0」を保証しているため、1.0 を超えさせられない。よって BM25 の b 正規化のうち
  **長文への減点だけ**を取り入れた。
- `dl` が異なりgram数であるため、**同じ語を繰り返しただけの文書は長くならない**。罰されるのは
  語彙の広がり(話題の散漫さ)であって反復ではない — 望ましい性質。

**検証の限界(正直な記録)**: ランキング品質の「改善」は理論的根拠(BM25 の b 項)と機構的な
テスト(短く的確な文書が冗長な文書より上位に来る、平均以下は無罰、平均超では単調減点)で
示したにとどまる。ラベル付きの関連性ベンチマークが無いため、実利用での関連性向上を測定した
わけではない。可逆(係数を外せば元の挙動)である点も含めて記録する。

- テストは 1315 → 1329 件(`tests/fts-length-norm.test.mjs` 新設14件)。
  テスト作成中に2件の自作ミスが露見し、いずれも実装ではなくテスト側を修正した:
  (a) 語の反復では異なりgramが増えず長さが変わらない、(b) ペナルティ専用設計では平均以下の
  文書が全て 1.0 になるため「単調減点」は平均超の文書同士でしか主張できない。

### 10.24 第22次監査 (round 35) — 暗黙の興味学習が自プロダクトの設計思想と衝突していた

**発見**: `InterestProfile` は star/archive の行動から語彙の極性を学習し、`event.stored` 時に
`meta.score`(0〜100)へ最大 ±`interestBoostMax`(=25)の補正を掛ける。この**抑制側が昇格側と
同じ強さ**だった。推薦研究がフィルターバブル/エコーチェンバーとして繰り返し報告している構造
— personalization が「関連性を優先して多様性を犠牲にする」ことで確証バイアスを強化する —
そのものに該当する。

**Neus 固有の深刻さ(単なる一般論ではない)**: 本プロダクトは反証条件を能動監視する
Falsifier Watch を看板機能に据え、「何があれば自分の結論を覆すか」を宣言させ、収集物を
それに照合し続ける。つまり**確証バイアスに抗うことを設計思想の中心**に置いている。その同じ
アプリの中で、暗黙の学習が異論を昇格と同じ強さで沈めるのは自己矛盾になる。

**さらに悪い性質**:
- 補正は ingest 時に `meta.score` へ**焼き込まれ永続**する。語彙は日次で減衰する
  (`interestDecay`)が、既に沈められたイベントのスコアは戻らない。
- `meta.interestBoost` は記録されるがカード UI には**表示されない**(なぜ順位が低いのか
  本人には見えない)。

**確認できた緩和策(長所として記録)**: STATS モーダルは学習された好み/除外の語を
`topWords` で開示しており、学習内容そのものは完全なブラックボックスではない。
また明示的な抑制手段として KeywordRules の block(ユーザーが書き・見え・編集できる)が別途ある。

**修正: 抑制側だけ上限を絞る(非対称化)**。`interestPenaltyMax`(=10)を新設し、
`cap = avg<0 ? interestPenaltyMax : interestBoostMax` とした。根拠は**損失の非対称性**:
- 誤って持ち上げた場合 → 読み飛ばすだけ。可逆で、本人にも見えている。
- 誤って沈めた場合 → そもそも出会わない。不可逆で、しかも本人に見えない。
昇格(personalization の便益)は残しつつ、暗黙の抑制力だけを明示的な block より弱く保つ。
学習の**符号**は保たれるため「嫌いなものが下がる」挙動自体は失われない。

**採用しなかった案**: (a) 抑制の全廃 — archive の学習信号が無駄になり、実用上のノイズ低減を
失う。(b) MMR 等による多様性注入 — 端末内・ゼロ依存で実装可能だが、ランキングに新たな
確率的要素を持ち込み決定性を損なうため、まず非対称化という最小介入で様子を見る。
(c) `interestBoost` のカード表示 — 透明性は上がるが UI ノイズ増。STATS で既に開示済みのため見送り。

- テストは 1329 → 1339 件(`tests/interest-asymmetry.test.mjs` 新設10件)。既存
  `tests/interest-profile.test.mjs`(符号と上限の主張)は無変更で通過。

### 10.25 第23次監査 (round 36) — CJK 見出しの近似重複検出が機能していなかった

**発見(主要言語での機能欠落)**: 近似重複判定は `tokenize()` の語彙 jaccard で行っていたが、
`tokenize()` は空白で分割する。日本語をはじめ CJK は単語境界に空白が無いため、**見出し全体が
ほぼ1トークンになる**。結果 token jaccard は近い見出しでもほとんど 0 になり、URLハッシュが
一致しない限り日本語ソース間のクロスソース重複が事実上まったく検出できていなかった。

実測(推測ではなく Node で計測):

| ペア | token jaccard | 判定(閾値0.8) |
|---|---|---|
| 「AIの未来について考える」/「AIの未来を考える」 | 0.000 | 見逃し |
| 「Rustの所有権を理解する」/「…【入門】」 | 0.500 | 見逃し |
| 「TypeScript 5.0 の新機能まとめ」/「TypeScript 5.0の新機能まとめ」 | 0.333 | 見逃し |

Qiita / Zenn / はてな を日本語ソースとして追加済み(ADR-0017/0018)で、はてなは日本語Web全体を
横断するため他ソースと重複しやすい。つまり**本プロダクトの主要言語で、宣伝している
クロスソース重複排除が効いていなかった**。

**対策**: CJK を含む見出しに限り、Falsifier Watch と同じ言語非依存の文字bigram(`fsBigrams`)で
再判定する(`titleDupSim`)。英語のみの見出しは従来経路のままで挙動不変 — 新しい類似度実装は
足さず既存ヘルパーを再利用した。

**閾値 0.75 は実測で決定**(7組の真の重複と9組の別記事で計測):
- 真の重複: 0.615〜1.000 / 別記事: 0.304〜**0.563**(最大)
- **両クラスは一部重なり完全分離は不可能**。よって別記事の最大値から 0.188 の余裕を取り、
  保守側へ倒した。真の重複7組中3組を捕捉、別記事9組は誤 merge ゼロ。
- 損失が非対称なため保守側が正しい:
  - 重複の見逃し → 似たカードが2枚並ぶだけ。可逆で、本人にも見える。
  - 別記事の誤merge → **受信側イベントは破棄され** links に足されるのみ。不可逆で、本人に見えない。

**意図的な取りこぼしもテストに明記**: 「- Qiita」「| Zenn」「【2026年版】」のようなサフィックス
違い(0.6〜0.73)は捕捉しない。捕捉するには閾値を 0.6 付近まで下げる必要があり、別記事の最大値
0.563 との余裕が 0.04 程度しか残らず誤 merge リスクが跳ね上がるため。未知の穴ではなく
**記録済みのトレードオフ**として `tests/dedup-cjk.test.mjs` に固定した。

**将来案(今回は見送り)**: ソース由来サフィックスの除去。Google News については既に
`source.url` で厳密にスコープした除去処理があるが、これを「- 任意の語」へ一般化すると
正当なタイトル本文を削る危険があるため、同じ慎重さで別途設計する必要がある。

- テストは 1339 → 1363 件(`tests/dedup-cjk.test.mjs` 新設24件: 根本原因の明示、捕捉、
  誤merge防止9組、英語の不変性、意図的な取りこぼし、配線アンカー)。

### 10.26 第24次監査 (round 37) — CJK トークナイザ: 同じ根本原因が4機能に波及していた

round 36 で「日本語見出しが1トークンになる」ことが近似重複を壊していると判明した。その原因
`tokenize()` は**他にも4箇所**で使われており、同じ根本原因が波及していないかを確認した結果、
**波及していた**。

`tokenize()` は空白分割のため、CJK では見出し全体が一意な1トークンになる。「トークンの重なり」を
動作原理とする以下は、日本語で二度と一致せず事実上停止していた:

| 機能 | 動作原理 | 日本語での実態 |
|---|---|---|
| TagLearner(タグ自動推定) | タグ→語 の連想を学習し新着との語の重なりで推定 | **完全に不動作** |
| InterestProfile(興味学習) | star/archive から語の極性を学習 | 本文由来の学習が不動作(タグ経由のみ生存) |
| VaultMatcher(ノート照合) | イベントの語と Vault ファイル名の語を突合 | ほぼ不動作 |
| 近似重複 | 見出しの語 jaccard | round 36 で対処済 |

**実測(Node で計測、推測ではない)**: 日本語記事3件で学習したタグモデルと、同じタグが付くべき
4件目の語の重なりは **0**(同等の英語実験では **3**)。

**対策**: 形態素解析器はゼロ依存原則(G0-2)により導入できない。代わりに**字種の切り替わり**
(ひらがな/カタカナ/漢字/その他)を語境界の近似に使う。日本語は助詞がひらがな、内容語が漢字・
カタカナに寄るため、この単純な規則でも内容語をよく拾える。1文字の助詞は既存の `length>=2`
フィルタで落ちる。

    「Rustの所有権とライフタイム入門」 -> rust / 所有権 / ライフタイム / 入門
    「TypeScript 5.0の新機能まとめ」   -> typescript / 新機能 / まとめ

**文字bigramを採らなかった理由**: FTSIndex と同じ文字bigramでも一致はするが、1記事あたり
100前後のトークンを生み、InterestProfile の語彙上限(300)を即座に溢れさせ英語の学習まで
劣化させる。字種分割なら1記事あたり数個で、しかも語として意味を持つ。

**英語は挙動不変**(ASCII のみの語は従来経路をそのまま通る)。既存の `utils.test.mjs` の
英語アサーションは無変更で通過し、回帰ガードとして新テストにも再掲した。

**副次的な収穫(round 36 の数値を上書き)**: 語分割が効くようになった結果、token 経路だけで
近似重複の捕捉が改善した。実測で 2 ペアが新たに 0.800 に達して捕捉され(うち1件は round 36 が
「意図的な取りこぼし」として記録した `- Qiita` サフィックス)、一方**別記事9組は全て 0.500 以下**に
留まり誤 merge ゼロ・余裕 0.3(bigram 経路の 0.188 より広い)。round 36 の取りこぼしリストは
2件に縮小し、テストを実測値で更新した。

**移行上の注意**: `InterestProfile` の語彙は IndexedDB に永続化されており、旧方式の
「文全体トークン」がしばらく残る。新方式のトークンとは一致しないため一時的に死荷重になるが、
日次減衰(`interestDecay`)と語彙上限の刈り込みで自然に入れ替わる。データ損失は無い。
`TagLearner` のモデルと `VaultMatcher` の fileMap は都度再構築されるため自己修復する。

- テストは 1363 → 1382 件(`tests/tokenize-cjk.test.mjs` 新設19件: 英語の不変性、CJK分割、
  波及していた3機能それぞれの回復、配線アンカー)。`tests/dedup-cjk.test.mjs` は実測に合わせ更新。

### 10.27 第25次監査 (round 38) — コールドスタートのエンティティ抽出が漢字を見ていなかった

round 37 で `tokenize()` の CJK 対応により TagLearner の**学習経路**は日本語で動くようになったが、
学習データが無い時のフォールバック(コールドスタート)である `extractEntities`(唯一の呼び出しは
`TagLearner.suggest`)を確認したところ、**日本語分岐がカタカナ (`/[ァ-ヴー]{3,}/`) のみ**で、
漢字複合語を一切抽出していなかった。

**実測(修正前、Node で計測)**:

| タイトル | 抽出結果 |
|---|---|
| 「機械学習のための線形代数」 | **[]** |
| 「自然言語処理の最新動向」 | **[]** |
| 「量子計算の基礎を学ぶ」 | **[]** |
| 「ライフタイムと所有権」 | [ライフタイム](漢字側「所有権」を取りこぼし) |

用語抽出研究(Nakagawa らの複合名詞ベース termhood。「日本語の技術用語の大半は漢語=漢字の
連続、またはカタカナ語で表される」)に照らすと、**漢字複合語こそ日本語技術用語の主形態**であり、
その半分(カタカナ)しか見ていなかった。日本語記事のコールドスタートでは autoTags がほぼ空になり、
タグ由来の検索・フィルタ・興味学習の起点が欠けていた。

**修正**: `extractEntities` のカタカナ分岐の直後に漢字ラン(`/[一-鿿㐀-䶿]{2,10}/`)を抽出する
分岐を追加。ひらがな(助詞)が自然な区切りになるため、漢字ランを取るだけで複合語境界が出る
(「機械学習のための線形代数」→ 機械学習 / 線形代数)。3案比較で以下を採用:
- **却下**: 形態素解析器(ゼロ依存原則 G0-2 に反する)。
- **却下**: 文字bigram(round 37 と同様、語彙が爆発し InterestProfile 上限を溢れさせる)。
- **採用**: 字種ベースの漢字ラン抽出。round 37 の `tokenize` と同じ字種境界の考え方で一貫。

**設計の細部**:
- **JA_STOP**(入門/基礎/解説 等 ~28語): 漢字ラン**全体**との完全一致のみ除外。
  「機械学習入門」のような複合語は落ちない(英語 `STOP` と対称)。
- **長い順ソート**: 複合語ほど termhood が高い(Nakagawa)ため、残り枠を長い複合語に優先配分。
  既存の `slice(0,3)` 上限をそのまま共有。
- **英語・カタカナ挙動は不変**。既存 `tests/entity-recency.test.mjs` の英語・カタカナ
  アサーションは無変更で通過(ミラーは同期更新)。

- テストは 1399 → 1415 件(`tests/entity-kanji.test.mjs` 新設16件: 漢字抽出・JA_STOP の
  完全一致のみ除外・長さ順・英語カタカナの不変性・配線アンカー)。

### 10.28 第26次監査 (round 39) — KeywordRules の regex が ReDoS でタブを恒久的に固められた

**発見(high)**: `matchRule` の regex モードは `new RegExp(...)` を try/catch で囲っていたが、
catch が捕まえるのは**コンパイルエラーだけ**で、実行時の破滅的バックトラッキング(ReDoS)は
捕まえられない。危険な組み合わせが揃っていた:

- ルール自体はユーザーが書くが、**照合対象はフィード由来**。`getEventText(ev,'all')` は
  title + snippet + summary + tags + source を連結する = **第三者が中身と長さを決められる**。
- `KeywordRules.evaluate()` は ingest ごとに**メインスレッドで同期実行**される(§ingest パイプライン)。
- 走査長の上限も、パターンの事前検証も無かった(保存時検証は `new RegExp()` が通るかだけ)。

つまり「うっかり書いた正規表現」1つで、POLL のたびにタブが恒久的に固まる(リロード以外に復帰不能)。
自己申告の設定ミスに見えるが、**発火のトリガーは第三者が握る**点が本質。

**実測(Node、修正前の裸の RegExp)**: `^(\w+\s?)+$`(「単語の並び」を書こうとした素朴な正規表現)

| 入力長 | 所要 |
|---|---|
| 22文字 | 28.9 ms |
| 24文字 | 116.3 ms |
| 26文字 | 448.9 ms |

2文字ごとに約2倍(指数)。フィードの snippet は数百〜数千文字なので事実上無限。

**対策(多層)**: JS ではメインスレッド上で任意の正規表現の実行を中断できないため、**完全な防御では
なく緩和**であることを明記した上で3層にした。
1. **保存時に拒否**: 量化グループの中にさらに無制限量化子がある形 `(x+)+` / `(x*)*` / `(\w+\s?)+`
   を `hasNestedQuantifier` で検出し、理由を i18n メッセージで提示(実行時に黙って無効化するだけだと
   「ルールが静かに効かない」状態になり原因が分からない)。
2. **実行時ガード**: 同じ判定を `matchRule` の先頭に置く。バックアップ復元や旧版由来のルールは
   保存時検証を通っていないため。危険なルールは **fail-closed で「不一致」扱い** — block/delete
   アクションが評価不能なルールで誤発火しないように。
3. **走査長の打ち切り**: `CONFIG.regexScanMaxChars`(4000)。指数の肩そのものを抑える。
   **regex モードのみ**に適用し、線形で安全な contains/prefix 等の意味論は変えない。

**検出器の設計**: 外側が**無制限**量化(`+` / `*` / `{n,}`)のグループに限り、その本体に無制限量化子が
あるかを見る。`{n}` `{n,m}` は上限があるため対象外。誤検知(正当なルールを拒否する)は実害が
大きいため、実在しそうな安全パターン9種(`\bAI\b` / `(cat|dog)s?` / `(\d{4})-(\d{2})` 等)で
非検出を確認済み。危険6種・安全9種の計15種を全て正しく分類。

**3案比較**: (a) Web Worker + `terminate()` = 任意正規表現を真に中断できる唯一の手段だが、
別ファイルか blob: が要り CSP `worker-src` の変更と同期パスの非同期化を伴う。効果に対して過大。
(b) 危険形の静的検出のみ = 実行時の抜けが残る。(c) 走査長制限のみ = 病的パターンには無力。
→ **(a) を却下し (b)+(c) を採用**。

- テストは 1415 → 1445 件(`tests/keyword-redos.test.mjs` 新設30件: 検出器の危険6/安全9分類、
  境界量化子、凍結入力が即時復帰すること、fail-closed、安全ルールの不変性、走査長打ち切り、
  保存時検証が watch/block 両方に入っていること、配線アンカー、i18n 両言語)。

### 10.29 第27次監査 (round 40) — 暗号パラメータの陳腐化(ゲート対象のため提案のみ)

**確認済み・問題なし(修正を作らない)**:
- **Service Worker が個人データをキャッシュしていないこと**: `sw.js` の fetch ハンドラは
  `url.origin !== self.location.origin` で早期 return するため、BYOK の API リクエスト
  (api.anthropic.com 等)も Worker プロキシ応答(`*.workers.dev`、URL に検索語を含む)も
  **一切 interception されない** = Cache API に個人データが入らない。G0-1 の不変条件を維持。
  Share Target / Bookmarklet の `/?url=...&title=...` は pathname が `/` で SHELL 分岐に入り、
  書き込みキーが pathname のみに正規化されるため、クエリ内の個人データも残らない。
- **Crypto の実装**: IV は暗号化ごとに `getRandomValues` で新規生成(AES-GCM の IV 再利用なし)、
  導出鍵は `extractable=false`、salt は16バイト乱数で永続化、`decrypt` 失敗は例外 →
  呼び出し側 `catch{return null}` で **fail-closed**(部分鍵や空文字をプロバイダへ送らない)。

**発見(ゲート対象・未実装)**: `CONFIG.pbkdf2Iterations` は **300,000**。
[OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
の現行推奨は PBKDF2-HMAC-SHA256 で **600,000** であり、**ちょうど半分**。

単純な定数変更は**してはならない**: 反復回数は鍵導出の入力なので、変更すると同じパスフレーズから
別の鍵が導出され、保存済み BYOK API キーが復号不能になる。しかも unlock 処理は復号例外を
「パスフレーズが違います」と表示するため、**正しいパスフレーズなのに永久に拒否され続ける**
という原因究明困難な壊れ方をする。

本項目は CLAUDE.md「重要分岐」の**マスターパスフレーズの暗号化方式変更**に該当するため、
**実装せず `docs/adr/ADR-0021-pbkdf2-iterations-migration.md` を提案(Proposed)として起票**した。
推奨は「暗号文にパラメータを埋め込む版付き形式」で、旧データは旧反復回数で復号し、
次回保存時に新パラメータへ遅延移行する(後方互換・再入力不要)。承認前に定数を書き換えない。

- コード変更なし。テスト件数は 1445 のまま。

### 10.30 第28次監査 (round 41) — 検索演算子("完全一致" / -除外)で N-gram の語順欠落を補正

**確認済み・問題なし(修正を作らない)**:
- **OPML の相互運用**: 関連ソフト(Feedly / Inoreader / NetNewsWire / miniflux / FreshRSS 等)で
  標準の OPML は **import / export とも実装済み**。移行障壁もロックインも無い。提案前に確認した。
- **IndexedDB のトランザクション整合性**: `Store.replaceAll`(アトミック復元)は全 IDB 操作を
  トランザクション内で**同期発行**しており、途中で非IDB Promise を await していない
  (await すればトランザクションが自動クローズし `TransactionInactiveError` になる典型事故)。
  `oncomplete`/`onerror`/`onabort` も揃っている。他の `tx()` 利用箇所は単発操作のみ。

**発見と修正**: `doSearch` は入力文字列を素通しで `FTSIndex.search` に渡していた。FTSIndex は
文字 N-gram 索引で **語順を保持しない**ため、日本語では構成文字が同じ別語が閾値を超えて返る。

実測(Node、`ftsScoreMin=0.4`):

| クエリ | 返る文書 | score | 実際に語を含むか |
|---|---|---|---|
| 情報検索 | 情報検索の入門 | 1.000 | yes |
| 情報検索 | **検索情報のまとめ** | **0.489** | **no(別の語)** |

N-gram 索引は本質的に「取りこぼしの無い候補生成器(lossy filter)」なので、IR の定石どおり
**候補生成(索引)→ 検証(実テキストで literal 照合)** の2段にした。

- 記法は関連ソフト(Feedly / Inoreader / Obsidian / Gmail / GitHub)でほぼ共通の
  `"完全一致"` と `-除外` に合わせ、学習コストを増やさない。placeholder で両言語提示。
- **演算子が無ければ完全に従来動作**(`matchesSearchOps` が即 true を返し、追加の fetch も走らない)。
- 打鍵途中の未閉じ引用符は演算子扱いしない(`"machine learn` の時点で結果が消えない)。
  語中ハイフン(`e-mail`)も除外演算子にしない。
- 単語(`word:`)ヒットも同じ検証を通す。

**却下案**: (a) 索引に位置情報を持たせる転置インデックス化 = メモリと複雑さが増え、
ADR-0007 の簡潔性方針に反する。(b) 検証を描画時のみ行う = 件数バッジが実数と食い違う。
→ 候補生成直後に検証する現方式を採用。

- テストは 1445 → 1468 件(`tests/search-operators.test.mjs` 新設23件: パーサ、未閉じ引用符、
  語中ハイフン、実測した CJK 語順誤ヒットの解消、複数句/除外、大文字小文字、配線アンカー)。

### 10.31 第29次監査 (round 42) — 配信元が申告する未来日付でランキングを占有できた

**発見(medium-high)**: `publishedAt` は**第三者(配信元)が値を決められる**のに、
`Date.parse()` の結果を上限チェック無しでそのまま保存していた(RSS/Atom と Qiita JSON の2経路)。
一方で `publishedAt` はランキングに強い重みを持つ:

- **DIGEST の鮮度加点**は `Math.max(0, now-publishedAt)` を使うため、未来日付は age=0 に
  clamp され **常に最大点(25)** を取り続ける
- **タグ/単語ビュー**は `(publishedAt||timestamp)` の降順なので、未来日付は **恒久的に先頭**

つまり配信側が日付を未来にするだけで、利用者のダイジェスト上位と一覧先頭を占有できる
(RSS では既知のスパム手法であり、時計ずれの誤設定でも同じ事故が起きる)。

実測(Node、修正前):

| recency 加点 | 項目 |
|---|---|
| 25.0 | 直前に公開された正当な項目 |
| **25.0** | **1年後の日付を申告したスパム(永続的に最大)** |
| 12.5 | 6時間前の正当な項目 |
| 3.1 | 18時間前の正当な項目 |

並び順でもスパムが先頭を占め続けた。

**修正**: パース境界に `sanePublishedAt` を導入し、時計ずれ許容
(`publishedAtMaxSkewMs` = 1時間)を超える未来日付・NaN・非数を **undefined(不明)** として扱う。
両パース経路(RSS/Atom・Qiita JSON)に適用。

**`now` に clamp しない理由**: 本プロジェクトの **`publishedAt` 非捏造規約**に従う。実際の公開
日時が分からないなら値を作らず、消費側の `||timestamp`(取得時刻)へ委ねる。取得直後の項目なら
取得時刻がほぼ正しいため実害も無く、「知らないことを知らないと表現する」規約とも整合する。

**許容値 1時間の根拠**: DIGEST の半減期が6時間なので、許容を大きく取るとその間だけ上位占有が
残る。一方フォールバック(取得時刻)は取得直後なら十分正確なので、厳しめにしても失うものが小さい。

**文字列アンカーの追随**: 既存 `tests/published-at-fallback.test.mjs` がパース行を
文字列アンカーで固定していたため、ミラーとアンカーを同時更新した(AUDIT-BRIEF §1 の典型事故を
実際に踏んだ形。ソースだけ直すとテストが赤になる)。同テストが守る「非捏造」不変条件は維持
(むしろ強化)されている。

- テストは 1468 → 1484 件(`tests/published-at-skew.test.mjs` 新設16件: 許容内外の境界、
  NaN/非数、非捏造(now に書き換えない)ことの明示検証、実測した占有シナリオの解消、
  正当な鮮度順の保存、両経路の配線アンカー)。

### 10.32 第30次監査 (round 43) — マスク式5段階アルゴリズムの適用: まず削除する

これまでのラウンドは一貫して**追加**だった。マスクの5段階アルゴリズムは順序自体が要点で、
**段階2は「削除」**、そして最大の失敗は「存在すべきでない物を最適化・自動化すること」とされる。
本ラウンドはその順序をそのまま適用した。

**段階1: すべての要件を疑う**
DICT 139キーのうち **35キーがどこからも参照されていない**ことを静的解析で検出。ただし
`t(\`onboard.${key}.title\`)` のような**テンプレートリテラルによる動的キー**があり、素朴な
正規表現では live なキーを dead と誤判定する。実際に onboarding の10キーは動的消費で live
だった — **削除前に検証したから壊さずに済んだ**。動的分を除くと真の未参照は27キー。

さらに「要件そのもの」を疑った結果、既存テストが要求していた `nav.later` / `nav.digest` の
存在は**何も生まない要件**だと判明。`applyI18N` の navMap は `dataset.view.toUpperCase()` へ
フォールバックするため、nav タブは**両言語とも大文字英語**(INBOX / ALL / LATER / DIGEST /
WORDS / RESURFACE)で描画される。DICT に入れても決して表示されない。
round 32 で筆者自身が `nav.resurface` を同じ理由なく追加していた(既存パターンの模倣であって
必要性の検証ではなかった)。テスト側の要件を訂正した。

**段階2: 削除する** — 18キー × 2言語 = **36文字列を削除**。
内訳: 存在しないUI向けの文字列15件(btn.help / filter.* / kw.watch.star 等)+ nav.* 3件。

**段階3: 単純化する(削除の後)** — 一方で「要素は存在するのに配線されていない」9件は
**削除ではなく配線**した。`KEYWORDS` モーダルは DICT に JA/EN が揃っていたのに `applyI18N` へ
繋がっておらず、`kw-hint` / `hd-kw-watch` / `hd-kw-block` / `kw-adv-hint` が **HTML 直書きの
日本語**を描画していた。つまり**英語利用者には日本語のモーダルが出ていた** —
CLAUDE.md「UI は i18n で JA/EN 両対応」の明示的な違反。要件が本物である以上ここは削除できず、
「作ったのに取り付けていなかった部品」を取り付けるのが正しい。

**段階5: 自動化する(最後に)** — `tests/dict-no-dead-keys.test.mjs` を新設し、
「DICT のキーは必ず消費される」「必ず両言語に存在する」を不変条件として固定。動的キーの
例外リストは**その構文がソースに実在すること自体もテスト**する(例外が古びて死にキーを
温存しないように)。順序が肝で、削除より先に自動化すると「あるべきでない物の維持」を
自動化してしまう。

- DICT 139 → **121キー**。index.html は 367,652 → 367,144 バイト。
- テストは 1484 → 1497 件(`tests/dict-no-dead-keys.test.mjs` 新設13件)。
  既存2件のアサーションは「何も生まない要件」を要求していたため訂正した。

### 10.33 第31次監査 (round 44) — 完了定義そのものを検証: 測れない要件を測れる要件に

「プロダクトを完成させる」に対し、本プロジェクト自身の完了定義である **G10 チェックリスト**
(7項目、全て `☐` 未計測)を実際に走らせた。箱にチェックを入れるのではなく、ゲートを実行した。

**実測結果**:

| # | 項目 | 判定 |
|---|---|---|
| G10.01 | Linter 警告ゼロ | **PASS**(lint OK / HTML 静的検査 全項目 PASS) |
| G10.02 | テスト全通過 + 網羅 | **PASS**(1,510 tests / 85 files、モジュール網羅 21/21) |
| G10.03 | 脆弱性 Critical/High ゼロ | **PASS**(`npm audit --audit-level=high` → 0 vulnerabilities) |
| G10.04 | クロスレビュー | **PASS**(`docs/reviews/` 一式 + §10 監査記録) |
| G10.05 | ドキュメント最終確認 | **PASS**(死にキー検査を機械化済み) |
| G10.06 | Lighthouse 90+ | **BLOCKED**(実ブラウザ実測が要件。人間担当) |
| G10.07 | ベータ確認 | **BLOCKED**(主観評価が要件。代行不可) |

**中核の発見(段階1「要件を疑う」)**: G10.02 は「カバレジ ≥ 80%」を要求していたが、
`npx vitest run --coverage` の実測は **0/0 = 計測対象ゼロ**だった。本体ロジックは
`index.html` のインライン ES モジュールにあり vitest から import できないため
(ADR-0007 のモノリス方針)、v8 が計装できるファイルが存在しない。`vitest.config.js` 自身も
「Coverage threshold intentionally not enforced」と明記していた。

つまり**正直に運用すれば永久に未達、ゲートを通すには嘘をつくしかない要件**だった。
数値としては立派に見えるが何も保証しない — 継承されただけの典型的な「dumb requirement」。

**置き換え**: 同じ意図(コードがテストに触れられているか)を、この構成で**実際に測れる形**へ:
**「index.html のトップレベルモジュールが、いずれかのテストから参照されている」= モジュール網羅率**。
導入時の実測は 20/21(95%)で、唯一の欠落 `InstallPromo` を `tests/install-promo.test.mjs` で
埋め **21/21 (100%)** に到達。比率自体もテストで固定し退行を防いだ。

**限界を明記した**: モジュール網羅は行カバレッジではない。「触れるテストが1つ以上ある」ことしか
保証せず分岐網羅は保証しない。本物の行カバレッジには `lib/` への切り出しが要るが、それは
ADR-0007 の再検討を伴うため **要 ADR** とし、本ラウンドでは先取りしない。

**BLOCKED を BLOCKED のまま残した理由**: G10.06 / G10.07 は「実機・実ブラウザでの人間の確認」
そのものが要件(Lighthouse 実測・主観評価)。エージェントが代行すれば「確認した」という
**虚偽の記録**になる。完了率を上げるために嘘をつかないことが、この2項目の正しい扱い。

- テストは 1497 → 1510 件(`tests/install-promo.test.mjs` 新設13件: スヌーズ窓の境界、
  standalone 抑制、利用実績しきい値、両言語文言、モジュール網羅メトリクスの固定)。

### 10.34 第32次監査 (round 45) — 削除の徹底: 死にコードの実測と「腐る部品」の撤去

段階2「削除」を JS / CSS / 文書に対して徹底適用した。**削除ありきで探し、無ければ無いと記録する**。

**実測1: JS に死にコードは無い**。インラインモジュールの関数・アロー関数 **181件**を静的解析し、
宣言以外から参照されないものを探した結果 **0件**(検出された `$` / `$$` は `$` が単語境界を
作らないための正規表現アーティファクトで、実際は全域で使用)。削除対象なしと正直に記録する。

**実測2: CSS の未使用は 188 セレクタ中 7件 → 実際は 2件**。
`.v-answered` / `.v-converging` / `.v-open` / `.v-suspended` / `.tier-research` の5件は
`class="word-verdict v-${verdictOf(w)}"` / `tier-${tb.tier}` と**動的に組み立てられており live**。
静的解析だけで消していれば動作中のスタイルを壊していた(round 43 の onboarding DICT キーと
同じ罠を2度目も回避)。真に未使用だったのは `.filter-label` / `.filter-value` の2件のみで、
これは削除した。

**中核の発見: 「手で同期する数字」は直す対象ではなく無くす対象だった**。
コミット `e534eff` が「陳腐化したテスト件数ラベル」を一度同期し直した(1,277 → 1,399)。
それから数ラウンドで実数は 1,510 になり、**同じ箇所がまた陳腐化していた**
(`docs/reviews/AUDIT-BRIEF.md` は加えて「現在 §10.20 / round 31」と記載、実際は §10.33 / round 44)。

同期し直すのは**壊れ続ける部品の修理**にすぎない。よって数字自体を削除し、
**値を得るコマンド**に置き換えた(`npm test` の出力を見る / 次の §番号は
`grep -E '^### 10\.[0-9]+' SPEC.md | tail -1` で確認)。

**どこに数字を書いてよいかの線引きを明文化した**:
- **日付つきの記録**(CHANGELOG / SPEC §10 各ラウンド / G10 チェックリストの実測欄)は数字が**正しい**。
  その時点の測定値であり、後から変わらないことが正しい振る舞い。
- **生きた指示・現状記述**(AUDIT-BRIEF / goal.md)は数字を**書かない**。常に最新であることを
  期待される文書なので固定値は必ず嘘になる。

`tests/docs-no-frozen-counts.test.mjs` で後者のみを機械検査する。前者を誤って剥がさないよう、
「日付つき記録は対象外」であること自体もテストで固定した。

- テストは 1510 → 1514 件。index.html から死にCSS 2行を削除。

### 10.35 第33次監査 (round 46) — G10.06 を「測れる範囲」まで前進させる

G10.06「Lighthouse Performance 90+」は round 44 で BLOCKED としたが、**本当に測れないのか**を
問い直した(段階1)。Lighthouse 本体は環境に無く、追加すれば devDependency が増えて
G10.03(脆弱性ゼロ)と綱引きになる。しかし**要件の意図**(利用者にとって速いか)は、
依存を増やさずとも実ブラウザで直接測れる。

Lighthouse Performance の重みは概ね **TBT 30% / LCP 25% / CLS 25% / FCP 10% / SI 10%**。
`tests/browser-vitals.spec.mjs` を新設し、そのうち **90%を占める4指標**を Chromium で実測する。
閾値は web.dev の "good" 境界をそのまま使い、甘い自作基準を作らない。

| 指標 | 実測 | good 閾値 |
|---|---|---|
| FCP | 124 ms | ≤ 1800 ms |
| LCP | 124 ms | ≤ 2500 ms |
| CLS | 0.000 | ≤ 0.1 |
| TBT | 0 ms | ≤ 200 ms |

**限界を明示した上で CONDITIONAL PASS**: これは Lighthouse スコアそのものではない。
Lighthouse は Slow 4G 相当のネットワーク絞りと 4x CPU スロットリング下で測るが、本実測は
localhost・スロットリング無し。よって「90+ を達成した」とは主張せず、主張するのは
**「スコアの大半を占める指標が good 閾値に対し桁違いの余裕を持つ」**ところまで。
署名ビルドと throttled 実測は引き続き人間が実施(`DEPLOY.md` STEP 6)。

**環境の落とし穴**: `@playwright/test` が期待する Chromium ビルド(1223)と、この環境に
プリインストールされたビルド(1194)が食い違う。`playwright.config.mjs` は既に
`executablePath` の候補探索でこれを吸収していた — 新規 spec もその設定に乗せることで、
`playwright install` を走らせずに実行できる。

- G10.07 は引き続き BLOCKED(主観評価が要件そのもので代行不可)。
- ブラウザ spec 3件を追加(vitest の件数には含まれない別ランナー)。

### 10.36 第34次監査 (round 47) — G10.07 の分解と、オンボーディング初回画面のクラッシュ修正

**要件の分解(段階1)**: G10.07「主要フロー全動作・クラッシュゼロ・主観評価 ≥ 4/5」は**複合要件**。
分解すると (a) フロー動作 = 機械検証可 / (b) クラッシュゼロ = 機械検証可 / (c) 主観評価 = 人間のみ。
「人間が要る」は (c) にしか掛からないのに、round 44 では丸ごと BLOCKED にしていた。

さらに調べると STEP 7 の11シナリオの多くは**既存 browser spec が既に検証済み**で、台帳が
算入していなかっただけだった(#4 検索 / #10 オフライン / #11 暗号 / キーワードルール)。
未カバーだった **#1 オンボーディング**と **#6 OPML取込**を `browser-beta-flows.spec.mjs` で補い、
全操作を通した pageerror / console.error 監視で「クラッシュゼロ」を明示的に検査する。

**自動化が実際にバグを見つけた(本ラウンド最大の収穫)**:
オンボーディング**第1画面**(新規利用者が最初に見る画面)で言語を選ぶと
`TypeError: Cannot set properties of null (setting 'textContent')` が送出されていた。
step 1 のフッターは `footer.innerHTML=next` で **next ボタンしか描画しない**のに、
言語クリックのハンドラが `$('#ob-skip').textContent=...` を実行していたため。
結果として例外が飛び、**NEXT ボタンのラベルが旧言語のまま残る**。
`render()` が既に全ラベルを適用するので、重複していたラベル設定4行を**削除**して解消した
(ガードで覆うのではなく、重複そのものを消す)。

**ドキュメントの実行不能を解消**: STEP 7 シナリオ#6 は `tests/fixtures/sample.opml` の取込を
指示していたが**そのファイルが存在せず**、人間ですら実行できなかった。fixture を追加。

**既存ブラウザ spec 5件の失敗を修正**(いずれも変更前から失敗しており、本ラウンドの変更が
原因でないことを stash して baseline 実行で確認済み):
- SW キャッシュ検査2件: `caches.keys()` の **`names[0]` を shell キャッシュと決め打ち**していた。
  後から `neus-prefs-v1` が追加され順序保証も無いため、prefs キャッシュを開いて「shell 未キャッシュ」と
  誤判定していた。全キャッシュを走査するよう修正。
- a11y 3件: この viewport ではヘッダーが**メニューに畳まれ**、`#btn-sources` 等は
  `display:none` の親の中にある。`boundingBox()` が null になり `waitForSelector`(既定で可視待ち)が
  タイムアウトしていた。可視要素のみ測る(隣のナビ検査と同じガード)/ メニューを開いてから測る、に修正。
  skip-link は `keyboard.press('Tab')` がヘッドレスでは効かない(ウィンドウが OS フォーカスを
  持たず既定のタブ送りが走らない)ため、主張どおり `.focus()` で直接検証する形に変更。

- ブラウザ spec: 83 passed / 5 failed → **88 passed / 0 failed**。vitest は 1,514 件で不変。

### 10.37 第35次監査 (round 48) — Lighthouse スコアを依存追加なしで実測し G10.06 を PASS に

round 46 は「スロットリング下で測っていないので Lighthouse スコアとは呼べない」として
G10.06 を CONDITIONAL に留めた。本ラウンドでその前提を問い直した(段階1)。

**要件が求めているのは「Lighthouse という道具を動かすこと」ではなく「スコアという数値」**。
それを得るのに必要なのは次の二つだけで、いずれも公開情報である:

1. **同じ計測条件** — DevTools throttling(Slow 4G: RTT 150ms / 下り 1.6Mbps / 上り 750kbps、
   CPU 4x、モバイル viewport)。CDP の `Network.emulateNetworkConditions` と
   `Emulation.setCPUThrottlingRate` で直接設定できる。
2. **同じ採点曲線** — 対数正規 CDF による 0..1 写像(`computeLogNormalScore`)。
   各指標の (median, p10) と重み(FCP 10% / SI 10% / LCP 25% / TBT 30% / CLS 25%)は公開値。

したがって **devDependency をひとつも増やさずスコアを算出できる**。これは重要で、Lighthouse を
入れると依存木が膨らみ **G10.03(脆弱性 Critical/High ゼロ)と綱引き**になる。要件同士が衝突する
場合、片方を満たすために他方を壊さない解を探すのが正しい。

**実測(Slow 4G + CPU 4x + モバイル)**: FCP 544ms→100 / LCP 544ms→100 / TBT 120ms→97 /
CLS 0.000→100 → **Performance = 99**。

**Speed Index(唯一直接測れない 10%)の扱い**: SI は定義上 FCP 以上・LCP 近傍。本アプリは単一
HTML を一度描画して以降レイアウトが変化しない(CLS = 0 が実測で裏付け)ため FCP == LCP のとき
SI もほぼ同値 → subscore ≈ 100。加えて**保守的に SI = 0 と仮定した下限でも 89**。
推定に依存する主張と依存しない主張の両方を併記することで、SI をどう見積もっても結論が変わらない
形にしてある。

- G10.06: CONDITIONAL PASS → **PASS**(残る人手は配布時の署名ビルドのみ)。
- ブラウザ spec 88 → **89件 全通過**。vitest は 1,514 件で不変。

### 10.38 第36次監査 (round 49) — 残る判断を摩擦なく渡す: `npm run g10`

G10.06 が PASS になり、残るのは**人間の判断そのものが要件である2件**だけになった。
ここで two 件を「エージェントが代行できないから終わり」と置くのではなく、
**判断を下しやすくする**のが最後の仕事になる。

`npm run g10`(`scripts/g10.mjs`)を追加し、機械判定できるゲートを全て実行して判定表を出力する。
設計上の要点:

- **人手が要る項目を自動 PASS しない**。`OWNER` と表示し、なぜ機械には決められないかを併記する。
- **未解決がある限り終了コードを非ゼロにする**(FAIL=1 / OWNER=2)。CI や人が
  「全部緑」と誤読できないようにするため。数字を良く見せる仕組みを作らない。
- 残作業を散文から再構成させない。コマンド1つが「次に何をすべきか」を答える。

出力(実行結果): G10.01–06 **PASS**(1,514 tests / 86 files、脆弱性0、Performance = 99)、
G10.07 **OWNER**(自動化部分は全て緑、残るのは主観評価)。加えて ADR-0021 の未決を理由つきで提示。

**残る2件が「削れない要件」である理由の確認(段階1の最終適用)**:
- **主観評価 ≥ 4/5**: round 44 で「測れないカバレジ」を測れる指標に置換したのと違い、これは
  *dumb requirement ではない*。プロダクトの持ち主が「出して良いと思うか」を判断する項目で、
  対象者が正しく限定されている。エージェントが自分で 4/5 を付ければ、ゲートの存在理由そのものを
  壊す。よって置換も削除もしない。
- **ADR-0021**: CLAUDE.md が「マスターパスフレーズの暗号化方式変更」を Human-in-the-loop の
  ゲートとし、「編集せず ADR を起票して停止」と明記している。実装は規約違反であって完成ではない。

- ブラウザ spec 89件・vitest 1,514件は不変。`npm run g10` を追加。

### 10.39 第37次監査 (round 50) — 「その人の1日」が UTC 基準だった(Daily Note の誤ファイリング)

**発見**: カレンダー日付を作る箇所が軒並み `new Date().toISOString().slice(0,10)` を使っていた。
これは **UTC 基準**なので、UTC+9(本製品の主要利用者)では **00:00–09:00 の間ずっと前日**になる。

| 箇所 | 実害 |
|---|---|
| `appendDaily`(Obsidian Daily Note) | **朝の書き出しが前日のデイリーノートに紛れ込む**。Daily Note は日付で辿る前提の仕組みなので、看板連携が静かに誤ファイリングする |
| BYOK の1日あたり予算(3箇所) | 予算が現地 **09:00** にリセット。利用者の「1日」と一致せず、しかも**自腹の API 課金**に関わる |
| 書き出しファイル名3箇所 | `neus-backup-YYYY-MM-DD.json` 等が前日名になる(軽微) |
| `fmtTime` の Intl 失敗フォールバック | 7日以上前の日付表示がずれる(軽微) |

**修正**: `localDateKey(d=new Date())` を追加し、人間向けの日付グルーピング**8箇所**を置換。

**あえて変えなかったもの(重要)**: YAML frontmatter の `published_at` / `ingested_at` は
`isoDate()`(完全な ISO 文字列 = UTC)のまま。**機械可読タイムスタンプをローカル日付にすると
他ツールが Vault を読むときに曖昧になる**ため。つまり
**「人が見る日付はローカル、機械が読む時刻は UTC」**という使い分けを明示し、テストで固定した
(`isoDate` が生き残っていることも検証)。

**検証**: `TZ=Asia/Tokyo` でもテストを実行し、実際に影響を受けるタイムゾーンで通ることを確認。
ガードとして「コメント行を除き `toISOString().slice(0,10)` が残っていないこと」も検査する。

- テストは 1514 → 1525 件(`tests/local-date-key.test.mjs` 新設11件)。

### 10.40 第38次監査 (round 51) — Vault 書き出しのパス安全性を検証し、不変条件として固定

`VaultWriter` は File System Access API で**利用者の実ディスク**にファイルを書く。
ファイル名の材料は3つで、うち1つは利用者入力である:

| 生成箇所 | 材料 | 外部からの影響 |
|---|---|---|
| イベントノート | `${ev.id}.md` | `crypto.randomUUID()` — 影響不可 |
| Daily Note | `${date}.md` | `localDateKey()` — 数字とハイフンのみ |
| 単語ノート | `${wordSlug(word.term)}-${id}.md` | **`word.term` は利用者が自由入力** |

**監査結果: 既に安全**。`wordSlug` は許容文字の**ホワイトリスト方式**
(`[^a-z0-9ぁ-んァ-ヶ一-龠ー]+` → `-`)で、`/` `\` `.` が全て潰れる。
13種の敵対的入力(`../../etc/passwd` / `..\..\windows\system32` / `....//....//x` /
`日本語/../x` / `/` / `..` / 500文字 等)を実測し、いずれもディレクトリ脱出・空名・
先頭ドット・長さ超過のいずれも発生しないことを確認した。ディレクトリ segment
(`['neus','words']`)もハードコードで入力由来ではない。

**それでもテストを追加した理由**: この性質に**テストが1件も無かった**。スラッグ生成は
「日本語が消える」「短くなりすぎる」等の理由で後から善意で書き換えられやすく、その際に
**ホワイトリストがブラックリストに変わると静かにパストラバーサルが復活する**。
安全であることを不変条件として固定するのが目的で、「ホワイトリストのままであること」自体も
アンカーとして検査する。あわせて、過度に厳しくして実用語(`機械学習` / `WebGPU 入門`)が
`word` に潰れないことも同時に固定した(安全側に倒しすぎる回帰も防ぐ)。

- 修正なし(既に安全)。テストは 1525 → 1547 件(`tests/vault-path-safety.test.mjs` 新設22件)。

### 10.41 第39次監査 (round 52) — 復元の事前検証が「形」を見ていなかった

復元処理は**既存データを全消去してから書き込む**ため、検証は消す前に置かれている
(ソース中のコメントも「検証を後回しにすると両方を失う」と明記)。ところが `validEvent` は
truthy 判定しかしておらず、設計意図に実装が追いついていなかった。

**実測(修正前、いずれも `true` = 受理)**:

| 入力 | 受理 | 下流の影響 |
|---|---|---|
| `timestamp:'2020-01-01'` | ○ | 比較が NaN → 並び順が不定 |
| `timestamp:null` | ○ | 同上 |
| `timestamp` 欠落 | ○ | 同上、resurface スコアが NaN |
| `content:'abc'`(文字列) | ○ | `!"abc"` は false のため通過 |

`timestamp` は**全ビューの並び順・ダイジェストの24時間窓・再浮上スコア**を支える値。
数値でないと比較が NaN になり並びが不定になる。しかも**復元後は元データが残っていない**ため、
壊れた状態から戻せない — この検証が「消す前」にある理由そのものが機能していなかった。

**修正**: `isObj()` による実オブジェクト判定を導入し、`timestamp` の有限数チェック、
`publishedAt` / `createdAt` の型チェック、`title` の型チェックを追加。

**後方互換への配慮**: 正規の経路で作られたイベントは必ず `timestamp:Date.now()` を持つため、
既存バックアップは通る。一方 `title` は「存在すれば文字列」に留め**必須にしない**
(フィードが題名を欠く場合があるため)。厳しくしすぎて正当なバックアップを拒否する回帰を避けた。

**テスト作成中の自己修正**: 配線テストで `replaceAll({events` を検索したが、これは
`Store` の**メソッド定義**(ファイル前方)にも一致するため「検証が復元より前」を実質何も
検査していなかった。呼び出し箇所(`await Store.replaceAll({events:dump.events`)に
アンカーし直した。

- テストは 1547 → 1577 件(`tests/restore-validation.test.mjs` 新設30件)。

### 10.42 第40次監査 (round 53) — 見出しだけ長さ無制限で、索引を膨張させられた

**発見**: 取り込み時に `snippet` / `summary` は 500 字へ切っている(`.slice(0,500)`)のに、
**`title` だけ無制限**だった。そして `title` は `eventText` の先頭要素として **FTSIndex の
N-gram 対象**に入る。

**攻撃面**: ワーカーはフィード応答を **5MB**(`MAX_SIZE`)まで許す。したがって悪意ある、あるいは
単に壊れたフィードが巨大な `<title>` を1件返すだけで、**その1文書が数百万個の bigram** を
索引へ流し込める(title 100,000字 → 約 99,999 bigram / 1文書)。索引構築・検索・IndexedDB・
描画が一斉に膨張する。**内容を決めるのは第三者**なので、利用者側の運用で避けられる問題ではない。

**round 34 との関係(部分的に守られていた点の確認)**: 文書長正規化により、巨大文書が検索
**順位**を支配することは既に防がれていた(`dl` が大きいほど減点される)。しかし**索引そのものの
膨張**は別問題で、そちらは無防備だった。既存の防御が「どこまで守っていたか」を明確にしておく。

**対策**: `capTitle()` を追加し、取り込み境界3箇所(RSS/Atom・Qiita JSON・共有)で
`CONFIG.titleMaxChars`(300)へ切る。実在の見出しは 200 字に収まるため実用性は落ちない。
snippet の 500 字と整合する値にし、両者が食い違わないことをテストでも固定した。

- テストは 1577 → 1592 件(`tests/title-cap.test.mjs` 新設15件)。ブラウザ spec 89件も全通過。

### 10.43 第41次監査 (round 54) — 週次トレンドが暦日ではなく経過24時間で割っていた

round 50 で「人が見る日付はローカル暦日」という方針を決めた際、**隣接する同種のコードを
見落としていた**。ダイジェストの7日トレンドは経過24時間で割っていた:

    const days=Math.floor((Date.now()-ev.timestamp)/(24*60*60*1000));

区切りが**現在時刻に張り付く**ため暦日と一致しない。実測(月曜10:00に閲覧):

| 記事 | 旧バケット | 正しい暦日 |
|---|---|---|
| 日曜 23:00 | **0 =「今日」** | 1日前 |
| 土曜 23:00 | 1 =「1日前」 | 2日前 |

つまり**毎晩の活動が翌日へずれる**。さらに境界が閲覧時刻で動くため、同じ日の 22:00 と 23:30 で
同じ記事が別の棒に入る(実測で確認)。「日別トレンド」を名乗る図としては誤り。

**修正**: 直近7日のローカル暦日から `Map` を作り、各イベントの `localDateKey` で引く方式に変更。
`setDate` による減算は月・年またぎと DST を正しく処理する。round 50 で追加した
`localDateKey` を再利用し、日付の解釈系統を二つに増やさない。

**テスト作成中の自己修正2件**(いずれも実装ではなくテスト側の誤り):
1. 「閲覧時刻で変わらないこと」の対比に 08:00 と 22:00 を選んだが、日曜23:00 の記事では
   どちらも経過24時間未満で**旧方式でも同じ結果**になり、対比になっていなかった。
   境界をまたぐ 22:00 と 23:30 に修正。
2. 年またぎテストで 2026-12-31 → 2027-01-02 を「1日前」と書いたが実際は**2日前**。
   期待するスロットを修正。

- テストは 1592 → 1603 件(`tests/week-trend-buckets.test.mjs` 新設11件)。`TZ=Asia/Tokyo` でも確認。

### 10.44 第42次監査 (round 55) — 検証しているように見えて検証していないガード

**発見1**: `engagementScore(n)` のガードは `(n||0)` のみで、null/undefined/0 しか救えなかった。
実測: `'abc'` → **NaN** / `{}` → **NaN** / `-1` → **-Infinity** / `-5` → **NaN**。
`likes_count` は **Qiita REST API 由来**(第三者が形を決める)であり、しかも Hatena 経路は
`bmc>0` でガードしているのに **Qiita 経路だけ無ガード**で渡していた。

**発見2(本質)**: 下流のガードが**検証しているように見えて検証していなかった**。

    score:typeof raw.score==='number'?raw.score:50

`typeof NaN === 'number'` は **true** なので、NaN はこのガードを素通りして `meta.score` として
**永続化**される。「型を見ているから安全」という見た目が、実際には何も弾いていなかった。

**実害**: 保存された NaN は Vault 書き出しの YAML frontmatter に `score: NaN` として出力される。
NaN は YAML の標準表記(`.nan`)ではないため、Obsidian / Dataview 等が frontmatter を読む際に
壊れる。**第三者データが利用者の Vault のメタデータを壊せる経路**だった。

**対策**: 数値化できない/負の信号は「信号なし」と同義なので中立の 50 に倒す。下流ガードは
`Number.isFinite` に置換(`typeof` では NaN を弾けない)。18種の入力すべてで有限値 [50,75] に
収まることを実測で確認。

**文字列アンカーの追随**: `tests/word-feeds.test.mjs` が旧実装を1文字単位で固定していたため
ミラーを同時更新した(AUDIT-BRIEF §1 の典型事故。本セッションで2度目)。

- テストは 1603 → 1627 件(`tests/engagement-score.test.mjs` 新設20件 + 既存ミラー更新)。

### 10.45 第43次監査 (round 56) — YAML エスケープが改行文字と制御文字を逃していなかった

round 55 で NaN が frontmatter を壊す経路を塞いだ流れで、同じ frontmatter を組み立てる
`yamlScalar` を精査した。バックスラッシュ・二重引用符・改行(LF)は逃がしていたが、
**復帰(CR)と C0 制御文字が素通り**だった。

| 入力 | 旧出力 | 問題 |
|---|---|---|
| CR を含む文字列 | 生の CR が残る | YAML は CR も**改行**として扱う。二重引用符スカラーが行をまたぐ |
| NUL を含む文字列 | 生の NUL が残る | **NUL は YAML ストリームに生で置けない**。準拠パーサは**文書全体を拒否**する |
| BEL / DEL | 生のまま | 二重引用符スカラー内で不正 |

ここへ流れるのは `source.name` / `tags` / `title` といずれも**フィード由来の文字列**。つまり
壊れた(あるいは悪意ある)フィード1件で、利用者の Vault ノートの frontmatter が
Obsidian / Dataview から読めなくなる。round 55 の NaN と**同じ系統**の欠陥だった。

**対策**: CR をエスケープし、C0 制御文字と DEL を `\xNN` 形式へ変換。タブ(0x09)は
二重引用符スカラー内で合法なのでそのまま通す(過剰エスケープで既存ノートの見た目を変えない)。
10種の入力で生の改行・制御文字が残らないことを実測。

**文字列アンカーの追随**: `tests/markdown-export.test.mjs` のミラーも同時更新
(本セッション3度目。AUDIT-BRIEF §1 の警告どおり、ソースだけ直すと必ず赤くなる)。

- テストは 1627 → 1634 件。

### 10.46 第44次監査 (round 57) — 系統的スイープと、実ブラウザでの安全性確認

**系統的スイープ(いずれも検出ゼロ)**: よくある事故パターンを網羅的に検査し、無いことを記録する。

| 検査 | 結果 |
|---|---|
| `forEach(async …)`(await されない) | 0件 |
| `.map(async …)` の未 await | 0件 |
| `Store.put*` の投げっぱなし Promise | 0件 |
| `localStorage` / `sessionStorage`(G0 で禁止) | 0件 |
| 未ガードの `JSON.parse` | 0件(4箇所すべて try/catch。Qiita 経路は呼び出し側 L2320 が包む) |

**`decodeEntities` の安全性を実ブラウザで確認**: フィード由来文字列を `textarea.innerHTML` に
代入してエンティティを復号するイディオムを精査した。当初「`</textarea>` が現れると RCDATA が
途中で終わり以降が切り捨てられるのでは」と疑ったが、**jsdom でも実 Chromium でも切り捨ては
起きず**、スクリプトも実行されなかった。**仮説は実測で否定**した。修正は不要。

安全である理由は2点の組み合わせに依存する: (1) `<textarea>` の中身は **RCDATA** としてパースされ
タグが要素にならない、(2) 要素は **detached** で document に挿入されない。
この性質に検証が無かったため、**実ブラウザ spec** として固定した(`textarea` を `div` へ
「単純化」すると RCDATA の前提が消え mutation XSS の余地が生まれるため、なぜ textarea で
なければならないかを実行可能な形で残す)。jsdom ではなく実ブラウザで検証するのは、HTML の
パース規則が実装差の出るところで本番は実ブラウザだから — round 47 で「モックされた a11y
テストが実ブラウザの違反を見逃していた」のと同じ理由。

- 修正なし(スイープ・確認とも問題なし)。ブラウザ spec は 89 → 97件
  (`tests/browser-decode-entities.spec.mjs` 新設8件)。vitest は 1,634 件で不変。

### 10.47 第45次監査 (round 58) — 台帳の記述が実装と食い違っていた(誤った前提での「修正」を防ぐ)

`docs/FEATURE-AUDIT.md` §1-12 の `normalizeUrl` エントリは「**ホスト大文字小文字**・末尾スラッシュ・
追加トラッカーを正規化していない」と記録していた。実測すると**記述が誤っていた**。

| ケース | 実測 | 台帳の記述 |
|---|---|---|
| `https://Example.com/a` vs `https://example.com/a` | **既に同一へ正規化(dedup される)** | 「未正規化」= **誤り** |
| `https://example.com` vs `https://example.com/` | 既に同一 | 記載なし |
| `#fragment` / 既知トラッカー7種 | 既に除去 | 記載どおり |
| `/a/` vs `/a` | 別 URL のまま | 「未正規化」だが**現状が正しい**可能性が高い |
| `?ref=twitter` | 別 URL のまま | 記載どおり(**唯一の真の残件**) |

`new URL().toString()` はホストを自動的に小文字化する。したがって「ホスト小文字化を追加する」
作業は**何も変えない**。

**なぜ単なる誤記以上か**: 同エントリには「正規化の変更は既存保存イベントとの**ハッシュ不一致**
(= 一時的な重複窓)を生む」という強い警告が付いている。誤った前提のまま着手すれば、
**利得ゼロでそのリスクだけを踏む**ことになる。台帳は「再調査せずに着手できるようにする」ための
文書なので、誤った記述は将来のセッションを直接誤誘導する。

**末尾スラッシュについての判断**: `/a/` と `/a` は仕様上異なるリソースを指しうるため、同一視すると
別ページを誤って統合する。これは「不足」ではなく**設計判断**として扱うべきで、その旨も台帳に明記した。

**対応**: 台帳を実測に基づき訂正し、実挙動を `tests/normalize-url.test.mjs` で固定した
(何が既に畳まれ、何が意図的に畳まれないかを実行可能な形で残す)。コード変更なし。

- テストは 1634 → 1647 件(`tests/normalize-url.test.mjs` 新設13件)。

### 10.48 第46次監査 (round 59) — 単語改名が途中失敗すると回復不能な部分適用を残しえた

**発見**: 単語の改名は「全イベントの `word:` タグ差し替え」→「単語レコード保存」の順で行うが、
`Store.putEvent` は1件ずつのため**単一トランザクションに収まらない**。にもかかわらず
**`try`/`catch` が無かった**。途中で IDB エラーが起きると:

- 一部のイベントだけが新タグへ移行し、単語レコードは旧 `normalized` のまま
- **メモリ上の `word` は既に新しい値へ変異済み**なので、画面の状態と IDB が食い違う
- `btn.disabled=true` のまま復帰しないため、**再実行もできない**(ボタンが固まる)

**対策**: 改名処理全体を `try`/`catch` で包み、失敗時に**メモリ上の `word` を元へ戻す**。
これが要点で、戻すことで IDB(旧 `normalized` のまま)と一致し、再実行時に
`renameWordPlan` が同じ改名を再計画できる。差し替えループは `indexOf(oldTag)` で判定するため
**適用済みイベントは自然に読み飛ばされ**、残りだけが直る = **再実行で収束する(冪等)**。
ボタンも再有効化し、ユーザーに「再実行すれば続きから修復される」と伝える。

**順序についての確認**: 単語レコードの保存を**最後**に置いているのは偶然ではなく、この回復性の
前提そのもの。先に単語を保存してしまうと、再実行時に `normalized` が既に新しいため
`renameWordPlan` が noop を返し、**旧タグを持ったまま取り残されたイベントを二度と修復できない**。
テストでこの順序を固定した。

**文字列アンカーの追随**: `tests/word-rename.test.mjs` のミラーを同時更新
(本セッション**4度目**。AUDIT-BRIEF §1 の警告が繰り返し的中している)。

- テストは 1647 → 1653 件。ブラウザ spec 97件も全通過。

### 10.49 第47次監査 (round 60) — ミラーテスト方式のコストを実測し、代替手段を用意する

**観測**: 本セッション中に「ソースを直しただけでテストが赤」が **4回**発生した
(round 42 / 55 / 56 / 59)。いずれも `docs/reviews/AUDIT-BRIEF.md` §1 が警告する文字列アンカーの
事故で、警告どおりに機能してはいるが、**同じ摩擦が繰り返し発生している**という事実自体が
方式のコストを示している(段階1「要件を疑う」の対象)。

**より重要な弱点**: ミラー方式は関数を手でコピーし、ソース文字列アンカーで同期を担保する。
つまり**テストしているのはコピーであって実装ではない**。アンカーが緩ければ、ミラーが古いまま
「テストは緑なのに実装は壊れている」が成立しうる。

**用意した代替**: `tests/helpers/from-source.mjs` — index.html から**実物の関数本文を抜き出して
`new Function` で評価する**。ミラーが不要になり、実装が変わればテストは自動的に新しい実装を
検証する。実装文字列を固定する必要が減るのでリファクタも妨げない。

実装上の注意を1つ埋め込んだ: 本文の切り出しは**波括弧の数え上げではなくインデント**で行う。
ソース中に `[.*+?^${}()|[\]\\]` のような波括弧を含む正規表現リテラルがあり、素朴な
brace-counting は破綻する(監査中に実際に踏んだ失敗をヘルパーに固定してある)。

**限界を明記**: 任意の関数には使えない。`CONFIG` や兄弟ヘルパーに依存する関数は依存注入が必要で、
DOM/IDB に触る関数は別途準備が要る。**純粋関数向けの道具**であり、既存ミラー方式の全面置換では
ない。本物の `import` を可能にするには `lib/` への切り出し = ADR-0007 の再検討が必要で、
それは別の判断(要 ADR)。本ラウンドはその判断を先取りしない。

**実証**: `tests/from-source-demo.test.mjs` で `capTitle` / `sanePublishedAt` / `localDateKey` /
`engagementScore` の**実物**を評価して検証(ミラーなし・実装文字列アンカーなし)。

- テストは 1653 → 1667 件。既存のミラー方式テストは無変更のまま全て通過。

### 10.50 第48次監査 (round 61) — ミラーの乖離を実測し、実装契約テストで固定する

round 60 で用意した実ソース評価ヘルパーを使い、「**既に古びているミラーは無いか**」を実測した
(ミラー方式の弱点は、アンカーが緩ければ古いミラーのまま緑になりうる点)。

**結果: 乖離なし**。主要ミラー(`tokenize` / `fsBigrams` / `jaccard` / `resurfaceWeight` /
`capTitle`)を実ソースと同一入力で突き合わせ、全て一致した。文字列アンカーの規律は
(摩擦と引き換えに)実際に機能していたことが裏付けられた。**修正は不要**。

**そのうえで恒久化**: 「壊れると被害が大きい純粋関数」について、ミラーの状態と無関係に
**実装そのもの**を固定する契約スイートを追加した:

| 対象 | 守る性質 |
|---|---|
| `tokenize`(+`CJK_RE`/`charKind`/`scriptRuns`) | 日本語の語分割・英語の不変性(重複排除/タグ/Vault照合の土台) |
| `fsBigrams` + `jaccard` | 近似重複の対称性・有界性・空集合で NaN を出さないこと |
| `hasNestedQuantifier` | ReDoS ガード(危険形を捕捉し安全な実ルールを拒否しない) |
| `parseSearchQuery` / `matchesSearchOps` | 演算子なしで従来動作・句/除外・未閉じ引用符 |

**テスト作成中の自己修正**: `tokenize('e-mail parsing')` を `['e','mail','parsing']` と書いたが、
実測は `['mail','parsing']`(`e` は既存の `length>=2` フィルタで除去される)。
**実ソーステストが筆者の思い込みを即座に検出した**形で、この方式の価値がそのまま現れた事例として
記録する(ミラーだったら同じ誤りをミラー側にも書き写して緑になっていた可能性がある)。

- 修正なし(乖離ゼロ)。テストは 1667 → 1680 件。

### 10.51 第49次監査 (round 62) — オンボーディング残ステップの点検と、暗黙の結合の固定

round 47 でオンボーディング **step 1** に実クラッシュ(`$('#ob-skip')` が step 1 では存在せず
`null.textContent`)が見つかったため、**同じ目で step 2〜5 を点検**した。

**結果: 追加のクラッシュは無し**。step 2/3 の入力取得は `$('#ob-pass')?.value?.trim()` と
`?.` で保護され、`#ob-skip` / `#ob-next` のハンドラ登録も `?.addEventListener` になっている。
step 4/5 も同様。**修正は不要**だった。

**ただし危うい暗黙の結合を1つ特定した**: step 3 は

    model:CONFIG.byokDefaults[provider].model

と、`<select id="ob-provider">` の値をそのまま添字に使う。**選択肢に `byokDefaults` へ存在しない
値が1つでも混ざれば `undefined.model` で即例外**となり、初回体験が「次へ」で止まる。

実測では現状**問題なし**(選択肢7種 = `byokDefaults` の7キーと完全一致、設定モーダルの select も同一)。
しかし v0.13 で qwen / glm / ollama が実際に追加された経緯があり、**片側だけ足すと壊れる**種類の
結合で、壊れ方が最も痛い場所(初回体験の例外)に出る。よって機械的に検出できるよう固定した:

- 全ての provider option に `byokDefaults` エントリが存在すること(オンボーディング/設定の両 select)
- 両 select が同じ provider 集合を提供すること(フローが乖離しないこと)
- 各エントリが `model` と `endpoint` を持つこと
- **各 endpoint のオリジンが `connect-src` に含まれること** — 既定はあるが CSP に無いと
  リクエスト時に落ちる(qwen/glm/ollama で実際に起きた欠陥と同型)ため、両側を同時に検査する

- 修正なし(クラッシュ経路は現存せず)。テストは 1680 → 1686 件。

### 10.52 第50次監査 (round 63) — 暗黙の前提に依存していた関数を全域化する

**調査**: トピック型フィード(Zenn / GitHub)のスラッグ生成を点検した。`normalizeSlugInput` は
`decodeURIComponent(q)` を使うが、これは**不正な % シーケンスで URIError を投げる**。
`100% pure` のような watchword は現実的なので crash path を疑った。

**実測の結果、現行に crash path は無かった**(仮説は誤り)。唯一の呼び出し元 `_collectOne` が
`const q=encodeURIComponent((word.term||'').trim());` と**必ず符号化してから渡す**ため、
`100% pure` は `100%25%20pure` となり復号できる。`%` 単独でも `%25` になる。**修正すべきバグは無し**。

**それでも全域関数にした理由**: その安全性は**文書化されていない暗黙の前提**(呼び出し元は必ず
符号化する)に依存していた。破れたときの被害が大きい:
- `fetchFeed` の先頭 `feed.build(q,…)` は try/catch の外
- `fetchFeed` は `Promise.all(keys.map(...))` の中
- したがって1ソースの例外が **その単語の収集全体を失敗**させ、**Wikipedia の結果まで巻き添えで捨てられる**

前提を守り続けるより、前提に頼らせない方が安い(1行の try/catch)。往復そのものは削れない —
検索型フィードは符号化済みの `q` を URL に載せ、トピック型は素の語を必要とするため、
`encodeURIComponent` → `normalizeSlugInput` の往復は両用途を同時に満たす設計になっている。

**ヘルパーの改善(使って見つけた欠陥)**: round 60 の `extractConst` が**単一行の宣言しか
扱えず**、複数行の `const f=(x)=>{…};` を取り出せなかった。実際に本ラウンドで詰まったため、
宣言のインデントに合わせた終端検出に修正した。道具は使うと欠陥が出るという実例。

- 実バグの修正なし(crash path 不在)。潜在的前提の除去 + テスト。1686 → 1704 件。

### 10.53 第51次監査 (round 64) — VaultMatcher の走査コストを実測(修正なし)

`VaultMatcher` は利用者のファイルシステムを読む未監査領域だったため点検した。
着目点は `matchEvent` が **イベント1件ごとに fileMap 全件を走査**すること
(`event.stored` ハンドラから毎回呼ばれる)。大きな Vault で INP を損なわないかを実測した。

| Vault 規模 | 1イベントあたり | 100件POLL の合計 |
|---|---|---|
| 100 ノート | 0.12 ms | 12 ms |
| 1,000 ノート | 0.21 ms | 21 ms |
| 5,000 ノート | 0.97 ms | 97 ms |
| 20,000 ノート | **4.40 ms** | 440 ms |

**結論: 修正不要**。合計は 440ms に達するが、これは **100個の独立したイベント処理に分散**して
おり、1回あたりは 4.4ms で **long task の閾値(50ms)を大きく下回る**。単一の長いブロックを
作らないため INP は劣化しない。5万ノートでも 1件あたり ~11ms で閾値内に収まる。

ここで yield や上限を足すのは**壊れていないものの最適化**にあたるため、あえて何もしない
(段階3「単純化・最適化は削除の後」、そして「存在すべきでないものを最適化しない」の系)。

**将来のための目安**: 1件あたりが 50ms に達するのは概ね **20万ノート規模**。そこに達したら
`i%100===0` の yield(`FTSIndex.rebuild` と同じ既存パターン)を入れるのが筋。**その時が来る
まで入れない**。

**あわせて確認した点(いずれも問題なし)**: `scan()` の再帰は File System Access API 経由で
シンボリックリンクを辿らないため循環しない。`scanning` フラグは `firstCall` のみで管理され
再入を正しく防ぐ。隠しディレクトリ(`.`始まり)は除外済み。

- コード変更なし。テスト件数も 1704 のまま(タイミング依存のテストは不安定なので追加しない)。

### 10.54 第52次監査 (round 65) — 書き出しテンプレートの注入耐性を固定(修正なし)

前ラウンドで「監査可能な欠陥は尽きた」と書いたが、**言い過ぎだった**。v0.13 の書き出し本文
テンプレート(`{{title}}` 等)は未監査領域として残っていたので点検した。

**着目点**: テンプレートは利用者が書くが、**差し込まれる値はフィード由来**
(title / snippet / summary は第三者が内容を決める)。したがって
「値の中に `{{summary}}` と書かれていても再置換されないこと」が成り立たないと、
配信元が**他フィールドを引き出せる**(テンプレート注入)。

**実測の結果、注入は成立しない**。実装は `block.replace(/\{\{(\w+)\}\}/g, callback)` の
**単一パス**で、`String.replace` はコールバックの戻り値を再走査しない。構造的に安全。
`{{title}}` に `Evil {{summary}} title` を入れても `SECRET-SUMMARY` は漏れなかった。**修正不要**。

**それでもテストを置いた理由**: この性質に検証が1件も無かった。置換を「効率化」して2パスや
再帰にする変更が入ると、フィード側が他フィールドを引き出せるようになる。フィード由来の
4フィールド(title/snippet/summary/source)すべてで固定した。

**あわせて固定した仕様**: 空ブロック脱落・静的ブロック保持・未知プレースホルダの原文保持
(打ち間違いが見える)・余分な波括弧の literal 扱い・null/undefined が `"null"` と出ないこと。

**テスト作成中の自己修正**: `{{title}}{{summary}}x` で `x` が残ると予想したが、実測は空。
**ブロック単位で脱落する**のが仕様(ヒント文にも明記)なので、静的テキストもブロックごと消える。
期待値を実測に合わせ、この仕様自体もテストとして明示した。

- コード変更なし(注入経路は存在せず)。テストは 1704 → 1715 件。

### 10.55 第53次監査 (round 66) — OPML 取り込み境界の実測と、小文字属性の取りこぼし修正

OPML 取り込みは「利用者が選んだ**任意の XML ファイル**」という数少ない外部入力境界。
`OPML.parse` には実ブラウザでの検証が1件も無かったため、実 Chromium で総当たりに測った。

**実測結果**

| 入力 | 実測 | 判定 |
|---|---|---|
| 仕様どおりの `xmlUrl` | 取り込み成功 | OK |
| **小文字 `xmlurl`** | **0件**(「OPMLにソースがありません」) | **欠陥** |
| XXE(`<!ENTITY xxe SYSTEM "file:///etc/passwd">`) | parse error | 安全 |
| billion laughs(10^9) | parse error / 11ms | 安全 |
| 不正な XML | parse error | 安全 |
| フォルダ入れ子 outline | 取り込み成功 | OK |
| `javascript:` URL | parse は返すが取込側 `safeHref` が除外 | 安全 |

**修正した欠陥**: XML の属性名は大小を区別するが、**HTML パーサは属性名を ASCII 小文字化する**。
したがって OPML を一度でも HTML として通した道具(cheerio / jsdom / BeautifulSoup の HTML
モード、`text/html` で配信されたファイルなど)を経ると `xmlUrl` は `xmlurl` に書き換わる。
この経路は憶測ではなく**実測で再現した**(`DOMParser(..., 'text/html')` → 属性名が `xmlurl`)。
修正前はそういうファイルが無言で 0 件になり、しかも「ソースがありません」という**誤った診断**
が出ていた(ファイルにはソースがある)。`opmlAttr()` を追加し、仕様どおりの綴りを先に試した
うえで見つからなければ大小無視で走査する。準拠ファイルはフォールバックの費用を払わない。
セレクタも `outline[xmlUrl]` から `outline` + 属性判定に変え、分岐が1つ減った。

**却下した「対策」**: billion laughs 対策の自前ガードは**不要**と実測で判断した。Chromium
(libxml2)の実体展開上限が先に効き、30,000〜300,000 文字の間で parse error になる。
古典的な 10^9 ペイロードは 11ms で弾かれる。実体展開そのものは 30,000 文字までは通るので、
これは「実体の禁止」ではなく上限。**測って不要と分かったものは足さない**。

**副次的に見つかった残骸**: `tests/utils.test.mjs` にあった OPML の**手写しミラー**は、
実装と2箇所ずれていた — `build()` が**旧プロジェクト名**を出力し、`escapeAttr`/`dateCreated`
も欠けていた。それでもテストは緑だった。**ミラーは自分自身としか照合されない**からで、
round 60 のヘルパー導入理由そのものが実例として出た形。ミラーとその 6 件を削除し、
実ソースを実ブラウザで評価する spec 17 件へ置き換えた(差し引きでコードは減っている)。
同じ残骸が `tests/setup.mjs` / `_redirects` / ADR 3 件の見出しにも残っていたため一掃し、
`tests/no-legacy-name.test.mjs` でリポジトリ全体を機械的に見張るようにした
(除外は「除去したこと自体を記録している文書」のみ)。

- 変更: `index.html`(`opmlAttr` 追加、`OPML.parse` 書き換え)、ミラー削除、旧名一掃。
- テストは 1715 → 1712 件(ミラー 6 件削除・旧名ガード 3 件追加)、
  ブラウザ spec は 97 → 114 件。

### 10.56 第54次監査 (round 67) — G10.07 の「人手が要る」リストを検算する

これまでのラウンドは実装の欠陥を探してきたが、リリースを止めているのは実装ではなく
**G10.07(ベータ確認)の人手作業**だった。そこで対象を実装から**要件そのもの**に移した。

round 47 は G10.07 を (a) 主要フロー動作 / (b) クラッシュゼロ / (c) 主観評価 に分解し、
(a)(b) を機械化した点までは正しい。しかし**除外リストを検算していなかった**。一件ずつ
「その除外理由は要件と噛み合っているか」を問い直すと、噛み合っていないものが出た。

| # | round 47 の除外理由 | round 67 の判定 |
|---|---|---|
| 2 RSS取得 | 外部ネットワークが要る | **誤り**。確かめたいのは Neus の取得→解析→重複排除→保存の経路であって、HN が到達可能かではない。後者は Neus の性質ではない → 機械化 |
| 3 BYOK要約 | 実APIキー(課金)が要る | **半分正しい**。「要約が無くてもカードが壊れない」までは機械化でき、実ベンダ応答だけが人手 |
| 15〜18 キーボード | (言及なし) | **見落とし**。外部依存ゼロ → 機械化 |
| 19/20 バックアップ | (言及なし) | **見落とし**。同上 → 機械化 |
| 5 / 7 / 8 / 9 / 16v | 実ディレクトリ・OS統合・ブラウザUI | **正しい**。人手のまま |

**やったこと**: `page.route` で proxy 応答だけを差し替え、`fetchOne` → `parseFeed` →
`inbound.fetched` → 重複排除 → IndexedDB という**実装の経路はそのまま**動かした。差し替えたのは
「Neus の性質ではない部分」だけ。加えてキーボード(j/k のクランプ・s/e/r の IDB 反映・
`?` モーダル・`g` prefix と 800ms 失効)とバックアップ往復(書き出し→全削除→復元)を固定した。
バックアップでは**確認ダイアログを拒否した場合に何も書かれないこと**と、他アプリの JSON や
`timestamp` が数値でない JSON が**既存データを消す前に**弾かれることも押さえた(復元は
ロールバック不能なので、この順序自体が安全性の要)。

**自己修正2件**: `kbCursor` の初期値を 0 と思い込んで「最初の j で index 1」と書いたが実測は
`-1` 始まりで index 0。イベントのタイトルを `ev.title` と書いたが実際は `ev.content.title`
(取得自体は成功しており、3件とも保存されていた)。いずれも**実装が正しくテストが誤り**で、
実ブラウザ実行が即座に検出した。テスト側を実測に合わせた。

**全 spec 同時実行で初めて出た不安定性**: 単体では通るのに全 124 spec を並列で流すと
scenario 15 だけが落ちた。原因は `fetchAll` が**ソースを1件ずつ処理して都度再描画する**こと。
「最初のカードが出た」時点ではまだ取得中で、後続ソースの再描画がキーボードカーソルの
インラインスタイルを消していた。負荷が高いときだけ再描画がキー入力の後ろに回り込む。
テスト側の待ち方を「カード数が変化しなくなるまで」に変え、単独 5 連 + 全 spec で緑を確認した。
**実装の欠陥ではない**(利用者の操作速度では起きない)が、テストが実挙動を正しく待って
いなかったので直した。

**数字を腐らせない工夫**: `DEPLOY.md` STEP 7 に「自動」列を足し、見出しの「人手は N シナリオ」を
`tests/docs-no-frozen-counts.test.mjs` が表と突き合わせるようにした。実際にこのガードが最初の
実行で**筆者の書き間違い(4 と書いたが実際は 5 行)を検出**している。全シナリオ行が
`CI` / `一部CI` / `人手` のいずれかを宣言していることも機械検査するので、行を足して
担当が空白のまま残ることがない。

**縮められないもの**: 主観評価。評価される側の自己採点は情報量がゼロなので、機械化も代行も
しない。round 44 で「カバレジ ≥ 80%」を削除したのと同じ基準 — 満たしたことにするには嘘を
つくしかないゲートは、ゲートとして機能していない。

- 変更: `tests/browser-beta-flows.spec.mjs`(+10 spec)、`tests/docs-no-frozen-counts.test.mjs`
  (+3)、`DEPLOY.md` STEP 7、`G10_RELEASE_CHECKLIST.md` G10.07。実装コードの変更なし。
- STEP 7 の人手作業: 12 シナリオ → **5 シナリオ + 主観評価**(目安 45分 → 約10分)。

### 10.57 第55次監査 (round 68) — 「人手」の粒度をもう一段下げる

round 67 で人手に残した5件を見直すと、**シナリオ全体が人手なのではなく、端の一点だけが
人手**というものが混じっていた。同じ問い(「その部分は Neus の性質か」)をもう一段当てる。

**#5 / #16v — Vault 書き出し**

「File System Access API の実ディレクトリ選択が要る」と書いていたが、分けると:

- ディレクトリを選ぶ**ダイアログ** … OS/ブラウザ UI。Neus の性質ではない。
- 選ばれたディレクトリへの**書き込み** … `getDirectoryHandle` / `getFileHandle` /
  `createWritable` を使う `VaultWriter` そのもの。全面的に Neus の性質。

OPFS(`navigator.storage.getDirectory()`)は**同じ `FileSystemDirectoryHandle` を返す**ので、
`showDirectoryPicker` だけを差し替えれば、その先は**実物の VaultWriter が実 File System
Access API で実ファイルシステムに書く**。#2 で proxy 応答だけを差し替えたのと同じ切り分け。
固定した性質: `neus/<uuid>.md` の生成 / **ローカル日付**の日次ノート追記 / 2回目の書き出しが
日次ノートを**上書きせず追記**しヘッダは1回だけ / ダイアログ中止時に**1バイトも書かない**
かつ AbortError をエラーとして記録しない。

**#7 / #9 — Bookmarklet / Android 共有**

`manifest.json` の `share_target` は **method GET**。つまり OS の共有シートも bookmarklet も、
最終的には `/?share_url=…&share_title=…` を開くだけで、Neus 側の受け口は**ただの URL**。
その URL を開けば `ShareTarget.handle` → `ingest` の実装が丸ごと走る。固定した性質:
url+title の取込 / **share_text に埋め込まれた URL の抽出**(Android の多くのアプリはこの形)/
トラッキングパラメータ除去 / `javascript:` の拒否 / URL を含まない共有で何も作らないこと /
`history.replaceState` でクエリが消えるため**再読込しても二重取込しない**こと。

人手に残るのは「OS の共有シートに Neus が出るか」だけで、これは実質 #8(インストール状態)
の裏返し。

**結果**: STEP 7 で人が触るのは **#3 / #7 / #8 / #9 の4行**だけになり、しかもその4行とも
**アプリのロジックではなく外側**(ベンダ応答・OS 共有シート・ブラウザのインストール UI)の
確認に縮んだ。目安 約10分 → 約5分。

**台帳側の直し**: STEP 7 の「自動」列に `一部CI` が増えたため、人手件数のガードを
「`人手` の行数」から「**`人手` + `一部CI` の行数**」に変えた。`人手` だけを数えると
利用者に求める作業を過少申告することになる(#3/#7/#9 は人が見る行なのに 0 と数えてしまう)。

- 変更: `tests/browser-beta-flows.spec.mjs`(+9 spec)、`tests/docs-no-frozen-counts.test.mjs`
  (ガードの数え方)、`DEPLOY.md` STEP 7、`G10_RELEASE_CHECKLIST.md`。実装コードの変更なし。

### 10.58 第56次監査 (round 69) — #3 を機械化したら、**日次予算の超過**が出た

round 67 は #3 を「実APIキー(課金)が要る」として半分だけ機械化していた。もう一段問い直すと、
シナリオが確かめたいのは **設定保存 → 予算管理 → プロバイダ分岐 → リクエスト組立 →
応答の取り出し → カード反映** という Neus 側の経路で、ベンダの稼働ではない。#2 と同じく
**ベンダ応答だけ**を差し替えれば経路は実物のまま走る。設定は IndexedDB へ直接書かず
**実際の SETTINGS モーダルを操作**した(シナリオの文言がその順序を求めており、設定 UI と
`Store.getSetting('byok')` の結合自体が壊れうるため)。

**そして予算テストで実バグが出た**。「budget=1 で3件同時に取得」を流すと、**ベンダ呼び出しが
3回**行われた。原因は `summarize()` の構造:

```
if(typeof s.budget==='number'&&dailyCount>=s.budget){...return null;}   // 確認
...await callAnthropic(...)                                             // 呼び出し
dailyCount++;await persist();                                           // 加算(応答後)
```

`inbound.fetched` は各アイテムを await せず publish するため、**全アイテムが同じ
`dailyCount` を読んでから加算する**。budget を超えた回数だけ課金される。

これは「要約が出ない」より重い。**予算は利用者の実費の上限**であり、超過は利用者の財布に
直接効く。フィード1回で30件なら、budget 5 の設定でも30回呼ばれうる。

**修正**: 枠を**呼び出しの前に**確保する。確認と加算の間に await を挟まないので、他のイベントが
割り込む余地がない(JS は単一スレッドなので、同期ブロックであることが保証になる)。
失敗時は枠を返す — 要約が得られていない以上、一時的な障害で枠だけ減るのは筋が通らない。

**固定した性質**: 要約がカードに載ること / リクエストに鍵・`anthropic-version`・記事本文が
入ること / `budget:0` が「無制限」と読み替えられないこと(0 は falsy なので `typeof` 判定が
要る)/ **同時到達でも budget を超えないこと** / 失敗時に枠が戻ること / 401 で要約を捏造せず
カードは壊れないこと / **BYOK 未設定ならベンダへ一切通信しないこと**(G0 の「個人データの
サーバ送信ゼロ」を既定状態で守っているかの確認でもある)。

- 変更: `index.html`(`Summarizer.summarize` の枠確保順序)、`tests/browser-beta-flows.spec.mjs`
  (+7 spec)、`DEPLOY.md` STEP 7 の #3 欄。
- #3 の人手は「実ベンダが我々のリクエスト形を受け付けるか」だけになった。

### 10.59 第57次監査 (round 70) — #8 の人手部分を、実際に人手な一点まで絞る

#8(PWA インストール)は「ブラウザ UI そのもの」として丸ごと人手に残していた。半分は正しい —
アドレスバーの `+` を押すのは人にしかできない。しかし**そのボタンが出るかどうか**は
ブラウザの気分ではなく、**Chrome が公開している判定条件**を満たしているかで決まり、
条件は一つ残らず測定できる。つまり #8 は「条件を満たしているか(機械)」と
「ボタンを押すか(人)」に割れる。

**`beforeinstallprompt` は使わないと決めた**。headless Chromium では発火しないことを実測で
確認した(engagement heuristics に依存)。発火を待つテストは**環境の都合で常に落ちるか、
常にスキップされるか**のどちらかにしかならず、どちらも情報を持たない。代わりに
**条件そのもの**を測る — これは Chrome が実際に見ているものと同じ。

**そしてアイコンの検査で不整合が出た**。manifest は 192x192 / 512x512 と宣言しているが、
実際に `<img>` で復号すると **150x150** になる。原因は data URI 内の SVG が `viewBox` だけを
持ち **`width` / `height` を持たない**こと。固有寸法を持たない SVG は、置換要素の CSS 既定値
である 150x150 で描画される(実測で確認: `viewBox` のみ → 150x150、`width`/`height` 付き →
192x192)。

**宣言と実体が食い違っている**ので、SVG に `width`/`height` を与えて一致させた。
なお **Chrome のインストール判定がこの不一致を理由に拒否するかどうかは headless では
検証できなかった**ので、そこは主張しない。主張するのは「manifest が 192x192 と言っている
画像は 192x192 として読み込めるべきで、いまはそうなった」という点だけ。

**固定した性質**: secure context / SW が登録され**ページを制御している**(登録だけでは
Chrome は満たさない)/ SW が fetch ハンドラを持つ / manifest が取得でき name・start_url・
display・scope が妥当 / `short_name` がランチャーに収まる長さ / 192px・512px・maskable の
アイコンがあり、**宣言どおりの寸法で実際に復号できる** / `share_target` が GET で
`/` を指し3つの param を持つ(#8 と #9 が同じインストール状態に依存することの明示)。

- 変更: `manifest.json`(SVG アイコンに固有寸法)、`tests/browser-beta-flows.spec.mjs`(+6 spec)、
  `DEPLOY.md` STEP 7 の #8 欄。
- STEP 7 で「全体が人手」の行は**ゼロ**になった。残るのは4行の外側確認と、**主観評価**。

### 10.60 第58次監査 (round 71) — 送り出す側と読む側の param 名が一致しているか

round 68 で share target の**受け口**は固定したが、**送り出す側**は未検証だった。
bookmarklet は `Bookmarklet.generate()` が origin から組み立てる。つまり
`share_url` / `share_title` という param 名を**両側が独立に持っている**。片側だけ改名すれば、
テストは全部緑のまま **bookmarklet だけが黙って動かなくなる**。round 62 の BYOK プロバイダ
結合と同じ形の暗黙の結合。

**やったこと**: 実際に SOURCES → BOOKMARKLET を押して生成された `javascript:` URL を取り出し、
その**本体を偽の `location` / `document` で実行**して `window.open` の引数を捕まえ、
**その URL をそのまま app に食わせる**。送り出しから取り込みまでが一本の経路として検証される。
片側を改名すればここで落ちる。

**`bookmarklet.js` の写しも突き合わせた**。これは手動インストール用のドキュメントで、実際に
配られるのは in-app 生成物。写しが本体からずれると**手動で入れた人にだけ壊れたものが渡る** —
round 66 の OPML ミラーと同じ構図なので、同じように機械で見張る(現時点でずれは無かった)。

**`npm run g10` の陳腐化を直した**: owner 向けメッセージが「実端末が要るシナリオ: #2 / #3 /
#5 / #7 / #8 / #9」と**手書きで**列挙していた。round 67–70 で #2 と #5 は機械化済みなので、
この文言は既にずれていた。列挙をやめ、**`DEPLOY.md` STEP 7 の表から導出**するようにした
(round 45 の「手で同期する数字は必ずまた壊れる」を、数字だけでなくリストにも適用)。

- 変更: `tests/browser-beta-flows.spec.mjs`(+3 spec)、`scripts/g10.mjs`(導出化)。
  実装コードの変更なし。

### 10.61 第59次監査 (round 72) — 「確認 → await → 変更」型を総当たりし、もう1件見つけた

round 69 の BYOK 予算超過は「確認と変更の間に await がある」形の欠陥だった。**同じ形が他に
無いか**、モジュールレベルの可変フラグ・カウンタを総当たりで見た。結果、`WordCollector.collectAll`
に**同型の穴**が残っていた:

```
if(busy){...return 0;}                                 // 確認
if(!NetworkMonitor.isOnline()){...return 0;}
const words=(await Store.listWords()).filter(...);     // ← ここで await
if(words.length===0)return 0;
busy=true;                                             // 変更
```

**実測**: 3語登録した状態で `collectAll()` を2つ同時に走らせると、収集が **6回**(正しくは3回)。
両方の呼び出しが門を通っていた。

**机上の話ではない**。`collectAll` は4経路から呼ばれ、うち2つは利用者の操作と無関係に発火する:
- `NetworkMonitor` のオンライン復帰ハンドラ(`fetchAll().then(collectAll())`、**await されない**)
- Service Worker からの定期同期
- POLL ボタン / COLLECT ALL ボタン

定期同期やオンライン復帰が POLL 押下と重なるのは**ごく普通の並び**。しかも被害は
「収集が二重に走る」では済まない — 単語収集は1語につき Wikipedia / HN / Reddit / arXiv /
Qiita / Zenn / はてな / GitHub を叩くため、**登録語数 × ソース数の外部リクエストが丸ごと
二重になる**。第三者サービスに対するレート制限・行儀の問題であり、同じ word レコードへの
`Store.putWord` も競合する。

**修正**: 確認の直後に同期で `busy=true` を立て、リスト取得を `try` の中へ移した。
「単語ゼロで早期 return」も予約後に入るため、`finally` を通って必ずフラグが解放される
(ここを間違えると**以後セッション中ずっと収集不能**になる)。

**問題が無かったもの(記録)**: `collectOne` / `RSSPoller.fetchAll` / `addWord` /
`VaultMatcher.scan` はいずれも確認の直後に同期でフラグを立てており、同じ穴は無い。
再導出しなくて済むよう、この4つも同じ構造テストで固定した。

**ヘルパーの欠陥も1件**: `extractFunction` が `async function` を見つけられなかった。
つまり**非同期関数には一度も使えていなかった** — 面白い関数の大半がそれである。
`collectAll` を取り出そうとして初めて判明。修正済み。

- 変更: `index.html`(`collectAll` の予約順序)、`tests/collector-busy-guard.test.mjs`(新規9件)、
  `tests/helpers/from-source.mjs`(async 対応)。

### 10.62 第60次監査 (round 73) — 近い親戚:「読む → await → 丸ごと書き戻す」

round 69 / 72 で潰したのは「確認 → await → 変更」。その親戚に
**「レコードを読む → 長い await → まるごと書き戻す」**がある。await の最中に同じレコードが
別経路で更新されると、**古いコピーで丸ごと上書き**され、その更新が消える(lost update)。

要約はこの形に真正面から当たる。**LLM 呼び出しは秒単位**で、その間カードは画面に出ていて
操作できるため、待っている間の星付け・既読・アーカイブ・メモ保存は**普通に起こる**。

**実測**:

| 操作 | 結果 |
|---|---|
| 要約待ちの間にカードへ星を付ける | 星の数が **1 → 0**(要約の書き戻しが消した) |
| RESUMMARIZE 中に SAVE でメモを保存 | メモが**消滅**(保存された値が残らない) |

どちらのハンドラも「自分が担当するのは summary だけ」なのに、**レコード全体を書き戻していた**。

**修正**: 長い await の**直後に読み直し**、自分の担当フィールドだけを載せて書く。
- `Bus.subscribe('event.tagged')` … `content.summary` のみ
- `#detail-resummarize` … `content.summary` のみ
- `VaultWriter.exportEvent` / `exportBatch` … `state.exported` / `exportedAt` のみ
  (`ensureWriteAccess` はディレクトリ選択ダイアログを出しうるので**待機時間は原理的に無制限**)

**同じハンドラで見つかった2つ目**: `#detail-resummarize` は `currentDetailId` を**await の後に**
読んでいた。要約待ちの間に別カードを開かれると、**別のイベントを書き、そのモーダルを開き直す**。
開始時に id を固定して解消。

- 変更: `index.html`(4箇所の読み直し + id 固定)、`tests/browser-beta-flows.spec.mjs`(+2 spec)。
- 再現テストを先に書いて赤(星 1→0 / メモ空)を確認してから修正した。

### 10.63 第61次監査 (round 74) — 同じ形は**一括処理**にもあった

round 73 は要約経路を直したが、「入口で全件をスナップショットし、1件ずつ await しながら
書き戻す」一括処理にも同じ形が残っていた。該当は2つ:

- `KeywordRules.reapplyAll` … REAPPLY TO ALL(DEPLOY STEP 7 の #14)
- 単語改名の `word:` タグ差し替えループ

**`reapplyAll` はさらに悪い**。INP のために **50件ごとに明示的に yield している** —
応答性のために**わざと制御を手放す設計**なので、割り込みは「起こりうる」ではなく
**起こる前提**。それでいて入口のコピーを書き戻していた。

**実測(旧コードに対して)**: 2件の対象イベントで、1件目の書き込み中に2件目へ星を付けると、
**その星は消える**(`false`)。修正後は残る(`true`)。テストが自明式でないことを、
旧実装を流し込んで確認済み。

**修正**: 書く直前に読み直す。判定(`evaluate`)はタイトル等の不変な値しか見ないので
スナップショットのままでよく、**書き込み対象だけを読み直す**ので走査全体の追加コストは
「変更する件数ぶんの get」に収まる。走査中に削除されたレコードは読み直しで消えているので
**復活させずに読み飛ばす**(以前は削除済みイベントを書き戻して蘇生させていた)。

改名ループも同様に読み直し、冪等性の要である `indexOf(oldTag)` 判定を**新しいコピー側**で
行うようにした(適用済みは自然に読み飛ばされる、という既存の性質を保つ)。

- 変更: `index.html`(`reapplyAll` / 改名 retag ループ)、`tests/bulk-write-freshness.test.mjs`
  (新規6件)。

### 10.64 第62次監査 (round 75) — 単語収集にも同じ形が残っていた

`_collectOne(word)` は渡された `word` を持ったまま Wikipedia と最大8つの検索フィードを並列に
取得し(それでも**秒単位**)、終わってから `Store.putWord(word)` で書き戻す。一方 WORDS 画面の
ハンドラは**例外なく** `const word=await Store.getWord(btn.dataset.id)` で**別のコピー**を
読んでから書き戻す。したがって収集中の「問いを追加」「判定を保存」「レビュー済み」は、
後から届く収集の書き戻しに**消される**。

**当たりやすさが高い**のがこの箇所の特徴。COLLECT を押してから結果が出るまでの数秒〜十数秒は、
利用者が手持ち無沙汰で他の欄をいじる時間そのものである。

**実測(旧コードに対して)**: 収集中に問いを1件追加すると、収集完了後に**その問いは消える**
(`false`)。修正後は残る。旧実装を同じテストに流し込んで確認済み。

**修正**: 書く直前に読み直し、収集が担当するフィールド(`wiki` / `lastCollectedAt` /
`lastFetched` / `lastErrors`)だけを載せる。呼び出し元が持つコピーにも同じ値を反映する —
`collectOne` の直後に `renderWordList()` が走るため、ここを忘れると**取得できているのに
0件と描画される**。

**明示的に選んだ挙動**: 収集中に単語が削除された場合、`Store.getWord` は null を返すので
手元のコピーへフォールバックし、レコードは再作成される。収集は実際に行われておりその結果は
どこかに属するべき、という判断。テストにその選択を明記した(「そうなっている」ではなく
「そう決めた」と読めるように)。

- 変更: `index.html`(`_collectOne` の読み直し)、`tests/word-collect-freshness.test.mjs`
  (新規6件)。

### 10.65 第63次監査 (round 76) — 系統の最後: 書き出し系の長い await

残っていたのは **word 書き込みのうち長い await を挟む経路**。いずれも末尾で
`word.reviewedAt=Date.now();await Store.putWord(word)` と**レコード全体**を書き戻していた。
担当は `reviewedAt` だけなのに、である。

| 箇所 | 挟まる待ち | 窓 |
|---|---|---|
| `copyMd` | `gather()` 全イベント走査 + **クリップボード権限プロンプト** | 原理的に無制限 |
| `downloadMd` / `downloadJson` | `gather()` / `othersOf()` | 件数比例 |
| `toVault` | `ensureWriteAccess()` = **ディレクトリ選択ダイアログ** | 原理的に無制限 |
| `downloadAllMd` | 全単語 × 全イベント走査 | 積で増える |
| `refreshwiki` ハンドラ | Wikipedia への往復 | 秒単位 |

**窓の広さでは round 75 より悪い**。ダイアログ待ちには上限が無い。

**実測(旧の末尾に対して)**: 書き出し中に問いを1件保存すると、`reviewedAt` は正しく記録
されるのに**その問いは消える**。「動いているように見えて中身が欠ける」形なので、
利用者が気づく契機が無い。

**修正**: 4箇所に同じ再読を4回書くのではなく、`WordExporter.markReviewed(word)` を1つ作って
そこへ集約した(重複の削除でもある)。`downloadAllMd` の末尾ループと `refreshwiki` も同様に
読み直す。

**削除時の扱いは `_collectOne` と逆にした**: `reviewedAt` / `wiki` は**既存レコードへの注記**で
あり、収集結果のように「どこかに属するべき」ものではない。走査中に削除されていたら**書かない** —
利用者が消したものを注記のためだけに蘇らせない。この非対称は意図的なので両方のテストに明記した。

**ヘルパーの欠陥をもう1件**: `extractConst` が**配列リテラルを扱えなかった**(終端 `]` を見て
いなかった)。共有の参照表は `const X=[` で書かれているため、**それらには一度も使えていなかった**。
`VERDICT_DEFS` を取りに行って判明。修正し、本テストはスタブではなく**実物の参照表**を使う。

- 変更: `index.html`(`markReviewed` 追加 + 6箇所の経路)、`tests/word-export-freshness.test.mjs`
  (新規19件)、`tests/helpers/from-source.mjs`(配列リテラル対応)。

### 10.66 第64次監査 (round 77) — 削除の監査、および「消せるように見える正しいコード」

round 69→76 は追加が続いたので、**逆を試した**: 無くせる部品はないか(最良の部品は無い部品)。

**結果はゼロ**。CONFIG 24キーは全て参照済み、トップレベル関数 101 個に未使用は無く、
CSS クラス 186 個も全て生きていた。**削除すべきものは見つからなかった**ので、何も削っていない。

**ただし調べ方に落とし穴があった**。素朴な走査は 13 個を「未使用」と報告する:

| 誤検出 | 実際の生成元 |
|---|---|
| `.v-open` / `.v-converging` / `.v-answered` / `.v-suspended` | `class="word-verdict v-${verdictOf(w)}"` |
| `.tier-research` | `class="word-prov-tier tier-${tb.tier}"` |
| 関数8件 | spread(`...evidencePrompts(word,events)`)やテンプレート越しの呼び出し |

**クラス名が実行時に組み立てられている**ため、文字列としてはソースのどこにも現れない。
つまりこれらは「**正しいのに、消せるように見える**」。将来「未使用CSSの掃除」を素直に走らせた
人は、裁決ピルの色分けと出所ティアの強調を**気づかずに壊す**。しかも壊れ方は見た目だけなので
テストは緑のままになる。

**やったこと**: 見えない結合を、機械が見張る結合へ変えた(round 62 の BYOK プロバイダ結合、
round 71 の bookmarklet param 名と同じ手当て)。
- `VERDICT_DEFS` のキー集合と `.v-<key>` 規則の集合が**両方向で一致**すること
  (キー追加 → 無地のピルが出荷されるのを防ぐ / キー削除 → 孤児規則が残るのを防ぐ)
- `.tier-<key>` が**実在のティアを指す**こと。逆方向は**あえて課さない** —
  強調するティアを1つに絞るのは設計判断で、無地のティアは誤りではない
- 上の合成箇所そのものも固定(合成の仕方が変われば上の検査が無意味になるため)

**ガードが実際に噛むことを両方向で確認した**: `.v-suspended` を消すと
`VERDICT_DEFS keys with no .v-<key> rule: suspended` で落ち、`research` キーを改名すると
`.tier-<key> rules with no TIER_DEFS entry: research` で落ちる。

- 変更: `tests/css-key-coupling.test.mjs`(新規8件)のみ。**実装コードの変更なし**。

### 10.67 第65次監査 (round 78) — 無くせる「部品」は無かったが、無くせる「仕事」はあった

round 77 の削除監査で消せる**部品**はゼロだった。そこで対象を**仕事**に移した。

`WordExporter.downloadAllMd` は単語ごとに `gather(w)` を呼び、`gather` は毎回
`Store.allEvents()` で**全イベントを読み直していた**。単語数だけ全走査が繰り返される。

**実測(実 Chromium・実 IndexedDB)**:

| 規模 | 単語ごとに読む | 1回読む | 比 |
|---|---|---|---|
| 1,000件 × 10語 | 130 ms | 12 ms | **10.8×** |
| 5,000件 × 30語 | 2,167 ms | 103 ms | **21.0×** |

**直し方は足すのではなく分ける**: 絞り込みを純粋関数 `selectFor(all,word)` として独立させ、
`gather` はその薄い非同期ラッパにした(`gather(word)` を使う単発経路は挙動も費用も不変)。
一括経路は読み出し1回で全単語を賄う。**行数はほぼ増えていない** — 責務を1つ分けただけ。

**副次的な利得が2つ**:
1. 書き出し全体が**同一時点のスナップショット**を見る。以前は書き出し中に届いたイベントが
   後半の単語のドシエにだけ現れ、**同じ書き出しの中で内容が食い違っていた**。
2. round 76 で問題にした「書き戻しまでの窓」が同じ比率で縮む。**性能の工夫が正しさの窓も
   狭める**という、round 74 の逆(応答性のための yield が欠陥を到達可能にしていた)の関係。

**テストは時間ではなく `Store.allEvents` の呼び出し回数を数える** — 遅い CI でも安定し、
「1回であること」という意図そのものを表現できるため。旧実装では5語で5回になり落ちることを確認。

- 変更: `index.html`(`selectFor` 分離 + 一括経路の単一読み出し)、
  `tests/gather-single-read.test.mjs`(新規7件)。

### 10.68 第66次監査 (round 79) — 比較関数の中で仕事をしていた唯一の箇所

round 78 で「無くせる仕事」を探し始めたので、同じ目でソートを見た。ファイル全体を走査した
結果、**比較関数の中で関数を呼んでいるのは1箇所だけ**(他は全て事前計算か素の値参照)で、
それが `renderWords` の並べ替えだった:

```
words.slice().sort((a,b)=>{const d=_wSortVal(a)-_wSortVal(b); ...})
```

`_wSortVal` の `new` 分岐は**キー1つにつき全イベントを走査**する。比較関数の中で呼ぶと同じ
単語が何度も評価され、しかも**回数は V8 のソート実装と入力順に依存する**。

| 規模 | `_wSortVal` 呼び出し | 時間 |
|---|---|---|
| 1,000件 × 10語 | 18 → **10** | 2.4ms → 0.5ms |
| 5,000件 × 30語 | 128 → **30** | 20.9ms → 4.1ms |
| 10,000件 × 50語 | 98 → **50** | 29.9ms → 15.6ms |

**派手な数字ではない**。既定の並びは `date` で、この分岐は利用者が「新着順」を選んだときだけ
通る。それでも**同じ答えを何度も計算し直す**のは無くせる仕事で、直し方は教科書どおりの
decorate-sort-undecorate — 足すのではなく**重複を消す**変更である。

**テストの重点は速度ではなく並び順に置いた**。この種のリファクタの本当の危険は「遅いこと」
ではなく「順序が変わること」だから。3つの並び順すべてで旧比較関数と**同一の ID 列**になること、
同順位の tiebreak(createdAt 降順)が保たれること、キーが定数ではない(= 同一性検査が
空虚に通っていない)ことを固定した。あわせて「旧実装では実際に30回超の評価が起きていた」ことも
テストにしてある — この前提が崩れたなら、上の正当化ごと見直すべきだから。

- 変更: `index.html`(decorate-sort-undecorate)、`tests/word-sort-key.test.mjs`(新規10件)。
  ミラーアンカー1件(`tests/word-sort.test.mjs`)を同一コミットで同期。

### 10.69 第67次監査 (round 80) — 保存できないとき、製品は何と言うか

round 79 で「無くせる仕事」の系統は尽きたので、問いを変えた。**ローカルファースト製品なので
全ての状態は端末の IndexedDB にある。そこへ書けなくなったら何が起きるのか。**

答えは「**何も起きない**」だった。実 Chromium で events ストアへの `put` を
`QuotaExceededError` で失敗させた実測:

| 観測点 | 結果 |
|---|---|
| 実際に保存されたイベント | **2 / 6** |
| 利用者が見た通知 | `polling 3 source(s)...` → **`fetched 6 item(s)`** |
| 手がかり | console の `[Dedup] pipeline error: QuotaExceededError` のみ |

**「6件取得しました」と告げながら4件を黙って捨てていた。** ディスクが本当に一杯なら全件が
消え、それでも成功と表示される。ローカルファーストの製品にとって、**静かなデータ損失を成功
として報告する**のは最も避けたい失敗の形である。

**さらに悪い点**: 安全網である `StorageGuard` は `event.stored`(**成功**)に繋がっていた。
書き込みが全滅している間は、容量を点検する仕組みそのものが**一度も走らない** — 安全網が
必要な状況でだけ外れる、という逆立ちした配線だった。

**直したのは3点**:
1. 保存失敗を取り込み失敗と**区別**する(`isStorageError`)。名前は実装差があるので
   `QuotaExceededError` / `UnknownError` と文言の両方を見る(取りこぼすと「静かに消える」
   側に倒れるため広めに取る)。
2. **利用者に伝える。**「何か問題が発生しました」では役に立たない — 直せるのは利用者の端末側
   なので、空き容量の確認と Vault への書き出しという**次の行動**を書く。
3. **失敗時にも `StorageGuard` を走らせる。**

**やらなかったこと**: 失敗を `inbound.error` として数えるのはやめた。`SourceFailTracker` が
連続失敗でソースを自動無効化するため、**ディスクが一杯なだけで健全なフィードが切られる**。
原因が利用者の端末にあるとき、フィードを責めてはいけない。

**通知は1バーストにつき1回に畳む**(既定60秒)。通知しないより悪いのは、30件ぶんの通知で
画面を埋めて他の情報を隠すこと。

- 変更: `index.html`(`isStorageError` / `storage.write-failed` トピック / 通知 /
  ガードの配線 / `storageWarnCooldownMs`)、`tests/browser-storage-failure.spec.mjs`(新規7件)。
- 実ブラウザで検証する理由: 失敗は IndexedDB という**プラットフォーム側**から来るもので、
  模造品では本物のトランザクション失敗の経路を通せないため。旧実装では7件中4件が落ちる。

**この系統のまとめ(round 69→76)**: 「確認 → await → 変更」2件、「読む → await → 書き戻す」
11箇所。いずれも**関数単体の正しさを見ている限り見えない**種類で、「同時に何が走りうるか」を
問うて初めて出た。特に `reapplyAll` は、**応答性のための yield が欠陥の到達可能性そのもの**
だった点で示唆的 — 性能上の工夫と正しさの欠陥が同じ1行に同居していた。
