# Neus デプロイ手順 v0.1.0

実機デプロイ + ベータテスト手順。G10判定の G10.06 / G10.07 を完了させるためのチェックリスト。

## 前提

- GitHub リポジトリ `shizukutanaka/neus` 作成済み
- Cloudflare アカウント作成済み
- ローカルに `node 22+` + `git` インストール済み

## STEP 1: Cloudflare アカウント設定(10分)

```bash
cd /path/to/neus
npm install
npx wrangler login
# → ブラウザでCloudflare認証
```

## STEP 2: Worker デプロイ(5分)

```bash
npx wrangler deploy
# 出力例:
#   Uploaded neus-proxy (1.5 sec)
#   Published neus-proxy
#   https://neus-proxy.<your-subdomain>.workers.dev
```

URL をメモ。次STEPで使用。

## STEP 3: CONFIG.proxy 置換(2分)

`index.html` の以下を編集:

```js
// Before
const CONFIG = Object.freeze({
  proxy: 'https://neus-proxy.example.workers.dev',
  ...
```

```js
// After (STEP2 で取得した URL に置換)
const CONFIG = Object.freeze({
  proxy: 'https://neus-proxy.YOUR-SUBDOMAIN.workers.dev',
  ...
```

検証:
```bash
node scripts/check-html.mjs
# → All checks passed.
```

## STEP 4: Pages 初回デプロイ(5分)

Cloudflare Dashboard で:
1. Workers & Pages → Create application → Pages → Connect to Git
2. GitHub リポジトリ `shizukutanaka/neus` を選択
3. Build configuration:
   - Build command: (空欄)
   - Build output directory: `/`
4. Save and Deploy

または CLI:
```bash
npx wrangler pages deploy . --project-name=neus
```

## STEP 5: GitHub Secrets 設定(3分)

GitHub リポジトリ Settings → Secrets and variables → Actions:

| Secret | 値 |
|---|---|
| `CF_API_TOKEN` | Cloudflare Dashboard → My Profile → API Tokens → Create Token (`Edit Cloudflare Workers` template) |
| `CF_ACCOUNT_ID` | Cloudflare Dashboard 右サイドバー Account ID |

## STEP 6: Lighthouse 実機計測(5分)

```bash
# Chrome DevTools → Lighthouse タブ
# Mode: Navigation, Categories: Performance/PWA/A11y/SEO
```

| 項目 | 目標値 | 確認 |
|---|---|---|
| Performance | ≥ 90 | |
| PWA | = 100 | |
| Accessibility | ≥ 95 | |
| Best Practices | ≥ 95 | |
| SEO | ≥ 90 | |

未達項目があれば Issue 起票 → 修正 → 再計測。

## STEP 7: ベータテスト(人が触るのは4シナリオ+主観評価・約5分)

**先に `npx playwright test` を実行すること。** 下表の大半は
`tests/browser-beta-flows.spec.mjs` ほかの browser spec が実 Chromium で毎回確認しており、
「自動」列が `CI` の行は spec が通っていれば済む。**人手で再実行する必要はない。**

人が触るのは `一部CI` と `人手` の行だけ — いずれも**アプリのロジックではなく、その外側**
(ベンダ応答・OS の共有シート・ブラウザのインストール UI)の確認。PWAインストール環境
(Chrome Desktop)+ Android Chrome で実施する。件数は
`tests/docs-no-frozen-counts.test.mjs` が下表と突き合わせるので、行を足し引きすれば
テストが食い違いを教える。

### Desktop (Chrome 121+)

| # | シナリオ | 期待結果 | 自動 | OK |
|---|---|---|---|---|
| 1 | 初回起動 → 5ステップオンボーディング | JA/EN選択 → SETTINGS反映 | CI | — |
| 2 | RSS追加 → POLL | 取得・解析・重複排除・保存 | CI | — |
| 3 | BYOK設定 → POLL → 要約自動生成 | カードに要約表示・日次予算を超えない | 一部CI | ☐ |
| 4 | 検索バーに「rust」入力 | リアルタイム絞込、match%表示 | CI | — |
| 5 | Vault選択 → VAULTボタン押下 → ノート生成 | `Vault/neus/<uuid>.md` + `YYYY-MM-DD.md` 確認 | CI | — |
| 6 | OPML import(`tests/fixtures/sample.opml`) | 一括登録 | CI | — |
| 7 | BOOKMARKLET → 任意ページで起動 | Share Target経由でEvent作成 | 一部CI | ☐ |
| 8 | PWAインストール(アドレスバー右の `+`) | スタンドアロン起動 | 人手 | ☐ |
| 10 | DevTools → Network → Offline → 再読込 | キャッシュ表示、POLL disabled | CI | — |
| 11 | パスフレーズ設定 → リロード → Lock画面 → 解錠 | APIキー復号成功、要約動作 | CI | — |

`自動 = CI` の根拠: #1/#2/#5/#6/#16v は `browser-beta-flows`、#4 は `browser-ui`、#10 は
`browser-offline` / `browser-sw`、#11 は `browser-functional`。

`一部CI` の内訳(アプリ側は全て CI、人が見るのは外側だけ):
- **#3** … 設定保存 → 予算管理 → プロバイダ分岐 → リクエスト組立 → 応答の取り出し →
  カード反映まで CI(ベンダ応答だけを差し替えて実経路を走らせる)。人手は
  **実ベンダが我々のリクエスト形を受け付けるか**だけ。
- **#7 / #9** … `share_target` は method GET なので、bookmarklet も OS 共有シートも最終的には
  `/?share_url=…` を開くだけ。その受け口(URL抽出・トラッキング除去・`javascript:` 拒否・
  再読込での二重取込防止)は CI。人が見るのは「OS の共有シートに Neus が出るか」だけで、
  これは実質 #8(インストール状態)の裏返し。
- **#5 / #16v** … ディレクトリ選択ダイアログだけを差し替え、その先の `VaultWriter` は
  **実物のまま実 File System Access API**(OPFS 経由)で動かして検証している。

### Android Chrome (PWA)

| # | シナリオ | 期待結果 | 自動 | OK |
|---|---|---|---|---|
| 9 | 別アプリ(ブラウザ) → 共有 → Neus を選択 | Share Target経由でEvent作成 | 一部CI | ☐ |

### キーワードルール検証

| # | シナリオ | 期待結果 | 自動 | OK |
|---|---|---|---|---|
| 12 | KEYWORDS → WATCH に「rust」追加 → POLL | rust含むEventが score+30 | CI | — |
| 13 | KEYWORDS → BLOCK に「crypto」(action: delete) → POLL | crypto含むEventが保存されない | CI | — |
| 14 | KEYWORDS → REAPPLY TO ALL | 既存Eventにも適用 | CI | — |

### キーボードショートカット検証

| # | キー | 期待動作 | 自動 | OK |
|---|---|---|---|---|
| 15 | `j`/`k` | カード移動・ハイライト(端でクランプ) | CI | — |
| 16 | `s`/`e`/`r` | スター/アーカイブ/既読が IndexedDB に反映 | CI | — |
| 16v | `v` | Vault実行(実ディレクトリへ書き込み・日次ノート追記) | CI | — |
| 17 | `?` | ショートカット一覧モーダル | CI | — |
| 18 | `g i`/`g s`/`g a` | INBOX/STARRED/ALL移動(prefix は800msで失効) | CI | — |

### バックアップ検証

| # | シナリオ | 期待結果 | 自動 | OK |
|---|---|---|---|---|
| 19 | STATS → EXPORT JSON | `neus-backup-YYYY-MM-DD.json` 保存 | CI | — |
| 20 | DevTools → IndexedDB全削除 → IMPORT JSON | 全データ復元(確認ダイアログ経由) | CI | — |
| 20b | 他アプリのJSON / 壊れたJSON を IMPORT | 消す前に拒否、既存データ保持 | CI | — |

## STEP 8: リリースタグ(手動・2分)

全シナリオ完了後、ローカルから手動でリリースする(自動 CI/CD は未同梱):

```bash
# 1. CHANGELOG / version を確定(日付入り)
git add CHANGELOG.md package.json
git commit -m "chore(release): v0.13.0"

# 2. タグ付け v{MAJOR}.{MINOR}.{PATCH}
git tag v0.13.0
git push origin main --tags

# 3. デプロイ(ローカルから。= wrangler pages deploy + wrangler deploy)
npm run deploy

# 4. GitHub Release: リポジトリ Releases → Draft a new release で
#    タグ v0.13.0 を選び、CHANGELOG の該当節を本文へ貼って公開
```

> 注: 自動パイプライン(Verify → Deploy → 署名 → Release 自動作成)は本リポジトリに
> **未同梱**。上記の手動手順が正。将来 `.github/workflows/` を追加する際は別途 ADR を起票する。

## トラブルシューティング

| 症状 | 原因 | 対処 |
|---|---|---|
| POLL でエラー `network` | Worker URL誤り | STEP 3 確認 |
| 要約が出ない | APIキー未設定 / 暗号化失敗 | SETTINGS → STATUS で日次カウント確認 |
| Vault書出失敗 | Permission denied | ブラウザ→Site Settings→File Editing 許可 |
| Share Target 認識されない | manifest登録不完全 | DevTools → Application → Manifest 確認 |
| Lighthouse PWA 100未満 | アイコン or installability | DevTools → Application → Manifest |

## チェックリスト完了後の更新

`G10_RELEASE_CHECKLIST.md` の G10.06 / G10.07 を:
- `CONDITIONAL PASS` / `PENDING` → `PASS` に更新
- Lighthouse スコア記録
- ベータテスト結果記録

すべて PASS 後、v0.1.0 を正式リリース。
