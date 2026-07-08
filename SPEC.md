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
