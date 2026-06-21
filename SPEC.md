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
  sources: { wikipedia, news, reddit, hn, arxiv },  // 収集ソース toggle
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
- 収集: 登録時 + POLL 時 + AutoSync 時に `WordCollector.collectAll()`
  - 検索型 RSS (Google News / Reddit / HN / arXiv) は `/rss` 経由で検索フィードを取得し `parseFeed` で解析
  - タグ型 Atom (Qiita / Zenn) は term をタグスラグ (小文字・ハイフン化) に正規化して
    `qiita.com/tags/{slug}/feed` / `zenn.dev/topics/{slug}/feed` を `/rss` 経由で取得。
    一致タグが無ければ 404 が `lastErrors` に http_404 として記録され「取得失敗」表示
  - Wikipedia 要約は `/json` 経由で取得 (Wikipedia/Wikimedia 許可リスト)
  - 取得アイテムは `inbound.fetched` で既存パイプラインに投入、`word:{term}` を付与
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
| `questions` | 未解決の問い (アポリア)。`resolvedAt` の無いものを数える |
| `socraticPrompts` | 状況に応じ最大3件の問い直しを提示 |
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
| `GET /json?url=` | host が `*.wikipedia.org \| *.wikimedia.org` 限定。Content-Type に `json` |
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
- **dedup の Jaccard が O(n^2)**: 24h ウィンドウ内の近傍比較は件数増で重くなるが、
  正当性の欠陥ではなく性能課題。別途 ADR で窓の上限化を検討する。
