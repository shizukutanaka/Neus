# Changelog

All notable changes to Neus.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

## [Unreleased]

### Added
- **実行時に組み立てられるクラス名と定義表の対応をテストで固定(round 77)**: 追加が続いたので逆に**削除の監査**を行った(最良の部品は無い部品)。結果は**ゼロ** — CONFIG 24キー・トップレベル関数101個・CSSクラス186個のいずれにも未使用は無く、**何も削っていない**。ただし素朴な走査は13個を「未使用」と報告する: `.v-open`/`.v-converging`/`.v-answered`/`.v-suspended` は `class="word-verdict v-${verdictOf(w)}"`、`.tier-research` は `class="word-prov-tier tier-${tb.tier}"` として**実行時に組み立てられる**ため、文字列としてはソースのどこにも現れない。つまり「**正しいのに消せるように見える**」状態で、将来「未使用CSSの掃除」を素直に走らせた人が裁決ピルの色分けと出所ティアの強調を気づかずに壊す(しかも見た目だけの破損なのでテストは緑のまま)。`VERDICT_DEFS` のキー集合と `.v-<key>` 規則が**両方向で一致**すること、`.tier-<key>` が実在キーを指すこと(逆方向は設計判断なのであえて課さない)、および合成箇所そのものを固定した。ガードが両方向で実際に落ちることも確認済み / Pinned the runtime-composed CSS class names against their lookup tables, so a future dead-CSS sweep cannot silently delete styling that only looks unused
- **テストヘルパーが配列定数を扱えるようになった(round 76)**: `extractConst` が終端 `]` を見ていなかったため、**`const X=[` で書かれた共有の参照表には一度も使えていなかった**(`VERDICT_DEFS` を取りに行って判明)。round 72 の「`async function` を見つけられなかった」と同型の、道具そのものの盲点。修正により round 76 のテストはスタブではなく**実物の参照表**(`PRIOR_BELIEF_DEFS` / `VERDICT_DEFS`)を使って実物の `WordExporter` を評価している / Taught extractConst about array literals, which it had silently never been able to reach
- **bookmarklet が出す param 名と、app が読む param 名の一致を固定した(round 71)**: round 68 で share target の**受け口**は固定したが**送り出す側**が未検証だった。`share_url` / `share_title` という名前を**両側が独立に持っている**ため、片側だけ改名すればテストは全部緑のまま **bookmarklet だけが黙って動かなくなる**(round 62 の BYOK プロバイダ結合と同型の暗黙の結合)。実際に SOURCES → BOOKMARKLET で生成される `javascript:` URL を取り出し、**その本体を偽の `location`/`document` で実行**して `window.open` の引数を捕まえ、**その URL をそのまま app に食わせる**ところまでを一本の経路として検証する。あわせて手動インストール用の写し `bookmarklet.js` が本体からずれていないことも突き合わせた(ずれると手動で入れた人にだけ壊れたものが渡る。round 66 の OPML ミラーと同じ構図)。さらに `npm run g10` の owner 向けメッセージが「実端末が要るシナリオ」を**手書きで列挙**していて既にずれていた(#2 と #5 は機械化済み)ので、**`DEPLOY.md` STEP 7 の表から導出**するようにした / Pinned that the bookmarklet Neus generates uses the same parameter names ShareTarget reads, and made `npm run g10` derive its owner list from DEPLOY.md instead of repeating it
- **#8(PWAインストール)の判定条件を機械検査し、STEP 7 から「全体が人手」の行を無くした(round 70)**: #8 は「ブラウザ UI そのもの」として丸ごと人手に残していたが、半分しか正しくない — `+` を押すのは人にしかできないものの、**そのボタンが出るかどうか**は Chrome が公開している判定条件を満たすかで決まり、条件は一つ残らず測定できる。secure context / SW が**登録されページを制御している**(登録だけでは満たさない)/ SW が fetch ハンドラを持つ / manifest の name・start_url・display・scope / `short_name` がランチャーに収まる長さ / 192px・512px・maskable のアイコンが**宣言どおりの寸法で実際に復号できる**ことを固定。**`beforeinstallprompt` は使わない** — headless では発火しないことを実測したうえでの判断で、環境の都合で常に落ちるか常にスキップされるテストはどちらも情報を持たないため。あわせて `share_target` が GET で `/` を指すことも固定し、#8 と #9 が同じインストール状態に依存することを明示した / Mechanized the PWA installability criteria Chrome actually checks, leaving only the click itself to a person
- **Vault 書き出しと共有取込も機械化し、STEP 7 の人手を「アプリの外側の確認」だけに縮めた(round 68)**: round 67 で人手に残した5件を見直すと、**シナリオ全体ではなく端の一点だけが人手**というものが混じっていた。**#5/#16v(Vault書出)**は「実ディレクトリ選択が要る」としていたが、人手なのは**ダイアログだけ**で、書き込みそのもの(`getDirectoryHandle`/`getFileHandle`/`createWritable`)は全面的に Neus の性質。OPFS は**同じ `FileSystemDirectoryHandle` を返す**ので `showDirectoryPicker` だけ差し替えれば `VaultWriter` は**実物のまま実 File System Access API で**動く — ノート生成・**ローカル日付**の日次ノート追記・2回目が上書きでなく追記(ヘッダは1回)・中止時に1バイトも書かないことを固定。**#7/#9(Bookmarklet/Android共有)**は `share_target` が **method GET** なので、OS 共有シートも bookmarklet も最終的には `/?share_url=…` を開くだけ — URL抽出(`share_text` 埋め込み含む)・トラッキング除去・`javascript:` 拒否・URLなし共有で何も作らない・`history.replaceState` により**再読込で二重取込しない**ことを固定。人手に残るのは「OS の共有シートに Neus が出るか」だけで、これは実質 #8(インストール状態)の裏返し。あわせて人手件数のガードを「`人手` の行数」から「**`人手` + `一部CI` の行数**」に変更(`人手` だけ数えると利用者に求める作業を過少申告する)/ Mechanized Vault export and share-target intake by stubbing only the OS dialog and the OS share sheet; what STEP 7 still asks of a person is now confirmation of things outside the app
- **G10.07 の「人手が要る」リストを検算し、リリース前ベータの人手作業を 12 → 5 シナリオに縮めた(round 67)**: これまでのラウンドは実装の欠陥を探していたが、リリースを止めているのは実装ではなく**ベータ確認の人手作業**だったため、対象を要件そのものに移した。round 47 の分解((a)フロー動作 /(b)クラッシュゼロ /(c)主観評価)は正しかったが、**除外リストを検算していなかった** — 「#2 RSS取得は外部ネットワークが要る」は誤りで、確かめたいのは Neus の取得→解析→重複排除→保存の経路であって HN の到達性ではない(後者は Neus の性質ではない)。`page.route` で proxy 応答だけを差し替えれば**実装の経路はそのまま**動く。キーボード(#15〜#18)とバックアップ往復(#19/#20)に至っては外部依存がゼロで、除外理由が存在しないのに人手扱いのままだった(単なる見落とし)。これらを機械化し、あわせて**確認ダイアログを拒否したら何も書かれないこと**と、他アプリの JSON や `timestamp` が数値でない JSON が**既存データを消す前に**弾かれることも固定した(復元はロールバック不能なのでこの順序自体が安全性の要)。人手のまま残るのは実ディレクトリ選択・OS統合・ブラウザUI(#5/#7/#8/#9/#16v)と**主観評価**のみ。`DEPLOY.md` STEP 7 に「自動」列を足し、見出しの件数は `tests/docs-no-frozen-counts.test.mjs` が表と突き合わせる(このガードは初回実行で筆者の書き間違いを実際に検出した)/ Re-derived which G10.07 beta scenarios truly need a human, mechanizing RSS polling, keyboard shortcuts and the backup round-trip; the owner's manual pass drops from 12 scenarios to 5 plus the subjective rating
- **OPML の手写しミラーを削除し、実ソース spec と旧名ガードに置き換えた(round 66)**: `tests/utils.test.mjs` にあった OPML ミラーは実装と2箇所ずれていた — `build()` が**旧プロジェクト名**を出力し、`escapeAttr`/`dateCreated` も欠けていた。**それでもテストは緑だった**(ミラーは自分自身としか照合されないため)。round 60 でヘルパーを入れた理由がそのまま実例として出た形なので、ミラーとその 6 件を削除し、index.html の実物を実 Chromium で評価する spec 17 件へ置き換えた(仕様準拠・小文字属性・XXE・billion laughs・不正 XML・フォルダ入れ子・`javascript:` URL の取込側フィルタ・build↔parse 往復)。差し引きでコード量は減っている。同じ旧名残骸が `tests/setup.mjs` / `_redirects` / ADR 3 件の見出しにも残っていたため一掃し、`tests/no-legacy-name.test.mjs` でリポジトリ全体を機械的に見張るようにした(除外は「除去したこと自体を記録している文書」のみ。CLAUDE.md の「検索置換で残骸残らないよう注意」を人の目視ではなく機械に担わせる) / Replaced the drifted OPML mirror with real-source browser specs and added a repo-wide guard against the old project name
- **書き出しテンプレートの注入耐性をテストで固定(round 65)**: v0.13 の本文テンプレートは利用者が書くが**差し込まれる値はフィード由来**のため、「値の中の `{{summary}}` が再置換されない」ことが成り立たないと配信元が他フィールドを引き出せる。実装は単一パスの `String.replace` でコールバック戻り値を再走査しないため**構造的に安全**で、実測でも注入は成立しなかった(修正不要)。ただし検証が1件も無く、置換を2パスや再帰に「効率化」すると壊れるため、フィード由来4フィールドすべてで固定。あわせて空ブロック脱落・静的ブロック保持・未知プレースホルダの原文保持・null/undefined が `"null"` と出ないことも明示した / Pinned export-template injection resistance (already safe) plus the documented block-dropping semantics
- **BYOK プロバイダ選択肢と `byokDefaults` の暗黙の結合をテストで固定(round 62)**: round 47 のオンボーディング step 1 クラッシュを受けて step 2〜5 を点検し、**追加のクラッシュは無し**(入力取得もハンドラ登録も `?.` で保護済み。修正不要)。ただし step 3 は `CONFIG.byokDefaults[provider].model` と select の値をそのまま添字に使うため、**選択肢に既定の無い値が1つ混ざるだけで初回体験が例外で止まる**。現状は7種が完全一致で問題ないが、v0.13 で qwen/glm/ollama が実際に追加された経緯があり片側だけの追加で壊れる。両 select の全 option に既定があること・両 select が同一集合であること・各既定が model/endpoint を持つこと・**各 endpoint のオリジンが connect-src に含まれること**(既定はあるが CSP に無いと実行時に落ちる。qwen/glm/ollama で実際に起きた欠陥と同型)を検査 / Pinned the implicit coupling between BYOK provider options, byokDefaults, and connect-src so adding a provider on one side alone cannot crash onboarding
- **実装契約テストを追加し、ミラー乖離が無いことを実測(round 61)**: round 60 のヘルパーで「既に古びているミラーは無いか」を実測 — `tokenize`/`fsBigrams`/`jaccard`/`resurfaceWeight`/`capTitle` を実ソースと同一入力で突き合わせ**乖離ゼロ**(文字列アンカーの規律が実際に機能していたことの裏付け。修正不要)。そのうえで、壊れると被害が大きい純粋関数(CJK語分割・近似重複・ReDoSガード・検索演算子)について**ミラーの状態と無関係に実装そのものを固定する**契約スイートを追加。テスト作成中に `tokenize('e-mail parsing')` の期待値を誤って書いたところ**実ソーステストが即座に検出**した(ミラー方式なら同じ誤りを両側に書いて緑になりえた)/ Added real-source contract tests for safety-critical pure functions; measured zero drift in existing mirrors
- **テストが実装のコピーではなく実物を検証できる仕組みを追加(round 60)**: 本セッション中に「ソースを直しただけでテストが赤」が **4回**発生し(round 42/55/56/59)、ミラー方式(関数を手でコピーし文字列アンカーで同期担保)のコストが実測された。より重要な弱点として、**テストしているのはコピーであって実装ではない**ため、アンカーが緩ければミラーが古いまま「緑なのに壊れている」が成立しうる。`tests/helpers/from-source.mjs` を追加し、index.html から**実物の関数本文を抜き出して評価**できるようにした(ミラー不要・実装文字列アンカー不要・リファクタを妨げない)。切り出しは波括弧の数え上げではなく**インデント**で行う(ソース中の `[.*+?^${}()|[\]\\]` のような正規表現リテラルで brace-counting が破綻するため。監査中に実際に踏んだ失敗を固定)。限界も明記: 依存の多い関数や DOM/IDB に触る関数には使えず、既存方式の全面置換ではない(本物の import には `lib/` 切り出し=ADR-0007 再検討が必要) / Added a helper so tests can exercise the REAL functions from index.html instead of hand-copied mirrors
- **`decodeEntities` の安全性を実ブラウザ spec として固定(round 57)**: フィード由来文字列を `textarea.innerHTML` に代入する既知イディオムを精査。「`</textarea>` で RCDATA が途中終了し切り捨てられるのでは」という仮説を立てたが、**jsdom でも実 Chromium でも切り捨ては起きず**スクリプトも実行されず、**仮説は実測で否定**した(修正不要)。ただし安全性は「textarea の中身が RCDATA」「要素が detached」の2点に依存しており検証が無かったため、実ブラウザ spec 8件で固定(`div` への「単純化」で前提が壊れるのを防ぐ)。あわせて系統的スイープを実施し `forEach(async)` / 未 await の `.map(async)` / 投げっぱなし Store 書き込み / 禁止ストレージAPI / 未ガード `JSON.parse` がいずれも**0件**であることを確認 / Pinned decodeEntities safety with real-browser specs after disproving a truncation hypothesis by measurement; systematic sweep found zero async/storage/parse footguns
- **Vault 書き出しのパス安全性をテストで固定(round 51)**: `VaultWriter` は File System Access API で利用者の実ディスクに書き込み、単語ノートのファイル名には**利用者入力**(`word.term`)が入る。監査の結果 `wordSlug` は許容文字のホワイトリスト方式で `/` `\` `.` が全て潰れるため**既に安全**で、13種の敵対的入力(`../../etc/passwd` 等)でもディレクトリ脱出・空名・先頭ドット・長さ超過は発生しなかった。修正は不要だったが**この性質にテストが1件も無かった**ため固定した — スラッグ生成は後から善意で書き換えられやすく、ホワイトリストがブラックリストに変わると静かにパストラバーサルが復活するため。実用語(`機械学習` / `WebGPU 入門`)が潰れないことも同時に固定し、安全側に倒しすぎる回帰も防ぐ / Pinned Vault filename path-traversal safety as an invariant (already safe; previously untested)
- **`npm run g10`: リリースゲートを1コマンドで実行・判定表示(round 49)**: 機械判定できる G10 ゲートを全て実行し判定表を出力する。**人手が要る項目は自動 PASS せず `OWNER` と理由を表示し、未解決がある限り終了コードを非ゼロ**(FAIL=1 / OWNER=2)にする — CI や人が「全部緑」と誤読できないようにするため、数字を良く見せる仕組みは作らない。残作業を散文から再構成させず、コマンド1つが「次に何をすべきか」を答える。実行結果: G10.01–06 PASS(1,514 tests / 脆弱性0 / Performance 99)、G10.07 は OWNER(自動化部分は全て緑、残るのは主観評価)+ ADR-0021 の未決を理由つきで提示 / Added npm run g10: runs every machine-decidable release gate, reports human-owned items as OWNER with reasons, and exits non-zero while anything is unresolved
- **Lighthouse Performance スコアを依存追加なしで実測(round 48、G10.06 を PASS へ)**: 要件が求めているのは「Lighthouse という道具を動かすこと」ではなく「スコアという数値」であり、必要な (1) 計測条件(Slow 4G + CPU 4x + モバイル)と (2) 採点曲線(対数正規 CDF、median/p10 と重み)は**どちらも公開情報**。CDP で条件を再現し公開曲線で採点することで、**devDependency をひとつも増やさず**スコアを算出した(Lighthouse を入れると依存木が膨らみ G10.03 の脆弱性ゼロと綱引きになる)。実測 **Performance = 99**(FCP 544ms→100 / LCP 544ms→100 / TBT 120ms→97 / CLS 0→100)。直接測れない Speed Index(10%)は、単一描画かつ CLS=0 のため FCP≈LCP≈SI と見積もれるが、**保守的に SI=0 と仮定した下限でも 89** と併記し、推定に依存しない形でも結論が成り立つようにした。`tests/browser-lighthouse-score.spec.mjs` で恒常監視 / Measured the Lighthouse Performance score (99) with no new dependency by reproducing its throttling via CDP and applying its published scoring curves
- **Core Web Vitals の実測を追加し G10.06 を CONDITIONAL PASS へ前進(round 46)**: 「Lighthouse Performance 90+」は環境に Lighthouse が無く BLOCKED としていたが、要件の意図(利用者にとって速いか)は依存を増やさず実ブラウザで測れる。Lighthouse スコアの重みの **90% を占める4指標**(TBT 30% / LCP 25% / CLS 25% / FCP 10%)を Chromium で実測する `tests/browser-vitals.spec.mjs` を新設: **FCP 124ms / LCP 124ms / CLS 0.000 / TBT 0ms** で、閾値は web.dev の good 境界をそのまま使用(甘い自作基準を作らない)。**ただし Lighthouse スコアそのものではない**ことを明記 — Lighthouse は Slow 4G + 4x CPU スロットリング下で測るが本実測は localhost・スロットリング無しのため、「90+ 達成」とは主張せず「大半の指標が good 閾値に桁違いの余裕」までを主張する。署名ビルドと throttled 実測、および G10.07(主観評価)は引き続き人間が実施 / Added real Core Web Vitals measurement in Chromium, advancing G10.06 to CONDITIONAL PASS with its limits stated rather than claiming a Lighthouse score
- **未参照の DICT キー18件(36文字列)を削除(round 43)**: マスク式5段階アルゴリズムを適用し、追加ではなく**まず削除**した。存在しないUI向けの文字列15件と `nav.*` 3件を除去。`nav.*` は applyI18N の navMap が `dataset.view.toUpperCase()` にフォールバックするため**両言語とも大文字英語**で描画され、DICT に入れても決して表示されない=何も生まない要件だった(round 32 で筆者自身が `nav.resurface` を必要性の検証なく追加していたのも訂正)。削除前に `t(`onboard.${key}.title`)` のような動的キーを検証し、live な10キーを誤削除せずに済んだ。あわせて「DICT のキーは必ず消費される/必ず両言語に存在する」を固定するガードテストを追加(自動化は削除の**後**に置く — あるべきでない物の維持を自動化しないため)。DICT 139 → 121キー / Deleted 18 unreferenced DICT keys and added a guard so the waste cannot regrow
- **検索演算子 `"完全一致"` / `-除外` を追加(N-gram の語順欠落を補正、round 41)**: `doSearch` は入力を素通しで `FTSIndex.search` に渡していたが、FTSIndex は文字N-gram索引で**語順を保持しない**ため、日本語では構成文字が同じ別語が閾値を超えて返っていた。実測(ftsScoreMin=0.4): クエリ「情報検索」に対し**「検索情報のまとめ」が score=0.489 で返る**(意味の異なる語)。N-gram索引は本質的に「取りこぼしの無い候補生成器」なので、IR の定石どおり**候補生成(索引)→ 検証(実テキストで literal 照合)**の2段構成にした。記法は関連ソフト(Feedly / Inoreader / Obsidian / Gmail / GitHub)でほぼ共通の `"完全一致"` と `-除外` に合わせ学習コストを増やさない。**演算子が無ければ完全に従来動作**(検証は即 true を返し追加 fetch も走らない)。打鍵途中の未閉じ引用符は演算子扱いせず(`"machine learn` で結果が消えない)、語中ハイフン(`e-mail`)も除外にしない。単語ヒットも同じ検証を通す。転置インデックス化(メモリ増・ADR-0007 の簡潔性に反する)と描画時のみ検証(件数バッジが食い違う)は却下 / Added "exact phrase" and -exclude search operators, recovering the word-order precision that a character n-gram index inherently loses

### Fixed
- **別タブがDBを握っていると画面が空のまま永久に待ち、原因も分からなかった(round 81)**: `indexedDB.open()` の終わり方は success / error の2つではなく **`blocked` を含む3つ**。別タブが古い版の接続を握ったまま新しいタブが版を上げようとすると `blocked` が発火し、success も error も来ない。拾っていなかったため **Promise は永久に未解決**で、実測では**通知なし・モーダルなし・本文は空**のまま。タブを2つ開くのは日常的で、しかもこれは PWA である。直し方は**報告ではなく消去**を選び、接続を持つ側に `onversionchange` を付けて自分から手放させた(相手の `blocked` がひとりでに解ける)。`onblocked` の通知は相手が古いビルドだったときの保険として残し、**reject しない** — 相手が閉じれば open は続行するため / Fixed a blocked IndexedDB open leaving the app blank forever with no explanation
- **保存領域が使えないだけなのに、全データ削除への同意を求めていた(round 81)**: open 失敗時、原因を分けずに常に「データを削除して再生成しますか?」と訊いていた。しかしプライベートウィンドウ・サイトデータのブロック・権限拒否では**削除しても直らない**(実測: 承諾 → `deleteDatabase` → 再 open → 同じ失敗)。**何の役にも立たない全データ消去に同意させていた**ことになり、後で設定を戻したときに戻るはずだったデータは既に無い。破壊的な手当ては効きうる原因に限るようにし(`isRecreatable`)、判定は**許可リスト**方式にした — 誤った側に倒しても失うのは修復の選択肢だけで、逆に倒すとデータが消えるため。あわせて、原因を特定して出した通知が上流の総称メッセージ(`初期化に失敗しました: …`)に**上書きされていた**問題も修正(通知は1つしか出せず後勝ちなので、役に立たない方が残っていた) / Stopped offering to delete all data for failures that deleting cannot fix, and stopped a generic message from overwriting the specific one
- **保存に失敗しても「取得しました」と表示し、黙ってデータを捨てていた(round 80)**: ローカルファースト製品として最も避けたい失敗の形。実 Chromium で events ストアへの `put` を `QuotaExceededError` で失敗させた実測 — **保存 2/6 件、利用者が見た通知は `fetched 6 item(s)`、手がかりは console のみ**。ディスクが本当に一杯なら全件が消え、それでも成功と表示される。さらに安全網の `StorageGuard` が `event.stored`(**成功**)にしか繋がっておらず、**書き込みが全滅している間は容量点検が一度も走らない**という逆立ちした配線だった。(1) 保存失敗を取り込み失敗と区別(`isStorageError` — 名前に実装差があるので `QuotaExceededError`/`UnknownError` と文言の両方を見る)、(2) 空き容量の確認と Vault 書き出しという**次の行動**を含む通知を出す(「何か問題が発生しました」では利用者の端末側は直せない)、(3) **失敗時にも `StorageGuard` を走らせる**。あわせて保存失敗を `inbound.error` として数えるのをやめた — `SourceFailTracker` が**ディスクが一杯なだけで健全なフィードを自動無効化**してしまうため。通知は1バーストにつき1回に畳む(既定60秒) / Fixed the app reporting a successful fetch while silently discarding events it could not store, and wired the storage guard to run on failure instead of only on success
- **WORDS 一覧の並べ替えキーを比較のたびに計算し直していた(round 79)**: ファイル全体で**比較関数の中で関数を呼んでいるのは1箇所だけ**で、それが `renderWords` の `sort((a,b)=>_wSortVal(a)-_wSortVal(b))` だった。`_wSortVal` の `new` 分岐は**キー1つにつき全イベントを走査**するため、同じ単語が何度も評価され、**回数は V8 のソート実装と入力順に依存**していた。実測: 5,000件×30語で **128回 → 30回**、20.9ms → 4.1ms。1,000件×10語で 18→10、2.4ms→0.5ms。既定の並びは `date` なのでこの分岐は「新着順」選択時のみだが、同じ答えを計算し直すのは無くせる仕事。教科書どおりの decorate-sort-undecorate で**重複を消した**(足していない)。テストは速度ではなく**並び順**を重点的に固定 — この種のリファクタの本当の危険は遅さではなく順序変化なので、3つの並び順すべてで旧比較関数と同一の ID 列になることを確認した / Fixed the WORDS list recomputing its sort key inside the comparator, which re-scanned every event several times per word
- **一括ドシエ書き出しが単語ごとに全イベントを読み直していた(round 78)**: `downloadAllMd` は単語ごとに `gather(w)` を呼び、`gather` は毎回 `Store.allEvents()` を叩くため、**全イベント走査が単語数だけ繰り返されていた**。実測(実 Chromium・実 IndexedDB): 1,000件×10語で 130ms → 12ms(**10.8倍**)、5,000件×30語で **2,167ms → 103ms(21倍)**。直し方は足すのではなく**分ける** — 絞り込みを純粋関数 `selectFor(all,word)` として独立させ、`gather` はその薄い非同期ラッパにした(単発経路は挙動も費用も不変)。副次的に、書き出し全体が**同一時点のスナップショット**を見るようになり、以前あった「書き出し中に届いたイベントが後半の単語のドシエにだけ現れる」不整合も消えた。round 76 の「書き戻しまでの窓」も同じ比率で縮む / Made the bulk dossier export read the event store once instead of once per word — 21x faster at 5,000 events x 30 words, and every dossier now reflects the same instant
- **書き出し中に保存した問い・判定が、書き出し完了時に消えていた(round 76)**: 系統の最後。`copyMd` / `downloadMd` / `downloadJson` / `toVault` / `downloadAllMd` / `refreshwiki` はいずれも末尾で `word.reviewedAt=Date.now();await Store.putWord(word)` と**レコード全体**を書き戻していた(担当は `reviewedAt` だけなのに)。挟まる待ちは `gather()` の全イベント走査、**クリップボード権限プロンプト**、**ディレクトリ選択ダイアログ**、Wikipedia への往復 — ダイアログ待ちは**原理的に無制限**なので、窓の広さでは round 75 より悪い。実測(旧の末尾): 書き出し中に問いを保存すると `reviewedAt` は正しく記録されるのに**その問いは消える** — 「動いているように見えて中身が欠ける」ため利用者が気づく契機が無い。4箇所へ同じ再読を書き写す代わりに `WordExporter.markReviewed(word)` へ集約した(重複の削除でもある)。**削除時の扱いは `_collectOne` と逆**にした: `reviewedAt`/`wiki` は既存レコードへの**注記**であって収集結果のように「どこかに属するべき」ものではないので、走査中に削除されていたら**書かない**(利用者が消したものを注記のために蘇らせない)。この非対称は意図的なので両方のテストに明記 / Fixed the export paths writing back a stale word record, which erased questions and verdicts saved while an export or dialog was open
- **単語収集の書き戻しが、収集中に保存した問い・判定を消していた(round 75)**: `_collectOne(word)` は渡された `word` を持ったまま Wikipedia と最大8フィードを並列取得し(**秒単位**)、終わってから `Store.putWord(word)` で書き戻す。一方 WORDS 画面のハンドラは**例外なく** `Store.getWord` で**別のコピー**を読んで書き戻すため、収集中の「問いを追加」「判定を保存」「レビュー済み」が消えていた。COLLECT を押してから結果が出るまでの数秒〜十数秒は利用者が他の欄をいじる時間そのもので、当たりやすさが高い。実測(旧コード): 収集中に問いを1件追加すると**収集完了後に消える**。書く直前に読み直し、収集が担当するフィールド(`wiki`/`lastCollectedAt`/`lastFetched`/`lastErrors`)だけを載せるよう修正。呼び出し元のコピーにも反映する — 直後に `renderWordList()` が走るため、忘れると**取得できているのに0件と描画される** / Fixed word collection overwriting questions and verdicts saved while it was running
- **一括処理が入口のスナップショットを書き戻し、走査中の操作を消していた(round 74)**: round 73 と同じ形が**一括処理**にも残っていた — `KeywordRules.reapplyAll`(REAPPLY TO ALL)と単語改名の `word:` タグ差し替えループが、全件を配列に読み込んでから1件ずつ await しつつ**入口のコピー**を書き戻していた。`reapplyAll` はさらに悪く、**INP のために50件ごとに明示的に yield している** — 応答性のためにわざと制御を手放す設計なので、割り込みは「起こりうる」ではなく**起こる前提**。実測(旧コード): 対象2件で1件目の書き込み中に2件目へ星を付けると**その星は消える**。書く直前に読み直すよう修正(判定は不変な値しか見ないのでスナップショットのままでよく、追加コストは変更件数ぶんの get に収まる)。走査中に削除されたレコードを**復活させずに読み飛ばす**ようにもなった(以前は削除済みイベントを書き戻して蘇生させていた)。改名ループも冪等性の要である `indexOf(oldTag)` 判定を新しいコピー側で行う / Fixed bulk sweeps writing back their entry snapshot, which erased stars and other edits made while they ran — and resurrected records deleted mid-sweep
- **要約の書き戻しが、待っている間の星付け・メモ保存を消していた(round 73)**: round 69/72 の「確認 → await → 変更」の親戚で、**「レコードを読む → 長い await → まるごと書き戻す」**型の lost update。要約は LLM 呼び出しなので秒単位かかり、その間カードは画面に出ていて操作できるため、待機中の星付け・既読・アーカイブ・メモ保存は**普通に起こる**。実測: **要約待ちの間に星を付けると星の数が 1 → 0**(要約の書き戻しが消した)/ **RESUMMARIZE 中に SAVE したメモが消滅**。どちらのハンドラも担当は `content.summary` だけなのにレコード全体を書き戻していた。長い await の直後に読み直し、担当フィールドだけを載せるよう修正(`event.tagged` / `#detail-resummarize` / `VaultWriter.exportEvent` / `exportBatch` の4箇所。Vault 側は `ensureWriteAccess` がディレクトリ選択ダイアログを出しうるため待機時間が原理的に無制限)。あわせて `#detail-resummarize` が `currentDetailId` を **await の後に**読んでいた欠陥も修正 — 要約待ちの間に別カードを開かれると**別のイベントを書き、そのモーダルを開き直していた** / Fixed slow summary writes clobbering stars, read state and notes saved while they were in flight, and re-summarize acting on whichever card was open when it finished
- **単語収集の多重起動ガードを跳び越えられ、外部リクエストが丸ごと二重になっていた(round 72)**: round 69 の予算超過と**同じ形**(確認と変更の間に await)が `WordCollector.collectAll` にも残っていた — `busy` を確認したあと `await Store.listWords()` を挟んでから `busy=true` にしていたため、**2つの呼び出しが両方とも門を通れた**。実測: 3語登録で `collectAll()` 2本同時 → 収集 **6回**(正しくは3回)。`collectAll` は POLL / COLLECT ALL のほか**オンライン復帰ハンドラ**(`fetchAll().then(collectAll())`、await されない)と **SW の定期同期**からも呼ばれるので、利用者の操作と無関係な重なりが普通に起きる。被害は「二重に走る」では済まず、単語収集は1語につき Wikipedia / HN / Reddit / arXiv / Qiita / Zenn / はてな / GitHub を叩くため **登録語数 × ソース数の外部リクエストが丸ごと二重**になる(第三者サービスへのレート制限・行儀の問題)。確認の直後に同期で予約し、リスト取得を `try` の中へ移した(単語ゼロの早期 return も `finally` を通るので、以後ずっと収集不能になることはない)。`collectOne` / `RSSPoller.fetchAll` / `addWord` / `VaultMatcher.scan` は同じ穴が無いことを確認し、同じ構造テストで固定 / Fixed WordCollector.collectAll's re-entry guard being jumpable, which doubled every outbound request across all words and sources
- **manifest のアイコンが宣言した寸法で読み込めなかった(round 70)**: `sizes` は 192x192 / 512x512 と宣言しているのに、実際に `<img>` で復号すると **150x150** になる。data URI 内の SVG が `viewBox` だけを持ち **`width` / `height` を持たない**ため、固有寸法を持たない置換要素の CSS 既定値(150x150)で描画されていた(実測: `viewBox` のみ → 150x150、`width`/`height` 付き → 192x192)。宣言と実体が食い違っている状態なので SVG に固有寸法を与えて一致させた。**Chrome のインストール判定がこの不一致を理由に拒否するかは headless では検証できなかったので主張しない** — 主張するのは「192x192 と宣言した画像は 192x192 として読み込めるべきで、いまはそうなった」だけ。#8 のインストール可能条件を機械検査する過程で出た / Fixed manifest icons decoding at 150x150 instead of their declared sizes — the data-URI SVGs had a viewBox but no intrinsic width/height
- **BYOK の日次予算が同時到達で超過し、利用者が指定した上限を超えて課金されえた(round 69)**: `Summarizer.summarize()` は「予算確認 → ベンダ呼び出し → `dailyCount++`」の順で、**加算が応答後**だった。`inbound.fetched` は各アイテムを await せず publish するため、**同時に流れてきた全アイテムが同じ `dailyCount` を読んでから加算する**。実測: **budget=1 の設定で3件同時取得 → ベンダ呼び出し3回**。フィード1回で30件なら budget 5 でも30回呼ばれうる。これは「要約が出ない」より重い — **予算は利用者の実費の上限**であり、超過は財布に直接効く。枠を**呼び出しの前に**確保するよう変更(確認と加算の間に await が無い同期ブロックなので、他のイベントが割り込めない)。失敗時は枠を返す(要約が得られていない以上、一時的な障害で枠だけ減るのは筋が通らない)。#3 を機械化する過程で出た欠陥で、テストが無ければ気づけなかった / Fixed the BYOK daily budget being exceeded when items arrive together — the slot is now reserved before the vendor call, and refunded if the call fails
- **HTML パーサを通った OPML が無言で0件になっていた(round 66)**: OPML 取り込みは「利用者が選んだ任意の XML ファイル」という数少ない外部入力境界だが実ブラウザでの検証が1件も無かったため、実 Chromium で総当たりに測った。XML の属性名は大小を区別するのに対し **HTML パーサは属性名を ASCII 小文字化する**ため、OPML を一度でも HTML として通した道具(cheerio / jsdom / BeautifulSoup の HTML モード、`text/html` で配信されたファイル等)を経ると `xmlUrl` は `xmlurl` に書き換わる — この経路は憶測ではなく実測で再現した。修正前は `outline[xmlUrl]` セレクタが1件も拾わず、**ファイルにはソースがあるのに「OPMLにソースがありません」という誤った診断**が出ていた。`opmlAttr()` を追加し、仕様どおりの綴りを先に試したうえで見つからなければ大小無視で走査する(準拠ファイルはフォールバックの費用を払わない)。セレクタも `outline` + 属性判定に変えて分岐が1つ減った。あわせて XXE・billion laughs(10^9)・不正 XML・`javascript:` URL・フォルダ入れ子を実測し**いずれも安全**であることを確認 — 特に billion laughs は Chromium(libxml2)側の実体展開上限(30,000〜300,000 文字の間)が先に効いて 11ms で弾かれるため、**自前ガードは測って不要と判断し追加しなかった** / Fixed OPML import silently yielding zero sources for files whose attribute names were lowercased by an HTML parser; measured XXE / billion-laughs / javascript-URL handling as already safe and added no redundant guard
- **`normalizeSlugInput` を全域関数化し、暗黙の前提への依存を除去(round 63)**: トピック型フィードのスラッグ生成で `decodeURIComponent` が不正な % シーケンスに URIError を投げる点を疑ったが、**実測では crash path 無し**(唯一の呼び出し元が必ず `encodeURIComponent` してから渡すため `100% pure` → `100%25%20pure` と復号可能。仮説は誤りで修正すべきバグは無かった)。ただしその安全性は**文書化されていない暗黙の前提**に依存し、破れると被害が大きい — `feed.build(q,…)` は try/catch の外かつ `fetchFeed` は `Promise.all` の中なので、**その単語の収集全体が失敗し Wikipedia の結果まで巻き添えで捨てられる**。前提を守り続けるより頼らせない方が安いため1行の try/catch で全域化(往復自体は検索型/トピック型の両用途を満たすため削れない)。あわせて round 60 の `extractConst` が複数行宣言を扱えない欠陥を、実際に詰まったことで発見・修正 / Made normalizeSlugInput total so it cannot throw, removing reliance on an undocumented caller precondition
- **単語改名が途中失敗すると回復不能な部分適用を残しえた(round 59)**: 改名は「全イベントの `word:` タグ差し替え」→「単語レコード保存」の順で行うが `Store.putEvent` は1件ずつのため単一トランザクションに収まらず、しかも **`try`/`catch` が無かった**。途中で失敗すると一部イベントだけ新タグへ移行し、単語レコードは旧 `normalized` のまま、**メモリ上の word は変異済み**で画面と IDB が食い違い、`btn.disabled` のままで**再実行もできなかった**。全体を try/catch で包み、失敗時に**メモリ上の word を元へ戻す**ことで IDB と一致させ、再実行で `renameWordPlan` が同じ改名を再計画できるようにした。差し替えループは `indexOf(oldTag)` 判定なので適用済みは読み飛ばされ、**再実行で収束する(冪等)**。単語保存を最後に置く順序がこの回復性の前提であることをテストで固定(先に保存すると再実行が noop になり旧タグのイベントを永久に修復できない) / Made word rename failure-safe and idempotent; a mid-way IDB error previously left partial retags with no way to retry
- **監査台帳の記述が実装と食い違っており、誤った前提での「修正」を招きかねなかった(round 58)**: `docs/FEATURE-AUDIT.md` の `normalizeUrl` エントリは「ホスト大文字小文字を正規化していない」と記録していたが、実測すると `new URL().toString()` が**既にホストを小文字化**しており `https://Example.com/a` と `https://example.com/a` は現状でも dedup される。同エントリには「正規化の変更は既存イベントとのハッシュ不一致(一時的な重複窓)を生む」という警告が付いているため、誤った前提で着手すると**利得ゼロでそのリスクだけを踏む**ことになる。台帳を実測に基づき訂正し、末尾スラッシュ(`/a/` と `/a` は仕様上別リソース=同一視は誤統合の危険)は「不足」でなく設計判断である旨も明記。真の残件は追加トラッカー(`ref` 等)のみ。実挙動を `tests/normalize-url.test.mjs` で固定(コード変更なし) / Corrected an audit-ledger claim that contradicted the implementation, which would have led a future session to take a hash-mismatch risk for zero benefit
- **YAML エスケープが復帰(CR)と制御文字を逃していた(round 56)**: `yamlScalar` はバックスラッシュ・二重引用符・改行(LF)のみ逃がしており、**CR と C0 制御文字が素通り**していた。YAML は CR も改行として扱うため二重引用符スカラーが行をまたぎ、さらに **NUL は YAML ストリームに生で置けない**ため準拠パーサは**文書全体を拒否**する。ここへ流れるのは `source.name`/`tags`/`title` = **フィード由来の文字列**なので、壊れたフィード1件で利用者の Vault ノートの frontmatter が Obsidian/Dataview から読めなくなる(round 55 の NaN と同系統)。CR をエスケープし C0 制御文字と DEL を `\xNN` へ変換。タブは二重引用符スカラー内で合法なのでそのまま通し過剰エスケープを避けた / Escaped carriage returns and C0 control characters in YAML frontmatter, which a malformed feed could otherwise use to make a Vault note unparseable
- **「検証しているように見えて検証していない」ガードで NaN スコアが Vault を壊せた(round 55)**: `engagementScore` のガードは `(n||0)` のみで、`'abc'`/`{}` は **NaN**、`-1` は **-Infinity** を返した(`likes_count` は Qiita API 由来 = 第三者が形を決める値で、Hatena 経路と違い無ガードだった)。さらに下流の `typeof raw.score==='number'` は **`typeof NaN === 'number'` が true** のため NaN を素通しさせ、`meta.score` として永続化していた。保存された NaN は Vault の YAML frontmatter に `score: NaN` として出力され、YAML 標準表記(`.nan`)でないため Obsidian/Dataview が frontmatter を読めなくなる = **第三者データが利用者の Vault メタデータを壊せる経路**。数値化不能/負の信号を中立 50 に倒し、下流ガードを `Number.isFinite` に置換。18種の入力で有限値[50,75]に収まることを確認 / Fixed a guard that looked like validation but let NaN through (typeof NaN === number), which persisted NaN scores and emitted invalid YAML into the Vault
- **週次トレンドが暦日ではなく経過24時間で割っていた(round 54)**: ダイジェストの7日トレンドが `Math.floor((Date.now()-ev.timestamp)/86400000)` でバケットしており、区切りが現在時刻に張り付いて暦日と一致しなかった。実測(月曜10:00に閲覧)で**日曜23:00の記事が「今日」として計上**され、毎晩の活動が翌日へずれていた。さらに境界が閲覧時刻で動くため、同じ日の22:00と23:30で同じ記事が別の棒に入る。直近7日のローカル暦日から Map を作り `localDateKey` で引く方式に変更(`setDate` 減算は月・年またぎと DST を正しく処理)。round 50 で追加した helper を再利用し日付解釈を二系統に増やさない。round 50 の際に隣接する同種コードを見落としていた分の回収 / Fixed the 7-day trend bucketing by elapsed 24h instead of calendar days, which charted last night as today
- **見出しだけ長さ無制限で FTS 索引を膨張させられた(round 53)**: `snippet`/`summary` は取り込み時に 500 字へ切っているのに **`title` だけ無制限**で、しかも title は `eventText` 経由で FTSIndex の N-gram 対象に入る。ワーカーはフィード応答を 5MB まで許すため、巨大な `<title>` を1件返すだけで**その1文書が数百万個の bigram**を索引へ流し込め(title 100,000字 → 約99,999 bigram)、索引構築・検索・IndexedDB・描画が一斉に膨張する。内容を決めるのは第三者なので利用者の運用では避けられない。`capTitle()` を追加し取り込み境界3箇所(RSS/Atom・Qiita JSON・共有)で `titleMaxChars`(300)へ切る。なお round 34 の文書長正規化により検索**順位**の支配は既に防げていたが、**索引そのものの膨張**は未対策だった / Capped headline length at ingestion; only title was unbounded and it feeds the n-gram index, so one oversized feed title could flood it
- **バックアップ復元の事前検証が型を見ておらず、壊れたデータで上書きできた(round 52)**: 復元は既存データを全消去してから書き込むため検証は「消す前」に置かれているのに、`validEvent` は truthy 判定しかしておらず **`timestamp` を一切検査していなかった**。実測で `timestamp:'2020-01-01'` / `null` / 欠落 / `{}` が全て受理され、`content` に文字列を入れても通った(`!"abc"` は false)。`timestamp` は全ビューの並び順・ダイジェストの24時間窓・再浮上スコアを支えるため、非数値だと比較が NaN になり並びが不定化し、**復元後は元データが無いので戻せない**。実オブジェクト判定 `isObj()` と `timestamp` の有限数チェック、`publishedAt`/`createdAt`/`title` の型チェックを追加。正規経路のイベントは必ず `timestamp` を持つため既存バックアップは通り、`title` は「存在すれば文字列」に留めて厳しすぎる回帰も避けた / Fixed backup restore accepting malformed records (notably any non-numeric timestamp) despite validating before the irreversible clear
- **「その人の1日」が UTC 基準で、Obsidian Daily Note が誤ファイリングされていた(round 50)**: カレンダー日付を作る箇所が `new Date().toISOString().slice(0,10)`(**UTC 基準**)を使っており、UTC+9 の利用者では **00:00–09:00 の間ずっと前日**になっていた。最も深刻なのは `appendDaily` で、**朝に書き出したノートが前日のデイリーノートに紛れ込む**(Daily Note は日付で辿る前提のため看板連携が静かに壊れる)。BYOK の1日あたり予算も現地 09:00 にリセットされ、利用者の1日と一致しないまま**自腹の API 課金**に影響していた。`localDateKey()` を追加し人間向けの日付8箇所を置換。**YAML frontmatter の `published_at`/`ingested_at` は UTC の完全 ISO のまま維持**(ローカル日付にすると他ツールが Vault を読むとき曖昧になるため)= 「人が見る日付はローカル、機械が読む時刻は UTC」の使い分けをテストで固定。`TZ=Asia/Tokyo` でも検証済み / Fixed calendar days being derived in UTC, which misfiled Obsidian daily notes and reset the BYOK spend budget at 09:00 local for UTC+9 users
- **オンボーディング初回画面で言語を選ぶとクラッシュしていた(round 47)**: step 1 のフッターは `footer.innerHTML=next` で next ボタンしか描画しないのに、言語クリックのハンドラが `$('#ob-skip').textContent=...` を実行しており、**新規利用者が最初に見る画面**で `TypeError: Cannot set properties of null` が送出され、NEXT ボタンのラベルが旧言語のまま残っていた。`render()` が既に全ラベルを適用するため、重複していたラベル設定を削除して解消(ガードで覆わず重複を消す)。G10.07 のベータシナリオを自動化した結果として発見された / Fixed a crash when choosing a language on the first onboarding screen, found by automating the beta scenarios
- **ブラウザ spec 5件の恒常的失敗を修正(round 47)**: SWキャッシュ検査2件は `caches.keys()` の `names[0]` を shell キャッシュと決め打ちしていたが、後から `neus-prefs-v1` が追加され順序保証も無いため誤判定していた(全キャッシュ走査に修正)。a11y 3件はこの viewport でヘッダーがメニューに畳まれ `#btn-sources` 等が `display:none` の親の中にあることが原因(可視要素のみ測る/メニューを開いてから測る、に修正)。skip-link はヘッドレスで `Tab` が効かないため `.focus()` で直接検証。**83 passed/5 failed → 88 passed/0 failed** / Fixed 5 long-failing browser specs (stale cache-name assumption, collapsed-header layout, headless Tab traversal)
- **文書の「手で同期する数字」を撤去し再陳腐化を機械的に防止(round 45)**: コミット `e534eff` が陳腐化したテスト件数ラベルを一度同期し直した(1,277 → 1,399)が、数ラウンドで実数は 1,510 になり**同じ箇所がまた陳腐化**していた(AUDIT-BRIEF は「現在 §10.20 / round 31」とも記載、実際は §10.33)。同期し直すのは壊れ続ける部品の修理にすぎないため、**数字自体を削除**し値を得るコマンド(`npm test` の出力 / `grep -E '^### 10\.[0-9]+' SPEC.md | tail -1`)に置き換えた。あわせて「日付つきの記録(CHANGELOG / SPEC §10 / G10 実測欄)は数字が正しい、生きた指示(AUDIT-BRIEF / goal.md)には書かない」という線引きを明文化し `tests/docs-no-frozen-counts.test.mjs` で機械検査(歴史的記録を誤って剥がさないよう、対象外であることもテストで固定)。あわせて死にCSS 2件(`.filter-label` / `.filter-value`)を削除 / Removed hand-synced numbers from living docs and guarded against their return, after a previous sync had already gone stale again
- **完了定義(G10)の「カバレジ ≥ 80%」が測定不能だったため測れる要件に置換(round 44)**: `npx vitest run --coverage` の実測は **0/0(計測対象ゼロ)**。本体ロジックが index.html のインライン ES モジュールにあり vitest から import できないため(ADR-0007)、v8 が計装できるファイルが存在しない(`vitest.config.js` 自身も「Coverage threshold intentionally not enforced」と明記)。正直に運用すれば永久に未達、ゲートを通すには嘘をつくしかない要件だった。同じ意図を実測できる**モジュール網羅率**(index.html のトップレベルモジュールがテストから参照されているか)へ置換し、実測 20/21 の唯一の欠落 `InstallPromo` を埋めて **21/21 (100%)** に到達、比率をテストで固定。あわせて G10 の全7項目を実際に走らせ、G10.01–05 を実測 PASS として記録。**G10.06(Lighthouse)/ G10.07(ベータ主観評価)は人間の実機確認が要件そのものなので BLOCKED のまま残した**(代行すれば虚偽記録になるため) / Replaced an unmeasurable release gate (coverage >= 80%, actually 0/0) with a measurable module-coverage metric now at 21/21, and recorded real PASS/BLOCKED results for all seven G10 items
- **KEYWORDS モーダルが英語利用者に日本語で表示されていた(round 43)**: DICT に JA/EN 両方が揃っていたのに `applyI18N` へ配線されておらず、`kw-hint` / `hd-kw-watch` / `hd-kw-block` / `kw-adv-hint` などが HTML 直書きの日本語を描画していた。CLAUDE.md「UI は i18n で JA/EN 両対応」の明示的な違反。9箇所を配線して充足 / Fixed the KEYWORDS modal rendering hardcoded Japanese to English users despite complete JA/EN strings already existing in DICT
- **配信元が申告する未来日付でランキングを占有できた(round 42)**: `publishedAt` は第三者(配信元)が値を決められるのに `Date.parse()` の結果を上限チェック無しで保存していた(RSS/Atom・Qiita JSON の2経路)。一方 DIGEST の鮮度加点は `Math.max(0, now-publishedAt)` を使うため未来日付は age=0 に clamp され**常に最大点**を取り続け、タグ/単語ビューは `(publishedAt||timestamp)` 降順なので**恒久的に先頭**になる。実測: 1年後の日付を申告した項目が recency 加点 25.0(直前公開の正当な項目と同点=最大)を維持し、並び順でも先頭を占め続けた。配信側が日付を未来にするだけで利用者のダイジェスト上位を占有できる(RSS の既知スパム手法。時計ずれの誤設定でも同じ事故)。パース境界に `sanePublishedAt` を導入し、時計ずれ許容(1時間)を超える未来日付・NaN・非数を **undefined(不明)** として扱う。**`now` に clamp しない**のは publishedAt 非捏造規約に従うため — 公開日時が不明なら値を作らず消費側の `||timestamp`(取得時刻)へ委ねる / Fixed feed-declared future dates capturing the top of the digest and list views permanently; out-of-tolerance dates are now treated as unknown rather than trusted or fabricated
- **PBKDF2 反復回数が OWASP 推奨の半分(ADR-0021 として提案、未実装)**: `CONFIG.pbkdf2Iterations` は 300,000 だが、[OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) の現行推奨は PBKDF2-HMAC-SHA256 で 600,000。ただし**単純な定数変更は既存の暗号化済み BYOK API キーを復号不能にする**(反復回数は鍵導出の入力のため別の鍵が導出される)。さらに unlock 処理は復号例外を「パスフレーズが違います」と表示するため、正しいパスフレーズなのに永久に拒否され続ける原因究明困難な壊れ方をする。CLAUDE.md「重要分岐」のマスターパスフレーズ暗号化方式変更に該当するため**実装せず** `docs/adr/ADR-0021` を Proposed として起票(推奨案: 暗号文にパラメータを埋め込む版付き形式で旧データは旧反復回数で復号し次回保存時に遅延移行=後方互換・再入力不要)。あわせて監査で確認した良い点を記録: Service Worker は cross-origin を一切 intercept しないため BYOK 通信も Worker プロキシ応答(URL に検索語を含む)も Cache API に入らない / AES-GCM の IV は毎回乱数生成で再利用なし・導出鍵は extractable=false・復号失敗は fail-closed / Reported (not implemented) that PBKDF2 iterations are half the current OWASP recommendation; raising the constant naively would make existing encrypted API keys undecryptable while showing a misleading "wrong passphrase" error, so it is filed as ADR-0021 pending approval
- **KeywordRules の正規表現ルールが ReDoS でタブを恒久的に固められた(round 39)**: `matchRule` の regex モードは `new RegExp(...)` を try/catch で囲っていたが、catch が捕まえるのは**コンパイルエラーだけ**で実行時の破滅的バックトラッキングは捕まえられない。ルールはユーザーが書くが、照合対象 `getEventText(ev,'all')` は title+snippet+summary を連結した**フィード由来**のテキスト(=第三者が中身と長さを決められる)で、`evaluate()` は ingest ごとにメインスレッドで同期実行される。結果、うっかり書いた正規表現1つで POLL のたびにタブが恒久的に固まった(リロード以外に復帰不能)。実測: `^(\w+\s?)+$` は入力22文字=28.9ms / 24文字=116ms / 26文字=449ms と2文字ごとに約2倍(指数)で、数百〜数千文字の snippet では事実上無限。JS ではメインスレッド上で任意の正規表現を中断できないため**完全防御ではなく緩和**として3層で対処: (1)量化グループ内に無制限量化子がある危険形を保存時に検出・拒否し理由を提示(黙って無効化すると「ルールが静かに効かない」原因不明状態になるため)、(2)バックアップ復元や旧版由来のルール向けに実行時も同判定で fail-closed(評価不能なルールで block/delete が誤発火しない)、(3)`regexScanMaxChars`(4000)で走査長を打ち切り(regex モードのみ。線形で安全な contains 等の意味論は不変)。検出器は外側が無制限量化(`+`/`*`/`{n,}`)のグループのみ対象とし `{n}`/`{n,m}` は安全扱い。誤検知の実害が大きいため危険6種・安全9種の計15種で分類を検証済み。Web Worker + terminate() は唯一の真の中断手段だが CSP worker-src 変更と同期パスの非同期化を伴い過大として却下 / Fixed a ReDoS in user-defined keyword regex rules that could permanently freeze the tab on every poll, since the try/catch only caught compile errors while the scanned text is feed-controlled; mitigated by save-time rejection, fail-closed runtime guard, and a regex-only scan-length cap
- **BYOK の追加プロバイダ (Qwen / GLM / Ollama) が CSP に阻まれて到達不能だった**: v0.13.0 で `CONFIG.byokDefaults` に qwen (`dashscope.aliyuncs.com`) / glm (`open.bigmodel.cn`) / ollama (`localhost:11434`) を追加したが、CSP を生成する `scripts/compute-csp-hash.mjs` の `connect-src` は当初3プロバイダぶんがハードコードされたままで更新されていなかった。結果 `_headers` と index.html の meta CSP の双方が新プロバイダのオリジンを許可せず、要約リクエストはブラウザにブロックされる(テストは fetch をモックするため素通りし、release ゲートも緑のままだった)。`connect-src` を index.html の `endpoint:` 宣言から**導出**する方式に変更し、プロバイダを足せば許可オリジンが自動追従するようにした(1件も抽出できなければ CSP を狭めずエラー終了)。回帰テスト `tests/csp-connect-src.test.mjs` を追加 / Fixed CSP connect-src silently blocking the Qwen/GLM/Ollama BYOK providers by deriving the directive from the declared endpoints instead of a hard-coded list
- **検証ゲート・文書のテスト件数ラベルが実数と乖離(陳腐化)**: `scripts/release.mjs` のゲート表示が「HTML integrity (52 checks)」「Vitest (148 tests)」、`vitest.config.js` のコメントが「33-point」、`goal.md`/`G10_RELEASE_CHECKLIST.md`/`docs/reviews/AUDIT-BRIEF.md` が「1,277 tests」と固定されていたが、実際のスイートは **1,399 tests / 83 HTML checks** に成長していた。ゲートの件数表示は「実数と合致しないと壊れを検知できる」という役割を持つため、乖離はテスト脱落をマスクする盲点になる。全ラベルを現在の実数(1,399 / 83 / 1,399)に更新。CHANGELOG の過去エントリ(148・1,277等)は当時点の正しい記録のためそのまま。 / Fixed stale test-count labels in the release gate and docs that no longer matched the real suite (now 1,399 tests / 83 HTML checks), so a dropped test would not silently look green
- **実ブラウザ axe 監査で検出された2件の a11y 違反(モックされた vitest axe テストは見逃していた)**: 本番コードの実行は Playwright の `browser-axe.spec.mjs` のみが担い、vitest の `axe-a11y.test.mjs` は axe-core をモックするため本物のコントラスト/ランドマーク計算を通らない。`tests/browser-axe.spec.mjs`(実ブラウザ)で走査すると2件が検出された。(1) color-contrast(serious): 空状態アイコン `.empty .icon` が `--fg-3`(#838b96)を `opacity:.4` で描画し実効コントラスト 1.83(期待≥3:1)。アイコンを `--fg-2`(#9da7b3) へ変更し `opacity:.6` にして実効 ~4.4:1 に。(2) region(moderate): 初回オンボーディングオーバーレイの内容がランドマーク外にあった。`#onboarding` に `role="dialog" aria-modal="true" aria-label` を付与して dialog ランドマーク内に収めた。修正後は実ブラウザ axe が 0 violation(2件の gate テスト含む browser-axe.spec 全項目はこの環境の file:// 制約で onboarding/overflow が隠れるため一部不安定だが、axe 本体格は 0)。 / Fixed two real-browser axe violations (color-contrast on empty-state icon; onboarding content outside a landmark) that the mocked vitest axe test could not catch

## [v0.13.0] - 2026-08-11

### Changed
- **暗黙の興味学習の「抑制」を昇格より弱くした(非対称化、round 35)**: `InterestProfile` は star/archive から学習した語彙の極性で `meta.score` を最大 ±25 補正していたが、**抑制側が昇格側と同じ強さ**だった。これは推薦研究がフィルターバブル/エコーチェンバーとして報告する構造(personalization が関連性を優先して多様性を犠牲にし確証バイアスを強化する)そのもので、**反証条件を能動監視する Falsifier Watch を看板に据える本プロダクトの設計思想と自己矛盾**していた。しかも補正は ingest 時に score へ焼き込まれ永続する(語彙は減衰するが沈められたイベントは戻らない)。損失が非対称であること — 誤って持ち上げれば読み飛ばすだけ(可逆・可視)だが、誤って沈めればそもそも出会わない(不可逆・不可視) — を根拠に、`interestPenaltyMax`(=10)を新設して抑制側の上限のみ絞った。学習の符号は保たれるため「嫌いなものが下がる」挙動は失われない。明示的な抑制は従来どおり KeywordRules の block(ユーザーが書き・見え・編集できる)が担う / Made implicit interest-learning suppression weaker than promotion (asymmetric cap), so learned dislikes can no longer bury dissenting items as hard as the app's own falsifier-driven design fights confirmation bias

### Fixed
- **日本語コールドスタートのタグ自動推定が漢字を見ていなかった(round 38)**: 学習データが無い時のフォールバック `extractEntities`(`TagLearner.suggest` から呼ばれる)は日本語分岐がカタカナ (`/[ァ-ヴー]{3,}/`) のみで、漢字複合語を一切抽出していなかった。実測で「機械学習のための線形代数」「自然言語処理の最新動向」等が **[]**(空)になり、日本語記事のコールドスタートで autoTags がほぼ空 = タグ由来の検索・フィルタ・興味学習の起点が欠けていた。用語抽出研究(Nakagawa らの複合名詞ベース termhood。日本語技術用語の大半は漢語かカタカナ語)に照らせば漢字複合語こそ主形態で、その半分しか見ていなかった。カタカナ分岐の直後に漢字ラン (`/[一-鿿㐀-䶿]{2,10}/`) 抽出を追加(ひらがな=助詞が自然な区切りになるため複合語境界が出る:「機械学習のための線形代数」→ 機械学習 / 線形代数)。JA_STOP(入門/基礎 等 ~28語)は漢字ラン**全体**との完全一致のみ除外するため「機械学習入門」のような複合語は残る。複合語ほど termhood が高いため長い順に採り、既存の `slice(0,3)` 上限を共有。形態素解析器(ゼロ依存原則違反)と文字bigram(語彙爆発)は却下。英語・カタカナ挙動は不変 / Fixed Japanese cold-start tag suggestion ignoring kanji: extractEntities saw only katakana, so kanji-compound headlines yielded no auto-tags; now extracts kanji runs with a full-match stop-word filter, English/katakana unchanged
- **CJKトークナイザ: 同じ根本原因がタグ推定・興味学習・ノート照合にも波及していた(round 37)**: round 36 で見つけた「日本語見出しが1トークンになる」原因の `tokenize()` は他に4箇所で使われており、**「トークンの重なり」を動作原理とする機能が日本語で軒並み停止していた**。実測(Node計測)で、日本語記事3件で学習したタグモデルと同じタグが付くべき4件目の語の重なりは **0**(英語の同等実験では 3)= **自動タグ推定が完全に不動作**。InterestProfile も本文由来の学習が不動作(タグ経由のみ生存)、VaultMatcher もほぼ不動作だった。形態素解析器はゼロ依存原則で導入できないため、**字種(ひらがな/カタカナ/漢字/その他)の切り替わり**を語境界の近似として使う実装にした(「Rustの所有権とライフタイム入門」→ rust / 所有権 / ライフタイム / 入門)。文字bigramを採らなかったのは1記事あたり約100トークンを生み InterestProfile の語彙上限300を即座に溢れさせ英語の学習まで劣化させるため。**英語は挙動不変**。副次的に近似重複の token 経路も改善し、別記事9組の誤merge0のまま2ペアを新規捕捉(余裕0.3)、round 36 の取りこぼしリストは2件に縮小 / Fixed CJK tokenization at its root: tag suggestion, interest learning, and vault matching were all inert in Japanese because whitespace splitting made each headline one unique token; now segmented on script boundaries with English behaviour unchanged
- **CJK見出しの近似重複検出が機能していなかった(round 36)**: 近似重複は `tokenize()` の語彙jaccardで判定していたが、`tokenize()` は空白分割のため、単語境界に空白の無い日本語では**見出し全体がほぼ1トークン**になり、近い見出しでも jaccard がほとんど 0 になっていた(実測: 「AIの未来について考える」/「AIの未来を考える」= 0.000、「Rustの所有権を理解する」/「…【入門】」= 0.500)。Qiita/Zenn/はてなを日本語ソースに持ちながら、**主要言語でクロスソース重複排除が事実上効いていなかった**。CJKを含む見出しに限り、Falsifier Watch と同じ言語非依存の文字bigram(`fsBigrams`)で再判定するようにした(英語のみの見出しは挙動不変、新しい類似度実装は追加せず既存ヘルパーを再利用)。閾値0.75は実測で決定 — 真の重複0.615〜1.000 / 別記事0.304〜0.563 とクラスが一部重なるため、別記事の最大値から0.188の余裕を取り保守側に倒した(誤mergeは受信イベントを破棄する不可逆・不可視の損失、見逃しは似たカードが2枚並ぶだけの可逆・可視の損失という非対称性による)。サフィックス違いの取りこぼしは意図的なトレードオフとしてテストに明記 / Fixed near-duplicate detection for CJK headlines, which whitespace tokenization could never segment; scoped character-bigram fallback with an empirically chosen, deliberately conservative threshold
- **全文検索の長文バイアスを是正(文書長正規化、round 34)**: スコアが「クエリのIDF質量の被覆率」のみで文書長を考慮していなかったため、長い文書ほど異なりgramを多く持ちクエリのgramを偶然含む確率が上がり、短く的確な文書と同点(ともに1.0)になっていた。IR で古くから知られる長文バイアスで、BM25 が `b` 項を持つのはこの補正のため(`b=0.75` は慣用既定値。BM11=1 は長文を過度に罰し BM15=0 は無補正)。round 33 の関連アイテムが同じ採点式を使うため、放置すると冗長な1件があらゆる記事の「関連」に出現するハブ(雑音)になる実害があった。**採用したのは長文への減点側のみ**で、`dl<=avgdl` では係数がちょうど1.0になり短文ボーナスは付かない — スコアは UI に「match NN%」と表示され 0〜1 と「完全一致=100%」の契約があるため。文書長は異なりgram数なので、同じ語の反復では長くならず、罰されるのは語彙の散漫さのみ。あわせて未使用の `maxScore` マップ(デッドコード)を削除 / Fixed long-document bias in full-text ranking via BM25-style length normalization (penalty side only, preserving the 0..1 match-percent contract); removed dead maxScore map

### Added
- **関連アイテム(連想の小径 / associative trail)**: 第一原理分解(round 32)で唯一「部分的」と残った段階5「接続」への対応(round 33)。Neus は収集も検索も持つが、「いま読んでいる物」から「手元の関連物」へ辿る経路が無く、能動的に検索語を思いつけた時しか繋がらなかった。Vannevar Bush の Memex(1945)が示した**連想の小径** — 分類階層ではなく意味的な近さで辿れること — と Luhmann の Zettelkasten の構造(serendipity に見える発見は意味的関係の網が導いた必然)を参照し、詳細モーダルに意味的に近い手元のアイテムを最大3件提示、クリックでそのまま辿れるようにした。**類似度は新規実装せず `FTSIndex.search` を再利用**(既に BM25 の IDF 概念で重み付け済みで "more like this" にそのまま適する。非対称な `bigramCoverageHits` は不適として不採用)。自分自身 / `word:` ヒット / archived / 同一記事の別URL は除外。**`links[]` へは一切書き込まず描画時に導出するのみ**のため InformationEvent は不変で、`FEATURE-AUDIT` §1-3 の ADR ゲート(links[] の意味論変更)には抵触しない / Related items: derive an associative trail at render time by reusing the IDF-weighted FTS index; nothing is persisted, so the links[] data-model gate stays closed
- **RESURFACE(再浮上)ビュー**: First Principles で過不足を洗い出した結果(round 32)見つかった構造的な穴への回答。情報が知識になるまでの段階(捕捉→取捨→理解→吟味→接続→**想起**→行動)のうち「想起」だけが能動検索依存で、人は「何を忘れたか」を検索できない(想起の逆説)ため `LATER` は入れたきり戻らない箱になっていた。放置された「あとで読む」とスター済み未読を少数だけ再浮上させる。**スコアは素朴な「古い順」ではなく逆U字**: spacing effect の研究(Cepeda et al. 2008 ほか)が示すとおり間隔と効果は単調増加ではないため、早すぎる再提示(復習として無駄)も遅すぎる再提示(陳腐化した情報の押し上げ)も減点する対数正規型の重みを採用。既存 `state`(later/laterAt/starred/read/archived)と `timestamp` のみから導出し**新しい永続フィールドを足さない**(データモデル不変)。決定的(乱数なし)で同点は id 順、描画が揺れない / RESURFACE view: brings back neglected read-later and unread-starred items, weighted by an inverted-U (spacing-effect) curve rather than naive oldest-first, derived purely from existing state

### Added
- **Vault エクスポートのノート本文テンプレート**: 2026-07 の外部調査(PKM エコシステム比較)由来の採用候補。設定画面の VAULT EXPORT 欄にテンプレート文字列を保存すると、イベントノートの本文が `{{title}}` `{{url}}` `{{link}}` `{{source}}` `{{date}}` `{{tags}}` `{{summary}}` `{{snippet}}` `{{note}}` `{{quote}}` のプレースホルダ置換で組み立てられる(Obsidian 側の Vault 規約・Dataview 等に合わせられる)。制御構文は意図的に持たない(ゼロ依存・簡潔原則): 空行区切りのブロック内の既知プレースホルダが全て空ならブロックごと脱落する規則で条件分岐を代替。未知のプレースホルダは打ち間違いが見えるよう原文のまま残す。YAML frontmatter はテンプレート対象外(常に固定+`yamlScalar` エスケープ)で、機械可読キー(neus_id/hash)の欠落や YAML 破壊が起きない。空欄保存で既定形式に戻る / User-customizable note body template for Vault export ({{placeholder}} substitution, empty-block dropping, fixed frontmatter); clear the field to restore the built-in format
- **反証候補 (Falsifier Watch)**: ソクラテス式問答から導いた新機能。システムは探究者に反証条件(「何があれば結論を覆すか」=最も鋭い論駁)を述べさせるのに、述べられた反証条件は受動的なテキストにすぎず、収集し続ける証拠と接続されていなかった — 人に手動確認を促すだけだった。反証条件の文字bigram集合と各収集物の被覆率(言語非依存、CJKも可)で、宣言した反証条件に該当しうるアイテムを能動検出。WORDSビューに `word-fwatch` ブロック(該当アイテム + 一致率)、最優先の `falsifier-seen` 問答プロンプト(具体的該当があれば漠然とした stale 系を抑制)、ドシエの `## 反証候補` セクションを追加。反証条件が「証拠を監視する能動センサー」になる / Falsifier Watch: actively scan collected evidence against the user's stated falsifier and surface possible matches (language-agnostic bigram coverage)

### Fixed
- **Worker: リダイレクト経由のSSRF、および `[::]` のブロック漏れ(round 31)**: `_worker.js` は `/rss`・`/json` の取得先URLを `PRIVATE_HOST_RE` で検証していたが(IPv4射影IPv6の16進正規化対応は既存)、`fetch` が `redirect:'follow'` だったため検証されるのは最初のURLのみで、悪意/侵害されたフィードが検証通過後にリダイレクトで内部アドレスへ誘導できた。`redirect:'manual'` による自前ループ(`fetchValidated`、上限5ホップ)で各ホップを再検証(`/json`はホスト許可リストも再チェック)するよう修正。また `0.0.0.0` 相当の未指定アドレス `[::]` がどのパターンにもマッチしていなかった漏れも `\[::1\]`→`\[::1?\]` で解消。Node実装のURLパーサでの実証テストを経てから実装 / Fixed SSRF-via-redirect (both endpoints now re-validate every redirect hop) and closed an unblocked bare [::] literal
- **SourceFailTracker が自ソフト側の内部エラーまで自動無効化のカウント対象にしていた(round 30、docs/FEATURE-AUDIT.md §1-12)**: `inbound.error` は `network`/`http_*`/`parse`(ソース自体の障害)と `normalize`/`pipeline`(URL正規化・重複排除・キーワード適用などNeus自身の内部処理で起きるエラー、ソースの健全性とは無関係)の両方を運んでいたが、旧実装は種別を区別せず全てカウントしていたため、Neus側の一時的なバグで健全なソースが誤って自動無効化されうる状態だった。`isSourceFault(error)` でソース起因のエラーのみに絞り込んだ / SourceFailTracker no longer counts Neus's own internal pipeline errors toward a source's auto-disable threshold
- **i18nの系統的不統一を解消(round 29、docs/FEATURE-AUDIT.md §1-12)**: `toast()` 約25箇所の単一言語(英語のみ/日本語のみ、成功/失敗で言語が食い違う組も含む)を `currentLang==='ja'?...:...` パターンへ統一。`#kw-sheet`(長押し/右クリックのアクションシート)は日本語ハードコードのみで `applyI18N` 対象外だったため `kwsheet.*` DICTキーを新設して反映(WATCH/BLOCKボタン先頭のドット表示spanは温存)。詳細モーダルは英語見出し+日本語placeholderの混在を `detail.*` DICTキー+`t()` に統一。生の技術エラーメッセージ・既にバイリンガルな変数・"vault:" のようなステータスラベル慣用句は意図的に対象外(既存の`updateVaultStatus`の非翻訳慣行と一致) / Unified ~25 single-language toasts, kw-sheet's hardcoded Japanese labels, and the detail modal's mixed-language chrome into the existing bilingual i18n pattern
- **第15次監査(round 28、未踏3領域の並列監査)で15件を修正**: 過去14ラウンドが薄かった SW/PWA・UI/a11y・データ層/性能を3並列で監査し、確認済みの15件を修正。
  - 詳細モーダル: 永続要素 `#detail-card` へ開くたびにclickリスナーが追加され、古い closure の `tags` 配列を掴んだままN重発火(2エージェントが独立に発見)。モジュールスコープの `detailTags`+一度だけの委譲ハンドラに変更 / detail modal listener accumulation fixed with module-level state
  - `renderView`: 複数のawaitの後の `view.innerHTML` 書き込みに世代ガードがなく、遅いレンダーが新しいビューを上書きし得た。`renderSeq` カウンタ+`commit()` ゲートで解消 / stale-render race guarded by generation counter
  - バックグラウンドpoll後の通知: `new Notification()` はAndroid Chromeで例外となり、同一try内の後続UI更新まで巻き込んでいた。UI更新を先行させ、通知は `reg.showNotification()` を独立tryで実行 / UI refresh before notification, SW-registration API instead of constructor
  - 共有ターゲット: URLが `text` 欄のみで届く共有(Android頻出)を無言破棄していた。`share_text` から最初のURLを抽出、見つからない場合はトーストで通知 / extract URL from share_text, no more silent drops
  - `Store.listEvents`: read/starred/archived の厳密比較 `!==` により、booleanフラグ欠落の復元データが全ビューから不可視化。`later` と同じ `!!` 強制に統一 / boolean coercion for restored backups
  - SWシェルキャッシュ: 読みは `ignoreSearch` なのに書きは完全URLキーで、共有のたびに約325KBのシェル複製が永久蓄積。書きをpathnameキーに正規化し `neus-shell-v3` へバンプ(肥大した旧キャッシュはactivateで purge)/ SW cache write key normalized to pathname, bumped to v3
  - periodicsync起床通知: クライアント不在時に notify=OFF でも無条件に通知(SWはIDBの設定を読めない)。`AutoSync.syncPrefsToSW()` がCache API(`neus-prefs-v1`)へ設定をミラーし、SWが同意を確認してから通知。文言も「開いても自動取得はされない」実態に合わせ修正 / wake notification now consent-gated via Cache API pref mirror
  - フォーカストラップ: モーダル表示のたびにkeydownリスナーを再束縛し、first/lastが古い集合に固定されていた。モーダルごとに一度だけ束縛+ハンドラ内でfocusablesを毎回再取得 / trapFocus bound once with live focusables
  - `#kw-sheet`(sheet-backdrop): `aria-modal="true"` 宣言なのにトラップ/フォーカス復元の対象外だった。モーダル類の共通クラスリストに追加 / kw-sheet included in focus management
  - フォーカス復元: 単一変数のため、モーダル上にモーダルが開くと元のオープナーを失っていた。push/popスタックに変更 / focus restore stack for stacked modals
  - キーボードカーソル: s/e/r/l/v操作で現在カードがビューから消えても `kbCursor` が据え置かれ、アウトラインも消失し「見えているのと違うカード」に作用していた。操作後の `reclampCursor()` でクランプ+再ハイライト / keyboard cursor reclamped after card actions
  - StorageGuard: `event.stored` ごとに `storage.estimate()`+閾値超過時は全件スキャンをN回並行実行(evictionも重複)。トレーリングエッジのdebounce(2秒)+実行中フラグで1バースト1回に / storage check debounced and serialized
  - `Store.recentEvents`: dedup比較の上限300件に対しカーソルが24時間窓の全件を読み出してから `.slice` していた。カーソルを上限で早期停止するよう `cap` 引数を追加 / dedup window read capped at the cursor
  - 起動順序: 初回描画の前にFTS再構築+TagLearner(yieldなしの長タスク)+全件カウントが走り、イベント数に比例して空画面時間が伸びていた。初回描画を先行させ、重い初期化は描画後に実行。TagLearnerにもyield-every-100を追加。`Perf.mark('render')` がオンボーディング経路でしか記録されず常に0.00msだった計測バグも修正 / first paint before heavy init, TagLearner yields, render perf mark fixed
  - CJK 1文字検索: 文書側が2-gramでしか索引されないため単漢字クエリ(「本」等)が構造的に常に0件だった。クエリを含むgramの走査による `searchShort` フォールバックを追加 / single-character CJK queries now work via substring-gram fallback
- **`socraticPrompts` がCLAUDE.mdの関数≤40行規約を約95行で超過**: tierごとの判定を
  `validityPrompts`/`falsifiabilityPrompts`/`evidencePrompts`/`contradictionPrompts`/
  `neglectPrompts` の5ヘルパー関数(各12〜24行)へ切り出し、`socraticPrompts` 自体は
  それらを連結して `sort`+`slice(0,3)` するだけの13行の集約関数に変更。tier定数・各条件の
  発火ロジック・文言・優先順位は完全に不変(全既存テストが無変更でパス)/ Split
  socraticPrompts' ~20 conditions into 5 tier-scoped helper functions to satisfy CLAUDE.md's
  function <=40-line rule; socraticPrompts itself is now a 13-line aggregator (behavior unchanged)
- **Worker名/ブックマークレットに旧プロジェクト名 "Lensy" のドメイン残骸**: `wrangler.toml` の Worker 名が `lensy-proxy` のままで、実際にデプロイ・参照される `neus-proxy`(`_worker.js`/`DEPLOY.md`/`README.md`/`index.html` の既定値)と食い違っていた。存在しない・案内していないドメイン `lensy-proxy.*.workers.dev` をコメントごと `neus-proxy` に修正。`bookmarklet.js` のプレースホルダ `YOUR_LENSY_URL` も `YOUR_NEUS_URL` に統一(CLAUDE.md「競合ソフト名混入」防止規約)/ Fix stale "Lensy" (old project name) domain references in wrangler.toml's Worker name and bookmarklet.js's placeholder URL — both now consistently say neus-proxy/YOUR_NEUS_URL, matching every other file
- **健全なソースが自動無効化され得た(SourceFailTracker)**: 失敗カウンタは `inbound.fetched`(アイテム取得)でしかリセットされず、更新の少ないフィード(常に 304 Not Modified や 0 件)はカウンタが下がらなかった。散発的な一時失敗が累積し、連続失敗の意図に反して健全なソースが `sourceMaxFails` 回で自動無効化され得た。健全なフェッチ(304 / 2xx の0件 / アイテム有り)で `source.ok` を発行し、それでカウンタをリセットするよう変更。連続失敗のみが無効化につながる本来の意味論を回復 / Stop auto-disabling healthy but rarely-updating feeds: reset the fail counter on any successful fetch (304/empty/items), not just when items arrive
- **Markdown 書き出しの YAML frontmatter インジェクション**: イベント書き出しの frontmatter は `source`/`source_url`/`tags` を生のまま埋め込んでいたため、フィードのタイトルやソース名によくある `:`・改行・カンマが YAML を壊したり任意キーを注入し得た(単語ドシエ側は `ys()` で対策済みだった)。共有の `yamlScalar()` エスケーパを新設し両エクスポータで使用。値は二重引用符で包み `\` `"` 改行をエスケープ / Escape YAML frontmatter scalars in the event exporter (shared yamlScalar); a colon/newline in a feed title no longer corrupts or injects into exported notes
- **Vault 書き込み失敗時の後始末とエラー伝播**: `createWritable→write→close` が未保護で、`write` 失敗時に writable を片付けず、`exportEvent` の失敗が「書出失敗」トーストに反映されなかった(createWritable は close まで原本を差し替えないため原本破損はしない)。共通 `writeFile` で失敗時に `abort` し、`exportEvent` は false を返すよう変更 / Abort the writable on write failure and surface vault export errors as a failed result
- **単語の二重登録レース**: `addWord` が `findWordByTerm` チェックと `putWord` の間に同期ガードを持たず、二重クリック/Enter連打で同じ normalized キーの単語が2件作られ得た。同期フラグ `addingWord` で再入を防止(空入力チェックの後・最初の await の前にロック)/ Guard addWord against double-submit creating duplicate watchwords
- **重複排除の URL 正規化をパイプライン入口で一元化**: dedup ハッシュ `sha256(raw.link+'|'+title)` の `raw.link` が、RSS は `parseFeed` で正規化済みだが JSON ソース(Qiita)は未正規化だった。同一記事が trivial な URL 差(トラッキングパラメータ・フラグメント)で重複し得たため、`inbound.fetched` 入口で `normalizeUrl` を一元適用し、`url` と `hash` を揃えた(RSS は冪等のため不変、Qiita の正規 URL もハッシュ不変=既存データ移行影響なし)/ Normalize the URL once at the pipeline entry so cross-source dedup isn't defeated by tracking params/fragments (Qiita path was unnormalized)
- **ALL ビューのバッジが件数不一致**: `cnt-all` は `countAll()`(アーカイブ込み総数)を表示する一方、ALL ビューは `{archived:false}` で描画していたため、アーカイブがあるとバッジが実表示より多く出ていた。バッジを `countAll()-countArchived()` に修正(`countAll` の他5箇所の「総数」用途は不変)/ Fix ALL badge to count non-archived items (matching the view), not the archived-inclusive total
- **キーワードルール: block が watch より優先**: 同一 Event が block:archive と watch:star の両方に一致すると、アーカイブ(非表示)かつスター(強調)という矛盾状態になっていた。block ルールがアーカイブした Event には watch アクション(star/highlight/tag)を適用しないよう変更(delete が watch を飛ばす既存挙動と一貫)。block 不一致時は watch は従来どおり適用 / KeywordRules: a block-archived event is no longer also starred/highlighted (block precedence)
- **LATER ビューが機能していなかった**: `Store.listEvents` が `read`/`starred`/`archived` フィルタしか見ておらず `later` を無視していたため、LATER ビューは「後で読む」キューではなく非アーカイブの全件を表示し、LATER カウントも誤っていた。`later` フィルタを追加(`!!ev.state.later` で旧データの未設定も安全に not-later 扱い)。アーカイブ済みは LATER から外れ ARCHIVED に出る挙動は不変 / Fix the LATER view: listEvents ignored the later filter, so LATER showed all non-archived items
- **タグ/ソース絞り込み時にキーボードカーソルをリセット**: `applyFilter` がフィルタ適用で再描画する際 `kbCursor` を据え置いていたため、j/k カーソルの位置表示が新しいリストとずれていた(範囲チェックがありクラッシュはしない)。ナビ切替と同様に `kbCursor=-1` にリセット / Reset the keyboard cursor when a tag/source filter is applied

### Changed
- **単語収集を並列フェッチ化**: `_collectOne` は Wikipedia と各検索フィードを直列に取得していたため、ソースが多い単語ほど round-trip が積み上がり遅かった。1ソース分を `fetchFeed` ヘルパーに切り出し、Wikipedia と全フィードを単一の `Promise.all` で並列取得するよう変更(独立I/O)。エラー分類(network/http_/parse)・`inbound.error` 発行・生件数 total・lastErrors の意味は不変。語間は従来どおり直列で、同時接続はソース数(≤8)に収まる / Parallelize per-word collection (Wikipedia + all feeds via one Promise.all) instead of serial fetches
- **新規 watchword の既定ソースを言語別に**: 日本語ソース(Qiita/Zenn/Hatena)が言語に関わらず常に既定 OFF で、日本語ユーザーは単語ごとに毎回 3 つ手動で有効化する必要があった。`defaultSources()` を追加し、`currentLang==='ja'` では Qiita/Zenn/Hatena を既定 ON・英語中心の Reddit/HN を OFF に、英語では従来どおりに切替。WORDS モーダルを開いた時もソースチェックボックスを言語既定に同期。Wikipedia/Google News は両言語で常時 ON。ユーザーは個別トグルで上書き可能 / Language-aware default sources for new watchwords (JA users get Qiita/Zenn/Hatena on by default)

### Added
- **はてなブックマーク数をスコアに反映 + エンゲージメント計算の共通化**: はてブの検索RSSは項目ごとに `hatena:bookmarkcount` を持つが未使用だった。Qiita いいねと同じ曲線で控えめなスコアブースト(+0..25)に変換するよう `parseFeed` を拡張。基準50・対数・上限の計算を `engagementScore()` 共有ヘルパーに集約し、Qiita(JSON)と RSS 経路の重複を解消。他フィードは要素が無いため no-op、はてブ以外のRSSでも `hatena:bookmarkcount` 相当があれば自動適用 / Use Hatena bookmark count for score (same curve as Qiita), via a shared engagementScore() helper
- **Qiita エンゲージメントをスコアに反映**: Qiita API が返す `likes_count` を取得しながら捨てていた。これを対数スケールの控えめなブースト(+0..25 上限)としてイベントの `meta.score` に反映し、人気記事がダイジェスト Top3 やスコアバッジで上位に出るようにした(`raw.score` 汎用フックのため将来の JSON ソースにも適用可。いいね0は 50 で他ソースと同等)/ Use Qiita likes_count as a gentle log-scaled score boost so popular articles rank higher
- **収集アイテムのコンテンツタグ取り込み**: Qiita 記事は固有のタグ(最大5件、例 "Rust"/"WebAssembly")を持つが破棄していた。`parse` が `raw.tags` として渡し、`inbound.fetched` 正規化が `word:{term}` に続けて小文字化・重複排除・上限8件で `autoTags` に取り込むよう変更。収集記事が実タグで検索・フィルタ・関連付けの対象になる(汎用実装のため将来の JSON ソースにも適用) / Import source-provided content tags (e.g. Qiita article tags) into autoTags for searchability
- **はてなブックマークを収集ソースに追加**: Qiita/Zenn は単一プラットフォームの記事に閉じるが、はてブは日本語Web全体の被ブックマーク記事を横断する全文検索 RSS(`b.hatena.ne.jp/search/text?q=...&mode=rss`)を提供する。検索語を verbatim で渡す検索フィードのため既存 `/rss` プロキシをそのまま再利用(ワーカー変更不要)。デフォルト OFF(arXiv と同じ opt-in)。なお note.com はタグ全文検索 RSS が貧弱、connpass はイベント主体かつ JSON 許可リスト拡張が必要なため今回は見送り / Add Hatena Bookmark full-text search RSS as a cross-platform Japanese aggregator source (reuses /rss, no Worker change)
- **Qiita / Zenn を収集ソースに追加**: 日本語技術用語の watchword で取得源が貧弱だった(英語ニュース・Reddit・HN が中心)。両プラットフォームはキーワード検索 RSS を提供しないため、タグ/トピックの Atom フィードを採用し `qiita.com/tags/{slug}/feed` / `zenn.dev/topics/{slug}/feed` を取得。一致タグが無ければ 404 が `lastErrors` に記録され「取得失敗」として誠実に表示される。Worker の `/rss` プロキシは既存ガードで両ホストを通すため変更不要。デフォルトは OFF(arXiv と同じ opt-in 扱い、英語ユーザーに日本語コンテンツを押し付けない) / Add Qiita and Zenn as opt-in tag/topic feed sources for watchwords; honest 404 surfacing for non-existent tags

### Changed
- **Qiita 概要の品質改善**: 概要を Markdown の `body` から剥がしていたため、HTMLタグ除去後も `#` `*` `` ` `` `[text](url)` 等の記法が残りノイズになっていた。公式APIが返す `rendered_body`(HTML)を優先し、タグ除去→エンティティ復号(`RSSPoller.decodeEntities` を共有ヘルパー化)の順で整形して清書テキストにした。順序を逆にすると `&lt;x&gt;` が偽タグ扱いで欠落するため、剥がし→復号の順を回帰テストで固定 / Improve Qiita snippet quality: use rendered_body (HTML) instead of Markdown body, strip-then-decode order
- **Qiita を全文検索API(公式 REST v2)へ昇格**: タグフィードは「タグ一致記事」しか拾えず網羅性に欠けた。Qiita には公式の `GET /api/v2/items?query=` 全文検索(JSON)があるため、これをワーカー `/json` 経由で取得する方式へ変更(`qiita.com` を `/json` 許可リストに追加、ADR-0017)。`WORD_FEEDS` に `kind:'json'` + 専用 `parse` を導入し、収集ループが JSON は `/json`+`parse`、RSS は `/rss`+`parseFeed` に分岐。Zenn は公式検索 API が無いためトピック Atom フィードのまま(非公式 JSON は破損リスクのため不採用) / Promote Qiita to full-text search via its official REST API v2 through the Worker /json proxy; Zenn stays a tag feed (no official search API)
- **Qiita / Zenn のタグスラグ正規化をプラットフォーム別に修正**: 当初は両者を共通の `空白->ハイフン` で正規化していたが、どちらもタグ/トピックにハイフンを使わない(この修正は Qiita が検索APIへ移行したため現状 Zenn にのみ適用)。Zenn トピックは小英数字+日本語のみ連結("Next.js"->"nextjs")へ修正 / Fix tag-slug normalization to match each platform's actual convention (no hyphens)

### Added (continued)
- **仕様書 (SPEC.md)**: 現行 v0.12.0 を一次情報として定義する仕様書を新設。不変条件(I1-I8)・データモデル(InformationEvent / Watchword)・探究モデル・Worker API・セキュリティを集約し、長所/短所/改善点の監査結果を §10 に記録 / Add SPEC.md as the authoritative specification; documents invariants, data model, inquiry model, Worker API, and an audited strengths/weaknesses/improvements section

### Changed
- **ドキュメントの版ずれ解消**: `ARCHITECTURE.md` を v0.2.0 → v0.12.0 に更新(words store・探究モデル・`source.type:'word'`・`/json` endpoint・ADR 0009-0016・モジュール一覧)。`README.md` のファイル構成と検証コマンドの古い数値を現行へ修正 / Bring ARCHITECTURE.md and README.md up to date with the watchword/inquiry subsystems

### Fixed
- **要約予算のリロード回避を封鎖**: `Summarizer` の日次カウンタがメモリ上のみで、ページリロードで 0 に戻り日次予算(BYOK 課金上限)が再読込だけで回避できた。カウンタを IndexedDB (`summary-budget`) に永続化し、起動時に復元・加算ごとに保存・日付変化で自動リセット / Persist the daily summary budget counter so a page reload no longer resets BYOK spend
- **インポートの破壊的先行削除を防止**: JSON 復元が既存データを全削除した後にレコードを書き込むのに、検証が浅く(`app==='neus'` と events 配列のみ)、不正なバックアップだと旧データを失った上で壊れたレコードが入った。退避前に全 event/word の構造を検証し、不正なら削除せず中止 / Validate every record's shape before the destructive wipe on import (no rollback exists)
- **Vault ドシエのファイル名衝突を解消**: `exportWordDossier` が `{slug}.md` を使うため、別語が同じ slug に正規化されると(例 "C++" と "C")後勝ちで上書きし前者のドシエを失った。`{slug}-{id8}.md` とし語 id で一意化 / Make vault dossier filenames unique per word id to stop silent slug-collision overwrites
- **単語カード件数バッジの曖昧さ**: 検索結果の `wordResultHtml` がラベルなしの `lastFetched` 数値だけを表示し、裁決ピルや match% と区別できず a11y ラベルも無かった。`title` / `aria-label` で「収集時の取得件数」であることを明示(実在件数は WORDS モーダルが `countFor` で別途表示)。`publishedAt||timestamp` の日付フォールバック規約を回帰テストで固定し、parse 時に日付を捏造しないことを保証 / Label the ambiguous fetched-count badge; pin the publishedAt date-fallback convention with regression tests

### Added (continued from prior rounds)
- **収集進捗インジケータ**: `WordCollector.getProgress()` が収集中の `{done,total}` を公開。COLLECT ALL ボタンが `N/M` を表示し、複数語収集中も無反応に見えない / Collection progress: COLLECT ALL button shows `N/M` while multiple words are fetched
- **WORDS ビューの並び替え**: 日付 / 新着 / 裁決 の3モードをトグルボタンで切替(`wordSortKey`)。新着は未確認件数降順、裁決は answered を先頭に / WORDS view sort modes (date / new / verdict)
- **STATS への単語サマリ統合**: 統計モーダルに総語数・解決数・未確認・要再検討を表示(`wordsOverview`)。ビュー切替なしで探究の健全性を把握 / Word summary in the STATS modal
- **裁決の理由 (Verdict rationale)**: 裁決ピルは status を巡回できたが、**なぜその結論か** を記す手段が無かった(理由は import/復元でしか入らなかった)。非 open の裁決にインライン理由エディタ(`editverd`/`savevn`、`verdictNotePatch` 純粋関数、280字上限、Enter送信)を追加。理由は既存の MD ドシエ `verdict_note` / JSON 出力へそのまま流れる / Author *why* a verdict was reached; flows into the existing dossier export
- **単語の改名 (Rename watchword)**: 用語のスペルミス(例 "WebPGU"→"WebGPU")を修正する手段が無く、削除+再作成で探究履歴(問い・裁決・wiki・収集アイテム)を失っていた。WORDSモーダルに「改名」ボタンを追加。`renameWordPlan` 純粋関数が変更を判定し、normalized が変わる場合は収集済みイベントの `word:` タグを自動で付け替えてアイテムの関連を維持。大文字小文字のみの変更は再タグ付け不要。衝突検出・二重送信防止・Enter/Escape 対応 / Rename a watchword in place, preserving all inquiry history and re-tagging collected items when the normalized form changes
- **裁決の変遷 (Verdict history / dialectic)**: 裁決ピルは status を巡回できたが、**変更のたびに過去の結論を上書き**していた。ソクラテス式問答法の核心は「論駁を経て結論がどう覆ったか」の記録そのもの — その軌跡が捨てられていた。`questionHistory` と対称な `verdictTransition` 純粋関数を追加し、status が変わるたび去りゆく裁決を `{status,note,at}` として `verdictHistory`(直近8件)に刻む。WORDSカードに変遷チェーン(`.word-vtrail`)、MDドシエに `## 裁決の変遷` セクションと `verdict_revisions` frontmatter、JSON出力にも含めて往復可能に。`setverd`/`reexamine` が利用し、再検討の取消は裁決状態(status・note・履歴)を無損失に復元 / Record how a verdict changed over time — the dialectic the Socratic method exists to preserve
- **反証条件 (Falsification condition)**: 最も鋭いソクラテス的問い —「何があれば結論を覆すか」。反証条件を述べられない結論は知ではなく独断(ポパーの反証可能性、エレンコスの自己適用)。非 open の裁決に反証条件エディタ(`editfals`/`savefals`、`falsifierPatch` 純粋関数、280字、Enter/Escape)を追加。`socraticPrompts` を強化: 反証条件があれば停滞プロンプトを「あなたは『X』なら覆ると述べた — それは現れたか?」に鋭利化(`stale-falsifier`)し、反証条件なしで決着した裁決には「それは知か、独断か?」(`no-falsifier`)を突きつける。FTS索引・MDドシエ `## 反証条件` セクション・frontmatter・JSON・インポート往復に対応 / State what would change your mind — a verdict without defeaters is dogma; sharpens the elenchus prompts
- **問いの解決 (Question resolution)**: ソクラテスの弧 アポリア→論駁→解決 が未完だった — 問いは削除しかできず、「答えたのに未解決の問いが残る」プロンプトを黙らせる唯一の手段が削除(=かつて知らなかった証拠の抹消)だった。各問いに解決トグル(`resolveq`、`resolvedAt`)を追加。解決済みは取り消し線で記録に残し、未解決を先頭に並べる。`questions-remain` プロンプトは未解決の問い(`openQuestions`)のみを数えるよう変更 — 削除ではなく解決で矛盾を正直に解消できる。MDドシエは未解決と解決済みを分けて出力、`resolvedAt` は questions 配列に乗って往復 / Resolve a question (keeping the record) instead of only deleting it; the contradiction prompt now counts only open questions

### Changed
- **取得失敗と沈黙の区別**: `signalGaps` は失敗したソースを「沈黙(0件)」に混ぜていたため、「空白: news」がニュースに記事が無いのか取得失敗なのか判別できなかった。死角を空白と混同するのは探究像を歪める — 沈黙は発見、取得失敗は発見の不在。`_collectOne` が失敗を `word.lastErrors`(label→code)に記録し、`signalGaps` が `{ active, silent, errored }` を返すよう変更。失敗ソースは silent から外れ、ドシエ `## 空白` と沈黙プロンプトが到達不能ソースを誤って空と報告しなくなった。WORDS ビューに赤い「取得失敗」行(`.word-err`)を追加 / Distinguish a failed fetch from genuine silence

### Added (continued)
- **Wikipedia 標準タイトル表示**: 記事タイトルが登録語と異なる場合(例 "GPT" → "Generative pre-trained transformer")、WORDSビューに `word-wiki-canon` バッジ、ドシエに `wiki_title:` frontmatter フィールドと `## 定義 (canonical)` セクションヘッダを表示 / Show canonical Wikipedia article title when it differs from the registered term
- **検索から watchword 登録**: 検索結果ページに「+ 登録」バナー(`sr-word-banner`)を追加。未登録語を検索したとき1クリックで watchword として登録し、WORDSビューに即遷移。すでに登録済みなら WORDSビューのフィルタに飛ぶ / Register-as-watchword banner in search results
- **ドシエのクリップボードコピー**: 単語カードに COPY MD ボタンを追加。`WordExporter.copyMd()` がドシエをクリップボードへ書き込む / Copy dossier to clipboard without downloading
- **FTSIndex の単語インデックス**: 単語のノート・問答・裁決理由も FTS で検索可能に。検索結果ページに `word:` プレフィックス付きの単語ヒットカードを表示し、クリックで WORDSビュー + 名前フィルタへ遷移 / Words are indexed in FTS and appear in search results

### Fixed
- **名前フィルタ 0件時に空状態を表示**: テキスト入力で全セクションが非表示になっても「一致なし」メッセージが出なかった問題を修正。DOM操作で `#word-filter-empty` を挿入し、Escape 時にも非表示にする / Show no-match message when name filter returns zero results
- **単語削除の Undo 対応**: 削除後 8秒間、UndoStack で元に戻せるように。収集済みイベントはDBに残るためロスレスなリストア / Undo word deletion via UndoStack within 8s
- **モーダルの収集状態表示**: WORDSモーダルの単語リストに `· 最終収集 Xh前` または `· 未収集`(アクセント色)を表示 / Show last-collected time or "not collected" indicator in the modal word list
- **エクスポート後 reviewedAt を更新**: `copyMd` / `downloadMd` / `downloadJson` / `toVault` の各エクスポートが成功後に `word.reviewedAt=Date.now()` を記録。エクスポートをもってレビュー完了とみなし「新着」バッジが即時リセットされる / Mark word as reviewed after any dossier export
- **downloadAllMd も reviewedAt を一括更新**: 全単語一括出力(`EXPORT ALL`)後に全 watchword の `reviewedAt` を更新 / downloadAllMd marks all words reviewed
- **addq で入力値を明示クリア**: `renderView()` 前に `input.value=''` を明示呼び出し / Explicitly clear question input before re-render
- **WORDS view ソートの安定化**: 同一ソート値を持つ単語を `createdAt` 降順で二次ソートし、並び順を決定的に / Stable sort tiebreaker by creation date
- **単語アクションボタンに aria-label 追加**: 収集・確認済み・フィルタ・各エクスポートボタンに語名を含む `aria-label` を付与。スクリーンリーダの「ボタン一覧」モードで各ボタンがどの単語に作用するか判別可能に / Word action buttons now carry aria-labels including the word term
- **問い削除に Undo 対応**: `delq` が `UndoStack.offer` で 8秒間取り消し可能に。単語削除と同じ安全性を個々の問いにも適用 / Question deletion now offers undo via UndoStack within 8s
- **収集ボタンがエラー時に再活性化**: `collect` / `collectall` の `finally` ブロックで `btn.disabled=false` を明示。収集が失敗してもボタンが無効のままにならない / Collect buttons always re-enabled in finally block
- **`suggest` ハンドラに防御的 try-catch**: `collectOne` が例外を投げても `refreshCounts`/`renderView` が必ず実行されるよう保証 / Defensive try-catch around collectOne in suggest handler
- **ドシエ YAML frontmatter のエスケープ**: `term`/`intent`/`wiki_title`/`verdict_note` を `ys()` ヘルパーでダブルクォート囲いにし、コロン・改行を含む用語でも YAML 破壊が起きないように / YAML-safe quoting of user-controlled frontmatter values in toDossier
- **`wordFromImport` が `lastErrors` を保持**: JSON ドシエの往復で `lastErrors`(取得失敗記録)が失われていたのを修正。`signalGaps` がインポート後も正確に失敗ソースを表示 / Preserve lastErrors through import round-trip
- **彫琢・裁決理由行に「取消」ボタンと Escape 対応を追加**: インライン編集行に Cancel ボタンを追加(`cancelq`/`cancelvn` アクション)。`data-rqinput` / `data-vninput` での Escape キーがキャンセルとして機能 / Cancel button + Escape key dismissal for refine and verdict-note inline rows
- **モーダルの無効化単語を半透明表示**: `enabled:false` の単語の term を `opacity:.5` でグレーアウト。ON ボタン表記だけでなく視覚的にも判別可能に / Dim the term label in the word modal when the word is disabled
- **問いを最新順に表示**: 追加したばかりの問い(作業中)が先頭に来るよう、`w.questions` を逆順表示 / Questions displayed newest-first in the word card
- **COLLECT ALL ボタンが収集中をリアルタイム表示**: WORDS ビューへ遷移した際に `WordCollector.isBusy()` を参照し、収集中なら `..` と disabled を表示 / COLLECT ALL button reflects busy state when navigating to WORDS view during background collection
- **`renderView` の `aria-busy` リセット漏れを修正**: digest ビューと search ビューの全 `return` パスで `aria-busy='false'` を設定。スクリーンリーダがローディング中のまま固まらないように / Fix aria-busy never reset in digest and search view paths
- **検索結果の単語カードに裁決バッジと件数を追加**: `wordResultHtml` が裁決ステータス(open/converging/answered/suspended)と収集件数を表示。検索画面だけで探究状況を把握可能に / Word search result cards now show verdict badge and item count
- **重複問い追加を防止**: `addq` が同一テキストの問いを既に持つ場合にエラートーストを表示し、重複登録を拒否 / Reject duplicate question text in addq with a user-visible error toast

### Tests
- `tests/word-sort.test.mjs`(date/new/verdict ソート + 進捗 + STATS サマリのワイヤリング)
- `tests/word-verdict-note.test.mjs`(`verdictNotePatch` + インライン理由エディタのワイヤリング)
- `tests/word-signal-gaps.test.mjs` に errored 分類(失敗 vs 沈黙)を追加
- `tests/word-fts.test.mjs` — FTSIndex 単語インデックス + 検索から watchword 登録バナーのワイヤリング + downloadAllMd reviewedAt + addq input clear のワイヤリング
- `tests/word-socratic.test.mjs` — `verdictStale` / `cognitiveShift` / `socraticPrompts` の直接ユニットテスト(39件) + wiki canonical title ワイヤリング
- `tests/worker.test.mjs` に `/json` 許可リスト(22件: Wikipedia/Wikimedia サブドメイン・混同攻撃)を追加
- `tests/word-sort.test.mjs` に tiebreaker テスト(2件)を追加
- `tests/word-a11y.test.mjs` に単語アクションボタン aria-label ワイヤリングテスト(4件)を追加
- `tests/word-fts.test.mjs` に collect/collectall ボタン再活性化・suggest try-catch・delq Undo ワイヤリングテスト(4件)を追加
- `tests/word-dossier.test.mjs` に YAML エスケープユニットテスト(2件)を追加、既存 frontmatter アサーション 4件を新形式に更新
- `tests/word-import.test.mjs` に `lastErrors` 保持ユニットテスト(2件)＋ワイヤリング(1件)を追加
- `tests/word-a11y.test.mjs` に Cancel ボタン / Escape ハンドラ / modal 無効化表示のワイヤリングテスト(6件)を追加
- `tests/word-fts.test.mjs` に問い逆順 / isBusy / aria-busy / 裁決バッジ / 重複防止 ワイヤリングテスト(6件)を追加
- `tests/word-rename.test.mjs` を新規追加: `renameWordPlan` ユニットテスト(7件)＋改名ワイヤリング(6件)
- `tests/word-verdict-history.test.mjs` を新規追加: `verdictTransition` ユニットテスト(6件)＋裁決変遷ワイヤリング(9件)。`word-import.test.mjs` に verdictHistory 往復テスト(3件)を追加
- `tests/word-falsifier.test.mjs` を新規追加: `falsifierPatch` ユニット(5件)＋反証条件ワイヤリング/プロンプト/エクスポート(13件)。`word-import.test.mjs` に falsifier 往復テスト(2件)を追加
- `tests/word-question-resolve.test.mjs` を新規追加: `openQuestions` ユニット(3件)＋questions-remain カウント(2件)＋解決ワイヤリング(8件)、合計 724件
- 計 634 tests

### Added
- **GitHub Topics を収集ソースに追加**: `github.com/topics/{slug}.atom` のトピック Atom フィードを opt-in ソースとして追加(スラグはハイフン連結、例 "Next.js"→"next-js")。公式検索 API が無いトピックフィード設計は Zenn と同型のため、`signalGaps` の 404-as-silence 特例を `zennLabel` 単体判定から `topicFeeds` Set(Zenn ∪ GitHub)へ一般化 / Add GitHub Topics Atom feed as an opt-in watchword source; generalize the Zenn 404-as-silence exception to a `topicFeeds` Set covering both topic-feed sources

### Fixed
- **Google News のタイトルに publisher サフィックスが残っていた**: Google News は全見出しに `<source>` 要素の発行元名を使って ` - {publisher}` を付与するが、`parseFeed` はこれを剥がしていなかった。表示ノイズに加え、同一記事を Qiita/Zenn/HN から直接取得した場合とのタイトル Jaccard 類似度を下げ、クロスソース重複排除の閾値(0.8)をすり抜けさせていた。`<source>` の値と厳密一致するサフィックスのみを除去する条件付きストリップを追加(他 RSS ソースは無変更) / Strip Google News' " - {publisher}" title suffix (via the item's `<source>` element) for cleaner display and reliable cross-source dedup
- **単語インポートで新規ソースキーが欠落し得た**: `wordFromImport` は古いドシエ JSON の `sources` オブジェクトをそのまま使っていたため、エクスポート後に `WORD_FEEDS` へ新ソース(qiita/zenn/hatena/github)が追加されると、インポートした語にそのキーが存在しなくなっていた。`defaultSources()` とのマージに変更し、既存キーはユーザー設定を維持したまま新規キーを既定値で補完 / Merge imported word sources with defaultSources() so newly-added source keys are backfilled instead of silently missing after import
- **単語1件収集(COLLECT)に完了フィードバックが無かった**: `collectAll` は完了トーストを出す一方、単一語の `collectOne` はボタンのテキストが戻るだけで取得件数が分からなかった。「N件取得」(件数>0時は緑)/「収集完了(新着なし)」のトーストを追加し、COLLECT ALL と挙動を揃えた / Add a completion toast to single-word collectOne (parity with collectAll's feedback)
- **ストレージ自動整理のトーストが赤(エラー色)だった**: `StorageGuard` の自動退避(エクスポート済み・アーカイブ済みイベントの間引き)は正常な保守動作なのに `'err'` トーストで表示され、何か壊れたかのように見えた。`'ok'` に変更 / Auto-clean toast now shows as success (ok), not error — housekeeping is not a failure
- **新着通知アイコンが存在しないファイルを参照**: 定期同期の新着通知が `icon:'/icon-192.png'` を指定していたが、このリポジトリに PNG アセットは存在しない(`manifest.json` は inline SVG data URI のみ)。マニフェストと同じ 192x192 SVG data URI を直接指定するよう修正 / Fix the new-items notification to use the manifest's inline SVG icon instead of a nonexistent /icon-192.png file
- **イベントカードの一部ボタンに aria-label が無かった**: read/star/archive/later ボタンには aria-label があったが、vault/detail/copy の3ボタンには無かった(可視テキストはあるが兄弟ボタンと非一貫)。3ボタンに aria-label を追加 / Add aria-label to the vault/detail/copy event-card buttons for consistency with their siblings
- **フルバックアップ/復元が学習した興味プロファイルと同期設定を落としていた**: JSON バックアップの設定ホワイトリストが `byok`/`lang`/`keyword-rules`/`onboarding-done` の4件のみで、`interest-profile`(スター/アーカイブ操作から学習した興味語彙)と `auto-sync`(取得間隔・通知設定)が対象外だった。`interest-profile` は復元イベントから自動再構築できない(学習はライブ操作でのみ蓄積)ため、復元のたびにユーザーのパーソナライズが無警告で失われていた。両キーをエクスポート/リストア双方のホワイトリストに追加し、復元後に `InterestProfile.load()` を呼んで即時反映(`summary-budget` は日付スコープのカウンタのため意図的に対象外のまま) / Include interest-profile and auto-sync in full JSON backup/restore — interest-profile can't be rebuilt from restored events alone, so it was silently lost on every restore

### Changed
- **重複排除の類似度比較件数に上限を設けた(ADR-0019)**: `event.normalized` の dedup は 24h ウィンドウ内の全イベントと総当たりで Jaccard 比較し、比較のたびにタイトルを再 tokenize していたため、ソース数・watchword 数が多い活発なユーザーほど POLL/COLLECT ALL のコストが件数に比例して悪化していた(SPEC.md round 15 で性能課題として指摘済み)。`recentEvents`(timestamp 降順)の結果を直近 `dedupCompareMax=300` 件に `.slice` で上限化。重複記事は時間的近接性から通常ウィンドウの先頭側に集中するため、実運用での再現率低下は事実上発生しない / Cap the dedup title-similarity scan to the 300 most recent events instead of the full 24h window, bounding cost as active users' event volume grows

### Added
- **問いの手がかり (Question Watch)**: ソクラテス式問答法でプロダクト自身の機能セットを検討した結果発見した非対称性を解消。反証条件(`falsifier`)は該当収集物を能動検出する `falsifierHits` を持つのに、構造的に同一の照合が必要な未解決の問い(`questions`)には同等の機構が無かった。被覆率照合ロジックを共有ヘルパー `bigramCoverageHits(text,events)` へ抽出し、各未解決の問いに `questionHits(question,events)` として適用。WORDSビューは問い文の直後にクリック可能なヒント(上位一致へのリンク+件数)を表示、ドシエは問いの下にインデントした箇条書きで一致アイテムを記録。解決済みの問いは対象外 / Question Watch: extract the shared bigram-coverage matcher and apply it to open questions too (symmetric to the existing Falsifier Watch), surfacing collected items that may address an unresolved question
- **裁決の動揺(verdict-churn)プロンプト**: ソクラテス式問答法の第2ラウンドで発見した非対称性。`verdictHistory` は変遷のたびに記録されるが、`socraticPrompts` は一度もこれを読まなかった。`cognitiveShift` は登録時の先入観と現在の裁決という単一比較に留まり、裁決が何度も揺れ動いた事実そのものは問い直されなかった。`verdictHistory.length>=3`(最低2往復の反転)で「基準は一貫しているか、証拠が本当に不安定なのか」を問うプロンプトを追加 / Add a verdict-churn prompt: 3+ recorded verdict transitions now surface a reflection on whether the oscillation reflects consistent criteria or genuinely unstable evidence
- **resolved-from-agnostic プロンプト**: ソクラテス式問答法の第3ラウンドで発見した非対称性。`PRIOR_DIRECTION` は `curious`(既定値)と `agnostic`(意図的な選択)を共に `open` へ写像するため、`cognitiveShift.shifted` は両者を起点にした語では構造上決して発火しない。しかし「知り得ないと明示的に述べた(agnostic)のに確信的な結論に至った」ことは、既存の certain/skeptical 逆転プロンプトと同等以上に鋭い自己矛盾。`curious` は既定値でほぼ全語に該当するため対象外(信号が薄まる)とし、`agnostic` のみ特例化 / Add a resolved-from-agnostic prompt: an explicitly agnostic prior reaching a confident verdict now surfaces a reflection, closing a blind spot that cognitiveShift's shifted flag structurally cannot reach (curious/agnostic both map to the 'open' direction)
- **only-research プロンプト**: ソクラテス式問答法の第4ラウンドで発見した非対称性。`no-research`(証拠が全て discussion/other=一次研究皆無)には「事実か意見か」と問うプロンプトがあるのに、その裏返し(証拠が全て research 層のみで報道・議論皆無)には何の反応も無かった。純粋に学術論文のみに基づく結論は実世界での検証を経ていない可能性がある。`tiers.every(t=>t.tier==='research')` で追加(no-research とは構造上排他的) / Add an only-research prompt, symmetric to no-research: evidence composed entirely of academic papers with zero press/discussion coverage now surfaces a reflection on whether it's been validated in practice
- **disabled-still-open プロンプト**: ソクラテス式問答法の第5ラウンドで発見した非対称性。探究モデルは至る所で誠実さを強制するが、`word.enabled=false`(収集無効化)は裁決に何の作用も持たず `socraticPrompts` から一度も参照されていなかった。ユーザーは収集を止めるだけで `open` のまま探究を静かに放棄でき、`suspended`(保留)という誠実な明示的選択を回避したまま他の全プロンプトの自己吟味圧力からも逃れられていた。無効化かつ未裁決かつ証拠有りで「再開するか、保留として記録すべきか」を問うプロンプトを追加 / Add a disabled-still-open prompt: disabling collection no longer offers a silent escape from the verdict-honesty pressure the rest of the inquiry model applies

### Fixed
- **BYOK 日次予算 `0` が「無制限」に反転していた**: `budget:0` は falsy 判定 `if(s.budget&&dailyCount>=s.budget)` によりスキップされ、「日次0件に制限」の意図が正反対の「無制限」になっていた。判定を `typeof s.budget==='number'&&dailyCount>=s.budget` へ変更し、`0` を明示的な「常にブロック」として扱うよう修正 / Fix BYOK daily budget: setting it to 0 no longer inverts to "unlimited" — a typeof check replaces the falsy check so 0 is honored as "always block"
- **要約予算超過トーストの連発**: 日次予算超過後、`event.tagged` のたびに同一のエラートーストが再表示されていた(`role="status"` のため読み上げも連続)。POLL/COLLECT ALL の一括取り込みで顕著。`Summarizer` に日付キー単位の通知済みフラグを追加し、1日1回のみ通知するよう修正 / Fix summarizer budget-exceeded toast spam: notify at most once per day instead of once per tagged event
- **socraticPrompts の push 順による構造的飢餓**: 約20の発火条件が push 順の先頭3件で切られていたため、無効化+問い未設定+ソース沈黙+未確認多数といった「よくある放置状態」で同時成立する条件のうち、関数後段のプロンプト(verdict-churn・resolved-from-agnostic・disabled-still-open 等)が構造的に一度も表示されなかった。関数冒頭の既存コメント「結論の妥当性 > 反証条件 > 証拠の質 > 自己矛盾 > 探究の怠り」を tier 番号として数値化し、push 順ソートではなく tier 昇順の安定ソートで並べ替えてから上位3件を返すよう変更(同一 tier 内は既存の push 順=優先意図を維持) / Fix socraticPrompts starvation: prompts are now stable-sorted by a priority tier (matching the function's own documented priority order) before being capped to 3, instead of a raw push-order cutoff that structurally starved out later-declared prompts

### Added
- **キーワード検知 OS アラート**: `Plan.md` §4.9 (v1.1) 記載の未実装項目。`KeywordRules` の WATCH ルールに独立した `notify` 真偽値を追加(既存の star/highlight/tag アクションと併用可能)。簡易UIのチェックボックスを ON にすると保存時に既存の `AutoSync.requestNotificationPerm()` を呼ぶ opt-in 設計。block によるアーカイブ後は抑制(既存の block優先規約と一貫)し、共有 tag `'neus-watch'` により連続一致で通知が積み上がらず最新の一致に置き換わる / Add opt-in OS notifications for KeywordRules WATCH matches, reusing the existing notification-permission flow; suppressed when a block rule archives the event, and coalesced via a shared notification tag so matches don't pile up

### Fixed
- **`event.normalized` の hash 重複レコード競合**: `Store.findByHash`→`Store.putEvent` が非アトミックな check-then-act で、`Bus.publish` は fire-and-forget(購読ハンドラを await しない)。`_collectOne` が1単語の全有効フィードを `Promise.all` で並行取得するため、同一記事が2つの異なるソースから取得されると、2つの `event.normalized` 呼び出しが両方とも「未存在」を読んでから書き込み、重複レコードを作り得た。同一 hash の処理をインメモリの `Map` ベースゲートで直列化し、後続の呼び出しは先行の完了を待ってから正しく「既存」ヒットの autoTag マージ経路に入るよう修正(タグ結合を失わない)/ Fix a hash-collision race in event.normalized: concurrent processing of the same article from two sources could create duplicate records; in-memory serialization per hash now ensures the second call correctly merges into the first instead

### Fixed (独立した敵対的レビューで発見・修正、round 26)
- **Google News タイトル剥がしが全 RSS ソースに無条件適用されていた**: 共有 `parseFeed` 内にあり `source` を見ていなかったため、ユーザー追加のカスタム RSS(`<source>` 要素を持つアグリゲータ系)のタイトルも誤って切り詰められ得た。`source?.url?.includes('news.google.com')` でスコープを限定 / Scope the Google News title-suffix strip to Google News feeds specifically (via source.url), instead of applying it inside the shared parseFeed() to every RSS/Atom source
- **hash 重複ゲート自身が3者以上の同時到達で直列化に失敗していた**: 「先行を読んで await してから自分のゲートを map に書く」方式では、2番目・3番目の呼び出しが同じ「先行」を見た後に互いを追い越し得た。map への書き込みを await 前に同期的に行う keyed-promise-chain へ変更し、N者間の直列化を保証 / Fix the hash-collision gate itself: the original pattern only correctly serialized 2-way contention; a keyed-promise-chain now generalizes to N-way
- **hash ゲートが event.normalized にしか適用されず、同じ非アトミック性を持つ `ShareTarget.ingest` とドシエ import ループが無防備だった**: 共有ヘルパー `withHashGate` を切り出し、findByHash→putEvent を伴う3経路全てが経由するよう統一 / Extend the hash-collision protection to ShareTarget.ingest and the dossier-import loop, not just event.normalized
- **socraticPrompts の tier 優先順位機構(round 23)が tier 内タイブレークで飢餓を再現していた**: 同一 tier 内の条件は相互排他とは限らないため、tier が並ぶと Array.sort の安定性=push 順に戻り元のバグが tier 内で再発。相互排他が保証されない条件に小数のサブ優先度を付与し解消 / Fix within-tier starvation in socraticPrompts' priority sort: non-mutually-exclusive same-tier conditions now get unique decimal sub-priorities
- **新規 WATCH 通知コードが CLAUDE.md のネスト上限(≤3)を超過**: `notifyWatchMatch(ev,matched)` として単体関数に切り出し / Extract the WATCH notification logic to a standalone function to stay within the nesting limit

### Changed
- **GitHub/Zenn の topic slug 正規化前処理を共有ヘルパーへ集約**、**topicFeeds を WORD_FEEDS の `topicStyle:true` から構造的に導出**(3つ目のトピックソース追加が WORD_FEEDS への1行で完結するように)/ Extract shared slug-normalization prefix; derive signalGaps' topicFeeds Set structurally from WORD_FEEDS instead of a separate hardcoded literal

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

#### 視点の転換 — 「知っていること vs 聞いただけのこと」(エピステーメーとドクサ)
収集情報をフラットに日付順で並べる前提を覆す。情報には認識上の重みの差がある:
- 収集元を **信頼の層** に分類: 一次(研究=arXiv)/ 報道(Google News)/ 議論(Reddit・Hacker News)
- WORDS ビューの各単語に出所バッジ(層ごとの件数、研究はアクセント強調)を表示
- 単語ドシエに **`## 出所`** セクション(層ごとの件数)を追加。「何を知り、何を聞いたか」を区別
- `sourceTier()` / `tierBreakdown()` をビュー/出力で共用(議論を報道より先に判定し "Hacker News" の誤分類を回避)

#### 視点の転換 — 「無知の知」(アポリア: 取れなかったものも情報)
収集できたアイテムだけを語り、有効なのに0件だったソースの沈黙を捨てていた前提を覆す:
- **空白(no signal)の可視化** — 有効化したのに今回0件だったソース(Wikipedia含む)を検出
- WORDS ビューの各単語に「空白: arXiv, Reddit」行を表示(初回収集後のみ。沈黙が「まだ収集していない」と混同されるのを防ぐ)
- 単語ドシエに frontmatter `silent` と **`## 空白`** セクションを追加。探究の境界=次にどこを掘るべきかを明示
- `signalGaps()` / `feedLabelOf()` をビュー/出力で共用

#### 視点の転換 — 「語は孤島ではない」(弁証法: 問いの連環)
各単語を独立した島として扱う前提を覆す。一つの定義は他との関係の中にしか立たない:
- **関連語の検出** — ある単語の収集テキスト(タイトル+抜粋)に別の登録語が現れたら「関連」として提示。出現回数でランク
- WORDS ビューの各単語に関連チップ(クリックでその語の収集物へフィルタ移動)
- 単語ドシエに frontmatter `related` と **`## 関連`** セクションを追加。孤立した問いを相互参照の網として可視化
- `relatedWords()` をビュー/出力で共用(ASCII語は語境界一致で `gpu`⊄`webgpu` の誤検出を回避、CJKは部分一致で2字語に対応)

#### 視点の転換 — 「探究は終わりなき蓄積でなく、判断に至るサイクルを持つ」(裁決 / 問い群)
収集を続けるだけで判断に向かわない前提を覆す。問いはいつか答えに至らなければならない:
- **Round 6 — 裁決 (Verdict)**: 各watchwordに verdict ライフサイクルフィールドを追加(open/converging/answered/suspended)。WORDSビューにステータスピルボタンを表示しワンタップでサイクル。ドシエに `verdict_status` / `verdict_note` frontmatterと `## 裁決` セクションを追加(open+メモなしは非表示)
- **Round 7 — 問い群 (Questions)**: 各watchwordに未解決の問い配列を追加。WORDSビューで追加/削除UI。ドシエに `## 問い群` セクションを追加(ソクラテス的「無知の知」の記録)

#### 視点の転換 — 「探究者は中立ではない」(γνῶθι σεαυτόν: 先入観の明示と認識の変容)
観察者が中立であるという前提を覆す。情報収集の前に、あなたはすでに何かを信じている。その先入観を明示することで、探究が自己認識をどう変えたかが見えるようになる:
- **Round 9 — 認識の変容 (Cognitive Shift)**: 単語登録時に **出発点の認識(priorBelief)** を選択(好奇 / 確信 / 懐疑 / 無知)。WORDSビューに先入観→現在の裁決の変容を常時表示(裁決が変化したとき`→`で対比)
- 単語ドシエに frontmatter `prior_belief` と **`## 認識の変容`** セクションを追加。変容があれば「確信 (certain) → 保留 (suspended)」のようにソクラテス的論駁を記録
- `PRIOR_BELIEF_DEFS` / `priorBeliefOf()` / `cognitiveShift()` をビュー/出力で共用
- 探究がself-knowledgeの道具になる: 「信じていたことが崩れた」こと自体が知識の進歩

#### 視点の転換 — 「探究は独白ではない」(elenchus: システムが問い返す)
あなたが問い、ソースが答えるという独白の前提を覆す。ソクラテスの論駁(エレンコス)は対話であり、問いを投げ返して探究者自身の立場の矛盾と空白を暴く:
- **Round 10 — 問答 (Elenchus)**: `socraticPrompts()` が探究の構造(知の階層 / 沈黙 / 裁決 / 先入観 / 未確認件数 / 未解決の問い)を診断し、探究者へ問いを投げ返す純粋関数
- 例: 「一次情報がない。これは事実か意見か?」「裁決後にN件の新証拠。結論はまだ妥当か?」「確信して始めたが未決。何が欠けるか?」「解決としたが未解決の問いが残っている。本当に解決したか?」
- WORDSビューに問答ブロック(アクセント枠)、単語ドシエに **`## 問答`** セクションを追加。重要度順に最大3件
- システムが助産術(maieutics)の役を担う: 答えを与えず、矛盾を問いとして突きつけることで探究者自身の理解を引き出す

#### 視点の転換 — 「問いそのものが暫定的」(elenchus: 問いの彫琢)
問いは一度立てたら不変という前提を覆す。ソクラテスの対話はしばしば最初の問いが混乱していたことを暴き、再定式化を促す。問いを彫琢することが進歩である:
- **Round 11 — 問いの彫琢 (Refining the Question)**: 登録後に編集できなかった問い(note)を、WORDSビューで彫琢可能に(「彫琢」ボタン→インライン入力→保存、Enter送信対応)
- 旧い定式化は `questionHistory` に保存(最大5件)。推敲回数バッジ(推敲 N)をビューに表示
- 単語ドシエに frontmatter `question_revisions` と **`## 問いの変遷`** セクション(旧定式化を打ち消し線、現在の問いを強調)を追加
- `refineQuestion()` 純粋関数で共用(空文字での消去を防止、同一テキストは無変更、前後空白をtrim)
- 副次的に、登録後に問いを一切編集できなかった実用上の欠落を解消

#### 改良 — JSONエクスポートの完全化
MDドシエが探究状態を全て含むのに対し、JSON出力は `term/lang/normalized/wiki` + items のみで、note / priorBelief / verdict / questions / questionHistory / sources / 各種タイムスタンプを取りこぼしていた(JSON出力すると探究状態が消失する不具合):
- **`toWordJson()` 純粋関数を追加**: 探究状態を漏れなく含む自己記述的レコード(`schema:2`)。`word`(全フィールド+安全なデフォルト)+ `analysis`(層/空白/関連/認識の変容/再検討/問答キー/未確認数の派生値)+ `items`
- `downloadJson` をこの関数経由に統一。バックアップ・再取込・機械処理でMDと等価な情報を保持

#### 改良 — 単語ドシエのJSON取込(往復可能に)
完全なJSON出力に対応する取込口を追加し、単語の探究を端末間で移送可能に:
- **`wordFromImport()` 純粋関数**: ドシエJSON(schema 1 旧形式 / schema 2)から word を安全に再構成。kind検証・term必須・配列の型ガード・新フィールドの安全なデフォルト
- WORDSモーダルに **IMPORT** ボタン(隠しファイル入力)を追加。`WordExporter.importJson()` がJSONを解析→単語を復元→付随アイテムも hash で重複排除しつつ取込
- 同名語が既存なら確認の上で置換(既存IDを維持し `word:` タグの整合を保つ)
- i18n(取込 / IMPORT)対応

#### 改良 — WORDSビューの俯瞰サマリ
裁決・再検討・問答・未確認などが各単語に蓄積する中、全探究の状態を一望する手段が無かった:
- **`wordsOverview()` 純粋関数**: 全単語を集計(解決数/総数・要再検討・問答保留・未確認合計・未収集)
- WORDSビュー上部にチップ列で表示。要再検討はアクセント色で強調(`ov-alert`)
- 何に注意を向けるべきか(再検討すべき結論・未読の蓄積)が一目で分かる

#### 改良 — 俯瞰チップで絞り込み
俯瞰チップを操作可能にし、注意すべき単語へ即座に到達できるように:
- 各チップ(解決 / 要再検討 / 問答 / 未確認 / 未収集)をクリックでトグル絞り込み。アクティブ時はアクセント色で反転表示、`解除` チップで全件へ復帰
- `wordMatchesOv()` 純粋関数で判定。集計値(チップ表示)は常に全件基準、絞り込みは表示セクションのみに適用
- 関連語検出は絞り込み中も全単語を対象に維持(孤立を防ぐ)


#### 視点の転換 — 「裁決は一度下せば不変ではない」(エレンコスの自己適用: 再検討)
下した結論はそのまま正しいという前提を覆す。真の知は反復的な再検討に耐えねばならない。エレンコスを他者でなく *自らの結論* に向ける:
- **Round 8 — 再検討 (Re-examination)**: 裁決を下した時刻 `verdictAt` を記録。決着済み(answered / suspended)の語に、その後到来した新証拠(`timestamp > verdictAt`)があれば WORDS ビューに **再検討バッジ(件数つき)** を表示
- バッジをクリックすると裁決を `open` に戻し探究を再開(`data-wact="reexamine"`)。converging は進行中とみなし対象外
- 単語ドシエに frontmatter `reexamine` と `## 裁決` セクション内の「再検討」行を追加。「結論後に何件の反証が来たか」を可視化
- `verdictStale()` / `SETTLED_VERDICTS` をビュー/出力で共用

### Added
- Round 6 — 裁決 (Verdict): verdict lifecycle field on each watchword (open/converging/answered/suspended), with pill button to cycle status and dossier export support
- Round 7 — 問い群 (Questions): open questions array on each watchword, with add/remove UI and dossier export support
- Round 8 — 再検討 (Re-examination): verdictAt timestamp; settled verdicts (answered/suspended) flag new evidence arriving afterward with a re-examine badge that re-opens the inquiry, plus dossier `reexamine` frontmatter

#### 改良 — 現段階の短所の洗い出しと修正
収集機能の堅牢性とUIの一貫性に関する課題を洗い出して修正:
- **収集の同時実行ガード**: 手動COLLECT / POLLボタン / periodicsync が重なると同一フィードを二重取得し帯域を浪費、件数トーストも崩れていた。`WordCollector` に `busy` ロックを追加し直列化(`isBusy()` 公開、公開 `collectOne`/`collectAll` はロック取得、内部 `_collectOne` はロックなし)
- **件数表示の正直化・一貫化**: `collectOne` の戻り値は重複排除前の生取得数のため「collected N」は過大表示だった。トーストを「取得 / fetched」表記に修正し、フィールドを `lastCount` → `lastFetched` に改名。WORDSモーダルの件数を保存済み実数(タグ集計)に変更しWORDSビューと一致させた
- **再検討の取り消し可能化**: 再検討バッジのクリックは決着済み裁決を一発で `open` に戻す破壊的操作だった。`UndoStack` でロールバック可能に(誤操作復旧)

#### 改良 — アクセシビリティとキーボード操作の対等性(Apple HIG)
動的生成される単語コントロールのa11yギャップを洗い出して修正:
- **aria-label の付与**: 裁決ピル(現在の状態を読み上げ)/ 再検討バッジ(件数+理由)/ 関連チップ / 提案チップ / 問い入力欄 / 問い削除ボタンに `aria-label` を追加。アプリ他箇所(検索・キーワード入力等)の慣習に一致させた。これまで `title` のみでスクリーンリーダーに伝わりにくかった
- **問い入力のEnter送信**: インラインの問い入力欄は「+ Q」ボタンのクリックでしか追加できずキーボードのみで完結しなかった。`#view` の keydown ハンドラで Enter 送信に対応し `enterkeyhint="done"` を付与

#### 改良 — 語の正規化強化(重複登録防止)
同じ語が表記揺れで二重登録される穴を塞いだ:
- **`normalizeTerm()` を導入**: NFKC正規化(全角/半角・互換文字の統一)+ 内部空白の畳み込み + trim + 小文字化。「ＷｅｂＧＰＵ」「Web  GPU」「 WebGPU 」を同一キーに収束させ重複登録を防ぐ
- 表示用 `term` は生のまま保持し、照合・タグ付けには `normalized` のみを使用(従来動作を維持)
- 登録の全入口(addWord / 提案チップの登録 / 提案ランカー `rankWordSuggestions`)で共用。ASCII単語では従来と同一結果のため既存データは非破壊

#### Tests
- `tests/word-normalize.test.mjs`(NFKC全角畳み込み / 空白畳み込み / CJK保持 / 表記揺れ収束 / 別語の非衝突 / ワイヤリング)
- `tests/word-a11y.test.mjs`(単語コントロールのaria-label + 問い入力のEnter送信・enterkeyhintワイヤリング)
- `tests/word-collector-guard.test.mjs`(busyロックの直列化モデル + 例外時のロック解放 + ガード/件数/Undoワイヤリング)
- `tests/word-feeds.test.mjs`(フィードURL生成 + ソースドリフトガード + 失敗トラッカー除外 + Wikipediaフォールバック順)
- `tests/word-dossier.test.mjs`(ドシエMarkdown生成 + slug)
- `tests/word-collect-integration.test.mjs`(フィードXML→パース→word:タグ付与→ドシエ出力のE2Eをjsdomで検証)
- `tests/word-verdict.test.mjs`(VERDICT_DEFS / verdictOf / nextVerdict / toDossier裁決セクション)
- `tests/word-questions.test.mjs`(問い群セクション生成 + addq/delq UIワイヤリング確認)
- `tests/word-reexamine.test.mjs`(verdictStale / 境界条件 / reexamine UI・ドシエワイヤリング)

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
