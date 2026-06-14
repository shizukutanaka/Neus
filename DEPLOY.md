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

## STEP 7: ベータテスト 11シナリオ(45分)

PWAインストール環境(Chrome Desktop)+ Android Chrome で実施。

### Desktop (Chrome 121+)

| # | シナリオ | 期待結果 | OK |
|---|---|---|---|
| 1 | 初回起動 → 5ステップオンボーディング | JA/EN選択 → SETTINGS反映 | ☐ |
| 2 | RSS追加 (`https://news.ycombinator.com/rss`) → POLL | HN記事30件取得 | ☐ |
| 3 | BYOK設定(Anthropic Claude Haiku) → POLL → 要約自動生成 | カードに要約表示 | ☐ |
| 4 | 検索バーに「rust」入力 | リアルタイム絞込、match%表示 | ☐ |
| 5 | Vault選択 → VAULTボタン押下 → ノート生成 | `Vault/neus/<uuid>.md` + `YYYY-MM-DD.md` 確認 | ☐ |
| 6 | OPML import(`tests/fixtures/sample.opml`) | 一括登録 | ☐ |
| 7 | BOOKMARKLET → 任意ページで起動 | Share Target経由でEvent作成 | ☐ |
| 8 | PWAインストール(アドレスバー右の `+`) | スタンドアロン起動 | ☐ |
| 10 | DevTools → Network → Offline → 再読込 | キャッシュ表示、POLL disabled | ☐ |
| 11 | パスフレーズ設定 → リロード → Lock画面 → 解錠 | APIキー復号成功、要約動作 | ☐ |

### Android Chrome (PWA)

| # | シナリオ | 期待結果 | OK |
|---|---|---|---|
| 9 | 別アプリ(ブラウザ) → 共有 → Neus を選択 | Share Target経由でEvent作成 | ☐ |

### キーワードルール検証

| # | シナリオ | 期待結果 | OK |
|---|---|---|---|
| 12 | KEYWORDS → WATCH に「rust」追加 → POLL | rust含むEventが score+30 | ☐ |
| 13 | KEYWORDS → BLOCK に「crypto」(action: delete) → POLL | crypto含むEventが保存されない | ☐ |
| 14 | KEYWORDS → REAPPLY TO ALL | 既存Eventにも適用 | ☐ |

### キーボードショートカット検証

| # | キー | 期待動作 | OK |
|---|---|---|---|
| 15 | `j`/`k` | カード移動・ハイライト | ☐ |
| 16 | `s`/`e`/`r`/`v` | スター/アーカイブ/既読/Vault実行 | ☐ |
| 17 | `?` | ショートカット一覧モーダル | ☐ |
| 18 | `g i`/`g s`/`g a` | INBOX/STARRED/ALL移動 | ☐ |

### バックアップ検証

| # | シナリオ | 期待結果 | OK |
|---|---|---|---|
| 19 | STATS → EXPORT JSON | `neus-backup-YYYY-MM-DD.json` 保存 | ☐ |
| 20 | DevTools → IndexedDB全削除 → IMPORT JSON | 全データ復元 | ☐ |

## STEP 8: リリースタグ(2分)

全シナリオ完了後:

```bash
git add CHANGELOG.md
git commit -m "chore(release): v0.1.0"
git tag v0.1.0
git push origin main --tags
```

GitHub Actions が起動し、自動で:
1. Verify (lint + test + check-html)
2. Deploy Worker + Pages
3. Sigstore cosign 署名
4. GitHub Release 作成(署名添付)

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
