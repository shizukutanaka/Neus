# Plan.md — Neus

**version**: 0.3.0-draft
**license**: MIT
**status**: PLANNING(精査完了、次は実装段階)
**positioning**: Personal Information Hub(個人情報ハブ)

---

## 1. 目的

自分の情報を一箇所に集約・正規化・要約・検索・既存知識と接続する個人情報ハブ。サーバーレス・端末内完結・個人データ漏洩不可。

## 2. 背景

- 既存RSSリーダー: 集めるだけ、検索弱、ノート連携なし
- 既存知識管理(Obsidian等): 自分で書いた情報のみ、外部流入経路なし
- 既存AI要約: クラウド前提、個人データ送出
- 既存「Read it later」(Pocket等): 単なる後読みリスト、要約・関連付け無
- 課題: 「外部流入 + 既存知識 + 検索 + 要約」を「端末内完結」で行う製品が不在

## 3. 解決する問題

| 問題 | 解決 |
|---|---|
| 情報の分散 | 全入力を InformationEvent に正規化、単一ストア |
| 情報の死蔵 | 全文検索 + タイムライン + タグビュー |
| 知識の孤立 | Obsidian Vault既存ノートと自動突合 |
| プライバシー漏洩 | 端末内完結、サーバーはステートレス転送のみ |
| ツール固定化 | Markdown中間形式 + Adapter拡張点 |
| サブスク負担 | BYOK方式、APIキー自己管理 |
| 受動消費 | Inboxファースト + 自メモ機能で能動再構築 |

## 4. スコープ

### 4.1 IN (v1.0) 入力 Adapter

- RSS / Atom 自動検出 + 購読(最大1000ソース)
- HTTP API: HN / GitHub Trending / YouTube channel RSS / Bluesky / Mastodon
- 手動URL追加
- Share Target API(モバイル共有受信)
- Bookmarklet(PC共有受信)
- **OPML import / export**(RSS界隈標準、Feedly等からの移行経路)

### 4.2 IN (v1.0) Processor

- 正規化(InformationEvent統一)
- 重複検出(URL正規化 + コンテンツhash)
- タグ付け(手動 + 履歴ベース自動学習)
- 要約(BYOK: OpenAI / Anthropic / Gemini)
- Vault既存ノート突合(タイトル + キーワード一致 → 関連ノートリンク提案)

### 4.3 IN (v1.0) Store

- IndexedDB(WebCrypto AES-GCM暗号化)
- 全文インデックス(IndexedDB上 inverted index、N-gramベース、日英中韓対応)

### 4.4 IN (v1.0) 出力 Adapter

- Obsidian Vault直書き(File System Access API、Daily Note追記 + 個別ノート生成)
- Neus内 Inbox / Timeline / TagView / Search UI
- Markdown一括エクスポート(zip)

### 4.5 IN (v1.0) 基盤

- PWA(単一index.html、ServiceWorker、Manifest)
- Cloudflare Workers ステートレスプロキシ(CORS回避のみ、ログ無)
- 多言語UI(JA一次 / EN二次)
- プラグイン機構(Adapter / Processor動的読込、Worker隔離)
- IndexedDB暗号化 + マスターパスフレーズ

### 4.6 UX 3軸(Inbox / Read / Triage)

ハブ概念の体感を支える UX 骨格:

| 軸 | 状態 | 操作 |
|---|---|---|
| **Inbox** | unread, fresh ≤ 24h | 一覧 → タイトルクリックで詳細 |
| **Read** | read済、未整理 | スター / アーカイブ / Vault書出 / メモ追記 |
| **Triage** | 処理済(starred / archived / exported) | 検索・タグ・期間で再到達 |

#### 「自分の言葉で再構築」機能

各 Event に以下を付加可能:

- `userNote` — 自由記述メモ
- `userQuote` — 抜粋引用(原文ハイライト → クリップ)
- `userTags` — 手動タグ(自動タグと別管理)

これら3つは Vault書出時に Markdown 本文に統合、AI要約より上位に配置。

### 4.7 オフライン / エラー状態規定

| 状況 | 挙動 |
|---|---|
| オフライン起動 | 既取得 Event を全表示、新規取得 UI を disabled |
| ネット復帰検知 | 自動再ポーリング(指数バックオフ最大30分) |
| RSS取得連続失敗 ≥ 5回 | ソース自動無効化、ユーザー通知 |
| BYOK API エラー | 要約スキップ + Event は保存、エラーログ記録 |
| BYOK 401/403 | キー再入力誘導 UI |
| IndexedDB クォータ超過 | 古い Event 自動アーカイブ(設定で日数指定) |
| File System Access 権限失効 | Vault再選択 UI |
| マスターパスフレーズ忘却 | 復元不可、初期化のみ(明示警告) |

### 4.8 オンボーディング(初回起動5ステップ)

1. **言語選択**(JA / EN)
2. **マスターパスフレーズ設定**(任意、未設定なら平文)
3. **BYOK 鍵入力**(任意、未設定なら要約スキップ)
4. **初期ソース投入**(プリセット5種から選択 or OPML import or スキップ)
5. **Obsidian Vault 選択**(任意、未選択なら Neus 内ストレージのみ)

各ステップはスキップ可。後から設定 UI で変更可。

### 4.9 IN (v1.1)

- Tauri 2 デスクトップシェル(Win/Mac/Linux)
- **Bonsai 1.7B(1-bit, 290MB) WebGPU オンデバイス推論** — BYOKのフォールバックオプション
  - ライセンス: Apache 2.0(商用制限ゼロ確認済・2026年3月PrismML発表)
  - 実装: WebGPU compute shader + WASM、Cache APIでキャッシュ
  - 対応: Chrome/Edge(WebGPU済)、Firefox/Safariは自動BYOK fallback
  - ADR-0006: ゼロ依存例外として WebGPU runtime CDN lazy load を許容
- ベクトル検索(IndexedDB上HNSW、量子化埋め込み)
- 通知 / アラート(購読キーワード検知)
- 関連付け自動化(類似度ベース、リンク自動生成)
- グラフビュー(Event間関連ネットワーク)

### 4.10 IN (v1.2)

- Capacitor 6 モバイルシェル(Android / iOS)
- メール購読(IMAP via Tauri、Web版はOAuth Gmail/Outlook)
- ファイル監視(Vault変更検知 → 再インデックス)
- Webhook送信(Outbound、他ツール起動)

### 4.11 OUT(明示棄却)

- アカウント・ログイン機能(G0.5違反)
- クラウド同期(同上)
- X公式API契約($200/月、経済的非現実)
- Reddit有料API
- 中央サーバーでの履歴保管
- 広告・トラッキング
- 他人とのフィード共有・SNS化
- Webhook受信(外部公開エンドポイント要、サーバーレス・状態保持ゼロ原則と摩擦)
- マルチデバイス間同期(v1.0)
- 翻訳機能(独立機能として)
- 音声/動画コンテンツの自動文字起こし

## 5. アーキテクチャ

```
┌────────────────────────────────────────────────────────────┐
│  index.html (PWA, 単一ファイル, ~18-20K行想定)              │
│                                                            │
│  ┌──────────────┐   ┌───────────┐   ┌────────────────┐    │
│  │ Inbound      │──▶│ Event Bus │──▶│ Processors     │    │
│  │ Adapters     │   │           │   │  - Normalize   │    │
│  │  RSSPoller   │   │  pub/sub  │   │  - Dedup       │    │
│  │  HTTPFetcher │   │  in-mem   │   │  - Tag         │    │
│  │  ShareTarget │   └─────┬─────┘   │  - Summarize   │    │
│  │  Bookmarklet │         │         │  - VaultMatch  │    │
│  │  OPMLImport  │         │         └────────┬───────┘    │
│  └──────────────┘         │                  │             │
│                           ▼                  ▼             │
│                  ┌───────────────────────────────────┐    │
│                  │ Local Store                       │    │
│                  │  - IndexedDB (encrypted events)   │    │
│                  │  - FTS index (N-gram inverted)    │    │
│                  └─────┬─────────────────────────────┘    │
│                        │                                   │
│                        ▼                                   │
│  ┌────────────────────────────────────────────────────┐   │
│  │ Outbound Adapters                                   │   │
│  │  ObsidianWriter / Inbox / Timeline / TagView /     │   │
│  │  Search / OPMLExport / MarkdownZip                  │   │
│  └────────────────────────────────────────────────────┘   │
└──────────┬─────────────────────────────────────┬───────────┘
           │ CORS proxy only                     │ FS Access API
           ▼                                     ▼
    ┌──────────────┐                    ┌────────────────┐
    │ _worker.js   │                    │ Obsidian Vault │
    │ Cloudflare   │                    │ (local folder) │
    │ stateless    │                    └────────────────┘
    └──────────────┘
           │
           ▼
    [RSS / HN / GitHub / Bluesky / YouTube RSS / ...]
```

### 5.1 InformationEvent(コアデータ型)

```ts
interface InformationEvent {
  id: string;                  // UUIDv7
  timestamp: number;            // 取得時刻
  publishedAt?: number;         // 元公開時刻
  source: {
    id: string;
    type: 'rss'|'api'|'manual'|'share'|'bookmarklet'|'opml';
    name: string;
    url?: string;
  };
  content: {
    title: string;
    body?: string;
    summary?: string;           // AI要約
    snippet?: string;
    media?: { type: string; url: string }[];
  };
  meta: {
    autoTags: string[];         // 自動タグ
    userTags: string[];         // 手動タグ
    score: number;              // 0-100
    lang?: string;
    author?: string;
  };
  user: {                       // 自分の言葉で再構築
    note?: string;
    quote?: string;
  };
  state: {
    read: boolean;
    starred: boolean;
    archived: boolean;
    exported: boolean;
    readAt?: number;
    archivedAt?: number;
    exportedAt?: number;
  };
  links: string[];              // 関連Event ID(Vault突合含む)
  hash: string;                 // SHA-256(正規化URL + title)
}
```

### 5.2 Event Bus契約

- `bus.publish(topic, payload)` — 同期発火
- `bus.subscribe(topic, handler)` — 戻り値は unsubscribe関数
- topic命名: `inbound.fetched` / `event.normalized` / `event.tagged` / `event.summarized` / `event.stored` / `event.user-annotated` / `outbound.export-requested`
- 全 handler は純粋(副作用は Adapter/Store に局所化)

### 5.3 プラグイン契約

```ts
interface Plugin {
  id: string;
  type: 'inbound'|'processor'|'outbound';
  version: string;
  permissions: ('fetch'|'vault-write'|'bus-publish'|'store-read')[];
  init(ctx: PluginContext): Promise<void>;
  destroy(): Promise<void>;
}
```

- ES Module形式のみ、文字列eval禁止
- Permission宣言必須、未宣言操作は実行時拒否
- Web Worker内で隔離実行、Bus通信は postMessage 経由
- CSP厳格 `script-src 'self'`、CDN参照禁止

### 5.4 Vault書き出しスキーマ

Daily Note(`Daily/2026-05-12.md`)末尾に追記:

```markdown
## 📥 Neus — 2026-05-12

- [タイトル](URL) — _ソース名_ #tag1 #tag2 → [[neus/uuid]]
- [タイトル](URL) — _ソース名_ #tag1 → [[neus/uuid]]
```

個別ノート(`neus/<uuid>.md`):

```markdown
---
neus_id: 01933e8b-...      # UUIDv7
source: HackerNews
source_url: https://news.ycombinator.com/
published_at: 2026-05-12T03:14:00Z
ingested_at: 2026-05-12T08:00:00Z
tags: [ai, llm]
score: 87
hash: a1b2c3...
---

# タイトル

> 自分の引用(userQuote が存在する場合)

**自分のメモ**: 自分のメモ(userNote が存在する場合)

## AI要約

(BYOK要約結果)

## 関連ノート

- [[既存ノートA]]
- [[既存ノートB]]

[原文を開く](URL)
```

### 5.5 プラグインサンドボックス

| 隔離レベル | 実装 | 用途 |
|---|---|---|
| Strong | Web Worker + postMessage | サードパーティ Plugin |
| Medium | 関数スコープ + Proxy | 同梱コア Plugin |
| None | 直接実行 | 内蔵 Adapter(RSSPoller等) |

Web Worker内で `fetch` 制限、`store-read` は read-only Proxy 経由、Bus publish は許可された topic のみ。

## 6. フェーズ分割

| Phase | 期間 | 内容 | DoD |
|---|---|---|---|
| **P0** | 2d | requirements.md / design.md / ADR×4 起票 | レビュー2名通過 |
| **P1** | 3d | Event Bus + IndexedDB + RSSPoller + Inbox UI | MVPフロー貫通、テスト50%、`store >= 500/s` |
| **P2** | 3d | BYOK要約 + タグ学習 + ユーザーメモ + Markdown出力 | 主要パス全通、テスト70% |
| **P3** | 2d | 重複検出 + 全文検索 + Vault突合 + OPML I/O | ハブコア完成、テスト75%、`search 10K <= 100ms` |
| **P4** | 2d | Share Target + Bookmarklet + i18n + Onboarding | モバイル流入確認、E2E共有受信通過 |
| **P5** | 2d | Vault書出スキーマ + 暗号化 + オフライン規定 | テスト80%、暗号化100%、オフライン動作確認 |
| **P6** | 2d | Cloudflare Workersプロキシ + PWAビルド + 計測組込 | LH Perf >= 90, PWA = 100 |
| **P7** | 1d | リリース判定(G10) | 全7項目PASS、`v1.0.0` |

合計約17作業日。計測コードは P1 から各実装に組み込む(後付けゼロ)。

## 7. 依存関係・前提

### 外部ライブラリ

- ゼロ依存原則。すべて Web Standard API
- 例外検討: なし(暗号は WebCrypto で完結、libsodium不要)

### 前提環境

- Cloudflare Pages + Workers(無料枠 100K req/day)
- Stripe(ドネーション任意)
- ブラウザ: Chromium系(File System Access API必須)、Firefox/Safariは Blob download fallback

### Web API依存

- IndexedDB / WebCrypto / Fetch / File System Access / ServiceWorker / Share Target / Web Worker

## 8. リスク・対策

| リスク | 影響 | 対策 |
|---|---|---|
| BYOK APIキー漏洩 | High | IndexedDB AES-GCM + マスターパスフレーズ |
| CORSプロキシ悪用 | High | Worker側で Content-Type 限定、レート制限、Referrer検証 |
| プラグイン経由 XSS / 相互干渉 | High | Web Worker隔離 + Permission宣言 + 厳格CSP |
| マスターパスフレーズ忘却 | High | UI に明示警告、復元不可前提を初回時に承諾 |
| File System Access未対応ブラウザ | Med | Blob downloadフォールバック |
| IndexedDB肥大化 | Med | 保持期間設定 + 自動アーカイブ |
| 全文検索メモリ消費 | Med | N-gramインデックスのチャンク化 |
| Vault大規模ノートのインデックス化コスト | Med | タイトル + ファイル一覧のみで突合、本文は遅延読込 |
| AI要約コスト暴走 | Med | トークン上限・日次予算 |
| RSS提供停止サイト | Low | エラーログ + 自動無効化 |
| Lens(Mirantis)とのSEO競合 | Low | "Neus" + "personal hub" 組合せ訴求 |
| 多言語インデックス精度 | Low | N-gram 2-3gram 基本、日英中韓動作確認 |

## 9. 設計原則(G0準拠)

- 人間=決断のみ(G0.1)
- 個人データ極小化、端末内完結、暗号化保持(G0.5)
- ゼロ設計思考(G0.6): Event Bus転換、UX 3軸はこの原則の適用結果
- AI出力検証義務(G0.7): 全自動生成コードに手動レビュー
- Carmack / Martin / Pike: 性能 + クリーン + 簡潔

## 10. 完了定義(DoD)

G10全7項目PASS:

1. Linter警告ゼロ
2. 自動テスト全通過(カバレッジ ≥ 80%)
3. 脆弱性スキャン完了(Critical/High ゼロ)
4. クロスレビュー完了(AI 2名独立判定)
5. ドキュメント最終確認(README / LICENSE / Plugin SDK / UX / Schema)
6. PWA署名ビルド + Lighthouse Performance 90+
7. ベータテスト完了(主要フロー全動作、クラッシュゼロ、主観評価平均 ≥ 4/5)

## 11. 出力成果物

- `index.html` 単一ファイル
- `_worker.js` Cloudflare Worker
- `sw.js` Service Worker
- `manifest.json` PWA(Share Target宣言含む)
- `bookmarklet.js` Bookmarklet配布用
- `docs/` ARCHITECTURE.md / PLUGIN_SDK.md / SECURITY.md / EVENT_BUS.md / UX.md / SCHEMA.md / ADR/
- `CHANGELOG.md` / `LICENSE` / `README.md` / `CLAUDE.md`

## 12. 次アクション(実装段階へ)

精査終了。以降は実装段階:

1. **ADR-0001**: Event Bus型採用理由
2. **ADR-0002**: BYOK選択理由
3. **ADR-0003**: File System Access API選択理由
4. **ADR-0004**: Tauri/Capacitor段階繰延理由
5. **ADR-0005**: プラグインサンドボックス(Web Worker)選択理由
6. **requirements.md**: ユーザーストーリー + 受入条件
7. **design.md**: モジュール詳細 + API仕様 + データフロー
8. P1着手前レビュー → 実装着手
