# きょうのAI — Free X Fetcher

無料・read-onlyのX候補発見用Fetcherです。Sites MCPとはadapter境界で接続し、DotsへCookieや依存パッケージを渡しません。Xへの投稿・返信・DM・フォロー・like・repost・削除機能はありません。本番で選択できるbackendはCookie readとsnapshotのみです。

## 現在の状態

コード配置・Cookieなしのテストまで。実X取得と未知話題PoCは、所有者のSecret入力後に実証します。Sitesではアカウント投稿と指定投稿の回帰に成功していますが、SearchTimelineは所有者のLatest設定を反映しても404でした。GitHub環境で成功するとは仮定しません。

`Read-only checks` はmainのコード更新時にXへ接続せずテストします。`Free read-only X capture` は手動実行または `control/capture-request.json` の明示更新時だけ起動します。定時実行はまだありません。Public repoの標準ubuntu-24.04、Node22、5分上限、追加npm依存・artifact・cache・larger runnerは使いません。

## 所有者に必要な入力

このrepoの Settings → Secrets and variables → Actions → New repository secret に、観測用Xアカウントの `auth_token` を `X_AUTH_TOKEN`、`ct0` を `X_CT0` として直接登録します。Cookie値を会話、コード、ログ、Dotsへ送りません。Sites Secretの値をこちらで取得・コピーしません。

入力後は「2つ設定した」とだけ伝えてください。こちらで明示runを起動し、アカウント＋期間のみの回帰と人物指定なし36h探索を行います。追加の有料credentialやbilling設定は不要です。手動実行する場合はActionsの `Free read-only X capture` → Run workflowを使えます。

## 出力と判定

- `data/x-scout-acceptance.json`: URL/IDを事前入力しない回帰、直近36h未知探索、構造化投稿、能力別失敗。ログは状態・件数のみ。
- `data/x-scout-snapshot.json`: Watchlistと `fetcher/plan.json` の当日entities/queries、広い未知検索。本文は候補資料で、原典・媒体Gap未確認です。
- 本文・投稿者・日時・元URL・reply/quote/repost関係・画像/動画/link metadataを保持。対象以外の個人プロフィールは返しません。
- 検索だけ失敗しても成功したWatchlistを保存。認証切れ・明示access制限・rate limitは停止し、回避や有料fallbackを行いません。
- 複数の実候補の一次資料と主要媒体Gapを確認するまで、未知探索PoCを合格にしません。

Publicで見えるのはコード、Watchlist、検索plan、公開投稿の正規化データです。Cookieの実値はSecretsに限ります。GitHubへの結果保存はGitHubのwriteであり、Xへのwrite機能はありません。

## 検査

```sh
node --test tests/scout.test.mjs tests/free-backend.test.mjs
```

既存48テストは維持。`tests/legacy/` の旧API/bridgeはテスト用のみで、本番からimport・選択できません。追加テストはCookie漏洩、許可read操作、障害分離、schema、時刻、重複、snapshot、無料Fetcherを検証します。

## Siteとの接続

実取得の検証後、Siteの `X_SCOUT_BACKENDS=snapshot` と `X_SCOUT_SNAPSHOT_URL=https://raw.githubusercontent.com/aichokan-publisher/kyounoai-x-fetcher/main/data/x-scout-snapshot.json` を設定して再公開します。現時点ではまだ切り替えません。6ツールschema v1.0.0を維持します。

snapshotは30h超でSNAPSHOT_STALE、未収集queryはSNAPSHOT_QUERY_NOT_CAPTURED。当日の新しいTopic Laneは `fetcher/plan.json` をcapture前に更新する必要があり、snapshotは任意queryの即時検索を保証しません。成長履歴は外部Fetcherでは持たずunknownです。

Watchlistは `config/watchlist.json`。x-nativeから参考・移植したread patternsのMIT noticeは `docs/vendor/x-native-LICENSE.txt` にあります。追加のlogin automation、CAPTCHA/transaction ID生成、proxy・アカウント回転は実装しません。
