# ADR-0025 — Electron デスクトップ版

- **Status**: Accepted

## 背景

Neus の正規の配布形態を Windows、macOS、Linux 向けのデスクトップアプリとする。既存の画面とロジックには Web/PWA 版と同じファイルを使う。

## 決定

- Electron と electron-builder は開発依存としてバージョンを固定する。更新時にはロックファイルを更新する。
- Electron が `http://neus.localhost/` 宛てのリクエストに内部で応答する。Chromium は `.localhost` を安全なオリジンとして扱うため、IndexedDB、マニフェスト、Service Worker を使える。配信対象は HTML、マニフェスト、Service Worker の固定リストに限る。
- レンダラーはサンドボックスとコンテキスト分離を有効にし、Node.js 統合と preload は使わない。外部ナビゲーションと新規ウィンドウを阻止し、別ウィンドウを要求した HTTP(S) リンクは既定のブラウザーに渡す。

## 比較

- `file://` で直接開く方式では、ルート相対のマニフェスト参照と Service Worker 登録を維持できない。
- `app://` などの独自スキームでは、既存の Service Worker が使う Chromium の Cache API がリクエストを拒否する。
- ループバック HTTP サーバーを起動する方式では、安定した保存領域のために固定ポートが必要になり、ポート競合やローカルの別プロセスからのアクセスを扱う必要がある。
- Electron が内部で応答する方式では、待ち受けポートを使わずに同じアプリファイルを固定オリジンで読み込める。

デスクトップ配布に関する判断は ADR-0004 を更新する。Web のデプロイとモバイル PWA の配布は従来どおり。
