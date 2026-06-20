# Neus — Architecture

v0.12.0 アーキテクチャ概観。詳細な設計判断は `docs/adr/`、正式な仕様は `SPEC.md` 参照。

## 全体像

```
┌─────────────────────────────────────────────────────────────────┐
│ index.html(単一PWA、ES module インライン、~135KB)             │
│                                                                 │
│  ┌─────────┐    ┌──────┐    ┌──────────┐    ┌──────────────┐  │
│  │ Inbound │───>│ Bus  │───>│Processor│───>│   Storage    │  │
│  │Adapters │    │      │    │         │    │  (IndexedDB) │  │
│  └─────────┘    └──┬───┘    └──────────┘    └──────────────┘  │
│       │            │             │                    │       │
│  ┌────┴──────┐    │       ┌─────┴──────┐    ┌────────┴────┐  │
│  │RSS Poller │    │       │TagLearner  │    │FTS Index    │  │
│  │ShareTarget│    │       │Summarizer  │    │(in-memory)  │  │
│  │Bookmarklet│    │       │KeywordRules│    └─────────────┘  │
│  └───────────┘    │       └────────────┘                      │
│                   │                                            │
│  ┌──────────────┐ │   ┌──────────────┐   ┌─────────────────┐  │
│  │ Outbound     │<┘   │     UI       │   │  Background     │  │
│  │ Adapters     │     │              │   │                 │  │
│  │              │     │ - Views      │   │ - AutoSync(SW)  │  │
│  │ VaultWriter  │     │ - Modals     │   │ - StorageGuard  │  │
│  │ MarkdownExp  │     │ - Onboarding │   │ - NetworkMon    │  │
│  │ JSONBackup   │     │ - i18n       │   │ - SourceFail    │  │
│  └──────────────┘     └──────────────┘   └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  │ HTTPS
                                  ▼
                       ┌──────────────────┐
                       │ Cloudflare       │
                       │ Worker(_worker.js)│
                       │ CORS RSS Proxy   │
                       └──────────────────┘
```

## レイヤー別責任

### 1. Inbound Adapters
入力の正規化。様々なソース形式を `InformationEvent` に統一。

| Adapter | 入力 | 出力topic |
|---|---|---|
| `RSSPoller` | RSS/Atom XML(Workerプロキシ経由) | `inbound.fetched` |
| `WordCollector` | 単語の検索フィード(RSS) + Wikipedia(JSON、`/json` 経由) | `inbound.fetched` |
| `ShareTarget` | URL params(PWA Share Target) | `event.stored` |
| `Bookmarklet` | URL params(`?share_url=...`) | `event.stored` |
| `OPML.parse` | OPML XML(ファイル) | Sources(直接保存) |

`WordCollector` 由来のイベントは `source.type:'word'` を持ち、正規化時に
`meta.autoTags` へ `word:{normalized}` が付与される。以降の処理は他ソースと共通。

### 2. Event Bus(pub/sub)
モジュール間結合度を最小化。topic 11種類:

| Topic | 用途 |
|---|---|
| `inbound.fetched` | 生Eventをbus入力 |
| `event.normalized` | 形式統一済み |
| `event.stored` | DB保存完了 |
| `event.tagged` | 自動タグ付与 |
| `event.summarized` | AI要約完了 |
| `event.user-annotated` | ユーザー編集 |
| `event.duplicate` | 重複検知 |
| `event.blocked` | KeywordRulesブロック |
| `inbound.error` | フェッチ失敗 |
| `summarizer.error` | LLM失敗 |
| `summarizer.budget-exceeded` | 日次予算到達 |

### 3. Processors
Eventを変換・拡張。

| Processor | 役割 | 副作用 |
|---|---|---|
| `KeywordRules` | watch/block ルール適用 | state.archived/starred、保存スキップ |
| `TagLearner` | userTagsから自動タグ学習 → autoTags生成 | model rebuild |
| `Summarizer` | BYOK LLMで3-bullet要約 | content.summary |
| `Dedup`(inline in `event.normalized`) | hash + Jaccard類似度で重複検知 | links配列に統合 |
| `VaultMatcher` | ファイル名トークンとマッチ | links配列に `vault:` URI |

### 4. Storage
- `IndexedDB`(`neus-v1` version 2): 永続化(events / sources / settings / words 4 stores)。
  upgrade は全 store を `if(!objectStoreNames.contains(name))` でガードし v1→v2 を非破壊にする
- `FTSIndex`: in-memory N-gram inverted index(events と words の両方を索引化)
- `Crypto`: AES-GCM 256bit + PBKDF2 300k iterations(APIキー対象)

### 5. Outbound Adapters
| Adapter | 出力先 | データ形式 |
|---|---|---|
| `VaultWriter` | Obsidian Vault(File System Access) | Markdown + YAML frontmatter |
| `MarkdownExporter` | Clipboard | Markdown |
| `JSONBackup` | Download | JSON(全データ) |

### 6. UI
- Views: INBOX / ALL / STARRED / ARCHIVED / LATER / WORDS / DIGEST / SEARCH
- Modals: Sources / Vault / Settings / Detail / Keywords / Stats / Words / Shortcuts
- Onboarding: 5-step wizard
- i18n: JA/EN, `t()` helper, 100+ keys
- A11y: ARIA roles, focus trap, skip link, keyboard shortcuts

### 7. Background
| モジュール | トリガー |
|---|---|
| `AutoSync` | `periodicsync` SW event(Chromium限定) |
| `NetworkMonitor` | `online`/`offline` events |
| `SourceFailTracker` | 連続5回失敗→ソース無効化 |
| `StorageGuard` | quota 85%超で古い書出済を削除 |

## データモデル

```js
InformationEvent = {
  id: string,                    // UUID
  timestamp: number,             // 取得時刻 epoch ms
  publishedAt?: number,          // 公開時刻(RSS pubDate)
  source: {
    id: string,
    type: 'rss' | 'share' | 'word',
    name: string,
    url?: string,
  },
  content: {
    title: string,
    snippet: string,              // 200文字程度
    summary?: string,             // AI要約
    body?: string,                // 全文(将来)
  },
  meta: {
    autoTags: string[],
    userTags: string[],
    score: number,                // 0-100
    author?: string,
    lang?: string,
    keywordMatched?: {            // KeywordRules適用結果
      watch: string[],
      block: string[],
    },
  },
  user: {
    note?: string,
    quote?: string,
  },
  state: {
    read: boolean,
    starred: boolean,
    archived: boolean,
    later: boolean,               // v0.2.0
    exported: boolean,
    readAt?: number,
    archivedAt?: number,
    laterAt?: number,
    exportedAt?: number,
  },
  links: string[],                // 関連URL + vault: URI
  url: string,                    // 元記事URL
  hash: string,                   // SHA-256 of url+title
}
```

### Watchword(words store、v0.12.0)

単語ウォッチと探究モデル。詳細仕様は `SPEC.md` §5.3 / §6.3。

```js
Word = {
  id, term, normalized, lang, note,
  sources: { wikipedia, news, reddit, hn, arxiv },
  enabled, createdAt, reviewedAt, lastCollectedAt, lastFetched,
  wiki: { title, extract, url, thumbnail, fetchedAt } | null,
  lastErrors: { [label]: code } | null,
  // 探究モデル (inquiry model)
  priorBelief,                    // curious | certain | skeptical | agnostic
  verdict: { status, note },      // open | converging | answered | suspended
  verdictAt, verdictHistory,      // 履歴は HISTORY_CAP=5 件
  falsifier,                      // 反証条件
  questions,                      // [{ id, text, createdAt, resolvedAt? }]
  questionHistory,                // intent 改稿履歴 (HISTORY_CAP=5)
}
```

探究モデルは「語=問い、収集物=答えの差分」とみなす。`cognitiveShift` が事前信念と
裁決の方向逆転 (`shifted`) と終端到達 (`concluded`) を判定し、`socraticPrompts` が
状況に応じた問い直しを最大3件提示する。`SETTLED_VERDICTS` の終端は `answered` と
`suspended` のみ (`converging` は終端でない)。

### Worker endpoints(`_worker.js`)

| endpoint | 制約 |
|---|---|
| `GET /rss?url=` | Content-Type が xml/rss/atom。Conditional GET 転送 |
| `GET /json?url=` | host が `*.wikipedia.org \| *.wikimedia.org` 限定 (SSRF + 任意JSON中継防止) |
| `GET /` | ヘルスチェック |

共通: http(s) のみ / `PRIVATE_HOST_RE` で private IP 拒否 (IPv4-mapped IPv6 の hex 正規化形も照合) /
`readCapped` で本文 5MB 上限 (Content-Length 欠落時も適用) / 15s timeout / `cache-control: no-store`。

## モジュール一覧(v0.12.0、計24+)

| # | モジュール | 行数概算 |
|---|---|---|
| 1 | `Bus` | 12 |
| 2 | `Store`(IndexedDB) | 80 |
| 3 | `Crypto` | 40 |
| 4 | `VaultWriter` | 35 |
| 5 | `FTSIndex` | 35 |
| 6 | `VaultMatcher` | 40 |
| 7 | `OPML` | 10 |
| 8 | `NetworkMonitor` | 12 |
| 9 | `SourceFailTracker` | 12 |
| 10 | `StorageGuard` | 18 |
| 11 | `KeywordRules` | 80 |
| 12 | `ShareTarget` | 25 |
| 13 | `Bookmarklet` | 15 |
| 14 | `RSSPoller` | 30 |
| 15 | `TagLearner` | 30 |
| 16 | `Summarizer` | 60 |
| 17 | `MarkdownExporter` | 20 |
| 18 | `Onboarding` | 100 |
| 19 | `AutoSync` | 40 |
| 20 | `ErrorBoundary` | 20 |
| 21 | `UndoStack` | 25 |
| 22 | `Perf` | 4 |
| 23 | `WordCollector` | 60 |
| 24 | `InterestProfile` | 40 |

## 設計判断(ADR)

| # | タイトル |
|---|---|
| ADR-0001 | Event Bus 採用 |
| ADR-0002 | BYOK 採用 |
| ADR-0003 | File System Access API 採用 |
| ADR-0004 | Tauri 段階繰延 |
| ADR-0005 | Plugin Sandbox(Worker隔離) |
| ADR-0006 | Bonsai 1.7B WebGPU(v1.1) |
| ADR-0007 | モノリス vs 外部化(v0.3.0で外部化) |
| ADR-0008 | AutoSync / Digest / LATER(v0.2.0) |
| ADR-0009 | Event 暗号化 |
| ADR-0010 | arXiv ランキング改善 |
| ADR-0011 | FTS IDF とプライバシ |
| ADR-0012 | Interest Profile |
| ADR-0013 | カテゴリ調査ロードマップ |
| ADR-0014 | PWA UX / スワイプ |
| ADR-0015 | Conditional GET |
| ADR-0016 | Watchword Collector(`/json` 許可リスト) |

## 将来の方針

### v0.3.0
- JS外部化(`app.js`)、CSP `'unsafe-inline'` 除去
- Lighthouse CI 統合
- E2E テスト(Playwright)

### v1.0.0
- Plugin SDK 整備(Web Worker隔離、ADR-0005)
- Tauri デスクトップシェル(ADR-0004)
- Event本文 AES-GCM 暗号化

### v1.1.0
- Bonsai 1.7B WebGPU オンデバイス推論(ADR-0006)
- ベクトル検索(IndexedDB上HNSW)
- 関連付け自動化

### v1.2.0
- Capacitor モバイルシェル
- IMAP メール購読
- Webhook配信
