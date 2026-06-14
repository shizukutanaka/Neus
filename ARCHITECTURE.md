# Neus — Architecture

v0.2.0 アーキテクチャ概観。詳細な設計判断は `docs/adr/` 参照。

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
| `ShareTarget` | URL params(PWA Share Target) | `event.stored` |
| `Bookmarklet` | URL params(`?share_url=...`) | `event.stored` |
| `OPML.parse` | OPML XML(ファイル) | Sources(直接保存) |

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
- `IndexedDB`: 永続化(events / sources / settings 3 stores)
- `FTSIndex`: in-memory N-gram inverted index
- `Crypto`: AES-GCM 256bit + PBKDF2 300k iterations(APIキー対象)

### 5. Outbound Adapters
| Adapter | 出力先 | データ形式 |
|---|---|---|
| `VaultWriter` | Obsidian Vault(File System Access) | Markdown + YAML frontmatter |
| `MarkdownExporter` | Clipboard | Markdown |
| `JSONBackup` | Download | JSON(全データ) |

### 6. UI
- Views: INBOX / ALL / STARRED / ARCHIVED / LATER / SEARCH / DIGEST
- Modals: Sources / Vault / Settings / Detail / Keywords / Stats / Shortcuts
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
    type: 'rss' | 'share',
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

## モジュール一覧(v0.2.0、計22)

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
