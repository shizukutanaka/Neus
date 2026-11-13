# Neus — Personal Information Hub

> NEWS + you. ねうす。

サーバーレスの個人情報ハブ。RSS・共有・Bookmarkletで集約し、BYOK要約・タグ付け・全文検索・Obsidian書き出しで再構築する。端末内完結、個人データのサーバー送信ゼロ。

## 特徴

- **ゼロ依存** — 外部ライブラリなし、Web Standard APIのみ
- **BYOK要約** — OpenAI / Anthropic / Gemini、キーは端末内暗号化(AES-GCM)
- **全文検索** — N-gram反転索引 + IDF重み付け、稀少語を優先
- **興味の自動学習** — STAR/ARCHIVEの行動から「欲しい/いらない」を学習しスコア補正
- **単語ウォッチ(Watchword)** — 単語を登録するとGoogle News/Reddit/HN/arXivから関連情報を自動収集、Wikipedia定義カード付き。単語ドシエをMarkdown/JSON/Vaultへ出力
- **キーワードルール** — WATCH/BLOCK で気になる/不要を自動振り分け。カード長押しで素早く追加
- **スワイプ操作** — 右でスター、左でアーカイブ(モバイル)
- **Obsidian Vault連携** — File System Access APIで直接書き出し
- **Share Target / Bookmarklet** — スマホ共有・PC1クリックで取込
- **オフライン動作** — Service Worker(stale-while-revalidate)、オフライン時はキャッシュ表示
- **帯域節約** — RSS Conditional GET(ETag/Last-Modified)で変更なしは取得スキップ
- **PWAインストール** — ホーム画面追加、maskableアイコン対応
- **自動取得** — Periodic Background Sync で定期RSS取得 + 新着通知
- **ダイジェスト** — 過去24h集計・Top3(鮮度減衰スコア)・タグ・週次トレンド
- **読書キュー** — 「あとで読む」専用ビュー、STARと独立
- **堅牢なRSS処理** — 寛容パース(壊れたitemをスキップ)、メディア添付・エンティティ抽出
- **セキュリティ** — ハッシュベースCSP(unsafe-inline除去)、SSRF対策、永続ストレージ
- **JA/EN対応** — 起動時言語選択、後から変更可
- **月額$0** — Cloudflare Pages+Workersの無料枠内で完全稼働

## 動作環境

| 環境 | 対応 |
|---|---|
| Chrome / Edge 111+ | 全機能対応 |
| Firefox | Vault書き出しをBlob DL fallback |
| Safari 16.4+ | File System Access制限あり |
| iOS / Android PWA | Share Target、ホーム画面追加 |

## 依存関係(本番)

なし。`_worker.js` / `index.html` / `sw.js` はWeb Standard APIのみ使用。

devDependencies(ビルド・テストのみ): vitest, wrangler

## セットアップ(ローカル確認)

```bash
git clone https://github.com/shizukutanaka/neus.git
cd neus
python3 -m http.server 8080
# → http://localhost:8080
```

> Vault書き出し・Share Target は HTTPS 環境(Cloudflare Pages等)でのみ動作。

## デプロイ

```bash
# 1. Cloudflareアカウント設定
npm install
npx wrangler login

# 2. index.html の CONFIG.proxy を実際のWorker URLに変更
#    例: 'https://neus-proxy.<your-subdomain>.workers.dev'

# 3. Worker + Pages 一括デプロイ
npm run deploy

# リリース(手動): CHANGELOG 追記 → タグ付け v{MAJOR}.{MINOR}.{PATCH} → npm run deploy
# (CI/CD は未同梱。デプロイはローカルからの `npm run deploy` が正)
```

## 使い方

### 1. 初回起動

オンボーディングウィザード(5ステップ)が起動:
1. 言語選択(JA / EN)
2. パスフレーズ設定 — APIキーをAES-GCM暗号化(任意)
3. BYOKキー入力 — OpenAI / Anthropic / Gemini(任意)
4. プリセットソース選択 — HN / GitHub / Cloudflare等
5. Obsidian Vault選択(任意)

### 2. ソース登録

- **SOURCES** ボタン → RSS/Atom URLを貼り付けて ADD
- **IMPORT OPML** → Feedly等からエクスポートしたOPMLを取込
- **BOOKMARKLET** → ブラウザバーに追加してPC任意ページを共有

### 3. 取得・要約

- **POLL** → 登録ソースを一括取得
- BYOK設定済みの場合は自動要約
- カード **EDIT** → ユーザーメモ・引用・タグを追記

### 4. 単語ウォッチ(Watchword)

- **WORDS**(メニュー)→ 単語を入力し、収集ソース(Wikipedia / Google News / Reddit / Hacker News / arXiv / Qiita / Zenn / Hatena / GitHub)を選んで **ADD**
  - 日本語ソース: Qiita は公式 REST API v2 の全文キーワード検索(JSON、ワーカー `/json` 経由、`docs/adr/ADR-0017`)、Zenn はトピックの Atom フィード(`docs/adr/ADR-0017`)、Hatena(はてなブックマーク)は日本語Web全体の被ブックマーク記事を横断する全文検索 RSS(`docs/adr/ADR-0018`)。GitHub はトピックの Atom フィード(`docs/adr/ADR-0018`)。Zenn/GitHub は一致トピックが無ければ 404 が `lastErrors` に記録され「取得失敗」として誠実に表示される。いずれもデフォルトは OFF(arXiv と同じ opt-in 扱い)
- 登録時とPOLL時に自動収集。各ソースの検索フィードを取得し、`word:{単語}` タグ付きで保存
- **WORDS** ビュー → 単語ごとにWikipedia定義 + 直近アイテム + 出力ボタン(DOSSIER MD / JSON / VAULT)
- 出力先(Vault): `{Vault}/neus/words/{単語}-{id}.md`(語ごとに一意。"C++" と "C" のように同じ slug に正規化される語でも上書きされない)

**探究(ソクラテス式問答)** — 登録した単語は収集対象であると同時に「問い」になる。集めた情報を受動的に眺めるのではなく、自分の理解を吟味する装置として機能する。

- **事前の考え**(prior belief)を記録し、収集後の認識変化(cognitive shift)を可視化
- システムが結論に対して問い返す(**elenchus** / 自問プロンプト)。裁決に至っても別角度の問いで揺さぶり、独断を防ぐ
- **反証条件**(何があれば結論を覆すか)を宣言でき、**Falsifier Watch** が以後の収集物を言語非依存の文字 bigram 被覆で走査して、該当しうるアイテムを能動検出(宣言した反証条件が「証拠を監視する能動センサー」になる)
- **裁決**(verdict)とその**変遷**(dialectic)、**問いの解決**(aporia → resolution)を記録し、単語ドシエ Markdown に出力

> 収集ソースのうちWikipedia(JSON)はワーカーの `GET /json?url=`(Wikipedia/Wikimedia限定の許可リスト)経由。その他はRSS検索フィードのため既存 `/rss` プロキシをそのまま使用。

### 5. Vault書き出し

- カード **VAULT** → 個別ノートをVaultに書き出し
- **VAULT → EXPORT ALL STARRED** → スター済みを一括書き出し
- 書き出し先: `{Vault}/neus/{uuid}.md` + `{Vault}/{date}.md` のDaily Note

### 6. 検索

- ヘッダー検索バー → N-gram全文検索(リアルタイム)

## BYOK設定(AI要約)

**SETTINGS → AI SUMMARY** で以下を設定:

| プロバイダ | 推奨モデル | 取得先 |
|---|---|---|
| Anthropic | claude-haiku-4-5-20251001 | console.anthropic.com |
| OpenAI | gpt-4o-mini | platform.openai.com |
| Google | gemini-1.5-flash | aistudio.google.com |

APIキーは端末内のIndexedDBにのみ保存される。パスフレーズ設定でAES-GCM暗号化可。

## セキュリティ

- **サーバー送信ゼロ** — Workerはステートレスプロキシのみ(ログなし)
- **SSRF防止** — プライベートIP(10.x, 192.168.x等)をWorker側でブロック
- **Content-Type検証** — RSS/Atom以外はWorkerが拒否
- **AES-GCM暗号化** — PBKDF2(300,000 iterations) + 256bit鍵
- **CSP** — `script-src 'self' 'unsafe-inline'`(将来: 外部JSファイル化で`unsafe-inline`除去予定)
- **シークレット** — gitleaks でコミット前スキャン

詳細: `docs/adr/` および `_headers` を参照

## ファイル構成

```
neus/
  index.html          # PWA本体 (~277KB、全ロジックインライン)
  _worker.js          # Cloudflare Worker CORSプロキシ (/rss, /json)
  sw.js               # Service Worker
  manifest.json       # PWA設定(Share Target宣言含む)
  bookmarklet.js      # Bookmarklet配布ドキュメント
  _headers            # Cloudflare Pages HTTPヘッダー(CSP等)
  _redirects          # SPA fallback
  wrangler.toml       # Cloudflare Worker設定
  package.json        # npm scripts
  SPEC.md             # 仕様書(一次情報)
  ARCHITECTURE.md     # アーキテクチャ概観
  CHANGELOG.md        # 変更履歴
  docs/adr/           # 設計判断記録(ADR 0001-0018)
  tests/              # Vitest単体テスト
  scripts/            # HTMLチェッカー等
```

## 開発

```bash
npm run lint          # _worker.js, sw.js 構文チェック
npm run check         # index.html 静的検証 + CSP ハッシュ照合
npm test              # 全単体テスト実行(vitest)
npm run dev           # http://localhost:8080 で確認
```

## キーワードルール

**KEYWORDS** ボタンから設定:

### WATCH(気になる)
含むEventを強調・自動アクション。1行1キーワード入力。

| アクション | 動作 |
|---|---|
| ハイライト | スコア+30、リスト上位表示 |
| 自動スター | `STARRED` ビューに登録 |
| 自動タグ追加 | `watch:keyword` タグ付与 |

### BLOCK(ブロック)
含むEventを非表示・破棄。

| アクション | 動作 |
|---|---|
| 自動アーカイブ | `ARCHIVED` ビューに移動 |
| 破棄(保存しない) | DBに保存せず破棄 |

### Advanced(JSON)

```json
{
  "watch": [
    {"pattern": "\\bAI\\b", "mode": "regex", "scope": "title", "case": false, "action": "star"},
    {"pattern": "released", "mode": "word", "scope": "all", "action": "highlight"}
  ],
  "block": [
    {"pattern": "NFT", "mode": "word", "scope": "all", "action": "delete"}
  ]
}
```

**mode**: `contains` / `exact` / `prefix` / `suffix` / `word`(語境界) / `regex`
**scope**: `title` / `snippet` / `summary` / `tags` / `source` / `all`

## キーボードショートカット

| キー | 動作 |
|---|---|
| `j` / `↓` | 次のカード |
| `k` / `↑` | 前のカード |
| `Enter` / `o` | 詳細を開く |
| `s` / `e` / `r` / `v` / `l` | スター / アーカイブ / 既読 / Vault書出 / LATER |
| `/` / `f` | 検索フォーカス |
| `p` | POLL実行 |
| `g i` / `g a` / `g s` | INBOX / ALL / STARRED へ移動 |
| `?` | このヘルプを表示 |
| `Esc` | モーダル閉 / フィルタ解除 |

`?` を押すと一覧表示。

## バックアップと復元

**STATS** ボタンから:
- **EXPORT JSON** — 全データを `neus-backup-YYYY-MM-DD.json` に出力
- **IMPORT JSON** — JSON ファイルから復元(既存データは置換)

APIキー暗号化がオフの場合、出力時に含めるか確認される。

## 自動取得 (AutoSync)

**SETTINGS → AUTO SYNC** で設定:

| 項目 | 選択肢 |
|---|---|
| 自動取得 | 有効 / 無効 |
| 取得間隔 | 1h / 6h / 12h / 24h |
| 新着通知 | 有効 / 無効 |

Service Worker `periodicsync` で実行され、新着があればOS通知を表示する。Chromium系ブラウザのみ対応 (Firefox/Safariは手動POLL継続)。

### 仕組み

```
ブラウザ idle → SW.periodicsync('neus-poll')
  → クライアント活性 → postMessage → メインスレッドPOLL → 通知
  → クライアント非活性 → silent notification でwake
```

### iOS Safari ユーザー

iOS Safari は Periodic Background Sync 未対応。代わりに手動POLLボタンと、`?` ショートカットで一覧表示。

## ダイジェスト

**DIGEST** ナビで過去24時間のアクティビティを集計表示:

- **メトリクス**: 取得数 / 要約済み数 / 本日スター数
- **Top 3 today**: スコア + 要約 + 未読 の優先度ソート
- **頻出タグ Top 8**: クリックで該当タグの全Eventにフィルタ移動
- **アクティブソース Top 5**: クリックで該当ソースの全Eventにフィルタ
- **週次トレンド**: 7日間の取得件数SVGバーグラフ

すべて端末内集計で、外部送信なし。

## あとで読む (LATER)

**LATER** ナビ または カードの `LATER` ボタン、`l` キーで切替。

| 用途 | 推奨ビュー |
|---|---|
| 長期保管したい記事 | STARRED |
| 後で読むキュー | LATER |
| 既読待機 | INBOX |

LATER は時限的キュー、STARRED は長期コレクションとして使い分け。

## v1.1 予定

- Tauri 2デスクトップシェル(Win/Mac/Linux)
- Bonsai 1.7B(1-bit, 290MB) WebGPU オンデバイス推論(BYOK代替)
- ベクトル検索・グラフビュー・通知

## ライセンス

MIT © shizukutanaka

---

*Neus = NEWS + you*
