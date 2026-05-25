# 値動きシグナル + ウォッチリスト改善 設計書

| 項目 | 内容 |
|---|---|
| Date | 2026-05-26 |
| Scope | Phase 1.5 の一部: 価格データ取得、ウォッチリスト改善、Stage 2 統合、フィードバック基盤 |
| 対象外 | ドメイン拡張(4 領域)、weekly/monthly ジョブ、Gemini 切替、休場日処理 |
| 関連 | [Phase 1 設計書](2026-05-23-finews-design.md) / [Phase 1.5 メモ](2026-05-24-phase-1.5-handoff.md) |

## 1. 価格データ取得（Stooq fetcher）

### データソース

Stooq CSV API を採用する。

- エンドポイント: `https://stooq.com/q/l/?s={symbols}&f=sd2t2ohlcv&h&e=csv`
- 認証: 不要
- レート制限: 公式な契約なし（1 日 1 回 14 銘柄程度なら問題なし）
- レスポンス: `Symbol,Date,Time,Open,High,Low,Close,Volume` の CSV
- 複数銘柄を **`+` 区切り**で 1 リクエスト取得可能（`,` は動作しない）

採用理由: 米日株 + ETF + 為替 + 指数をカバーする無料ソースで認証不要なのは Stooq のみ。
Finnhub/Twelve Data は日本株が無料枠外。Yahoo Finance v8 は非公式 API でブロックリスクあり。
正式 API 契約がない点は、Phase 2 で有料ソースへの切替オプションを残す。

**VIX の補完**: Stooq に VIX は存在しない（2026-05-26 検証済み）。
VIX のみ Yahoo Finance v8 (`https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?range=1d&interval=1d`)
で best-effort 取得する。失敗時は VIX 行を `N/A` として続行。

### 検証結果（2026-05-26 実施）

| シンボル | 結果 | 備考 |
|---|---|---|
| NVDA.US | ✅ $215.33 | |
| AMD.US | ✅ $467.51 | |
| TSM.US | ✅ $404.52 | |
| SOXX.US | ✅ $537.33 | |
| 6857.JP | ✅ ¥26,845 | |
| 285A.JP | ✅ ¥57,400 | |
| ^SPX | ✅ 7,473.5 | caret は URL encode (%5E) |
| USDJPY | ✅ 158.90 | |
| ^VIX | ❌ N/D | Stooq DB に存在しない → Yahoo v8 で補完 |

### ティッカー変換

| 入力 (watchlist) | Stooq 形式 | ルール |
|---|---|---|
| `NVDA` | `NVDA.US` | market=us → `.US` 付与 |
| `6857.T` | `6857.JP` | market=jp → `.T` を `.JP` に置換 |
| `285A.T` | `285A.JP` | 同上 |
| `SOXX` | `SOXX.US` | market=us → `.US` 付与 |

変換ロジックは `fetchers/market.ts` 内に閉じる。

### コンテキスト指標（ウォッチリスト外）

ニュースマッチングには使わず、Stage 2 に「市場背景」として渡す。

| 指標 | Stooq シンボル | ソース | 用途 |
|---|---|---|---|
| S&P 500 | `^SPX` | Stooq | 米国市場全体の方向性 |
| 日経平均 | `^NKX` | Stooq | 日本市場全体の方向性（JP 個別株の文脈） |
| USD/JPY | `USDJPY` | Stooq | 為替（日本株の実質リターンに影響） |
| VIX | `^VIX` | Yahoo v8 | 恐怖指数（市場ストレス） |

### 前日比の計算

- D1 `marketSnapshots` テーブルから前日の `price` を取得
- `changePct1d = (todayClose - yesterdayClose) / yesterdayClose * 100`
- 初回（前日データなし）は `changePct1d = null`

### パイプライン上の位置

`daily.ts` の RSS fetch と **並列実行**。Stage 2 の前に完了していればよい。

```
RSS fetch ─────┐
               ├─→ Stage 1 → Stage 2 → Discord
Market fetch ──┘
```

### エラーハンドリング

- Stooq 失敗時も RSS ニュースパイプラインは続行する
- 価格データなしの場合、Stage 2 には「価格データ: 取得失敗」と渡す
- `deliveries` に `status: 'partial'`（ニュースは成功、価格は失敗）を記録

### 新規ファイル

- `apps/worker/src/fetchers/market.ts`

## 2. ウォッチリスト改善

### 型変更

`config/watchlist.ts` を以下の型に変更する。

```ts
type WatchlistEntry = {
  ticker: string;       // 正規ティッカー (NVDA, 6857.T)
  market: 'us' | 'jp';
  aliases: string[];    // 日本語名・英語名の表記揺れ
};
```

### 銘柄リスト

| ticker | market | aliases |
|---|---|---|
| NVDA | us | Nvidia, エヌビディア |
| AMD | us | Advanced Micro Devices, アドバンスト・マイクロ |
| TSM | us | TSMC, 台湾セミコンダクター, 2330.TW |
| AAPL | us | Apple, アップル |
| MSFT | us | Microsoft, マイクロソフト |
| GOOGL | us | Google, Alphabet, グーグル |
| 6857.T | jp | アドバンテスト, Advantest |
| 8035.T | jp | 東京エレクトロン, Tokyo Electron, TEL |
| 285A.T | jp | キオクシア, Kioxia, KIOXIA |
| SOXX | us | iShares Semiconductor ETF |
| SMH | us | VanEck Semiconductor ETF |

### マッチングロジック

`matchers/watchlist.ts` を改善する。

1. Stage 1 の `tickers` がウォッチリストの `ticker` に完全一致 → マッチ
2. Stage 1 の `ticker_aliases_used` がウォッチリストの `aliases` に含まれる → マッチ
3. いずれもケース非感知、全角→半角正規化あり

### 変更ファイル

- `apps/worker/src/config/watchlist.ts` — 型変更 + 銘柄追加
- `apps/worker/src/matchers/watchlist.ts` — alias マッチング対応

## 3. Stage 2 統合（値動き + 強気/弱気シグナル）

### Stage 2 プロンプト変更

`stage2DailyUser` 関数に価格テーブルを追加する。

```
# ウォッチリスト銘柄の値動き
| 銘柄 | 終値 | 前日比 |
|------|------|--------|
| NVDA | $131.28 | +2.3% |
| 285A.T | ¥2,145 | -1.1% |
...
```

`STAGE2_DAILY_SYSTEM` プロンプトに以下を追記する。

```
【値動きシグナル】
5. ウォッチリスト銘柄の値動きデータが提供された場合:
   - ニュースとの因果関係がある値動きを紐付けて解説する
   - 値動きの方向（上昇/下落）と記事内容から、短期的な強気/弱気の見立てを述べる
   - 見立ては必ず「〜と見られる」「〜の可能性がある」で表現し、断定しない
   - 値動きデータが無い銘柄について値動きを創作しない
6. ダイジェスト末尾に「📊 ウォッチリスト速報」セクションを追加:
   - 全銘柄の終値・前日比を一覧表示
   - ニュースに関連する銘柄には一行コメントを付記
```

### Stage 2 出力構造

3 セクションに分割して出力させる。セパレータ `---SECTION---` で区切る。

1. **概要**: ドメインタイトル + 上位記事の見出し + ウォッチリスト速報テーブル
2. **詳細**: 各記事の分析（事実・なぜ重要・読み解きポイント・強弱コメント）
3. **用語**: 今日の用語

コード側で `---SECTION---` で split し、3 メッセージに振り分ける。
セパレータが含まれない場合（LLM が無視した場合）は全文を 1 メッセージで送る fallback。

### コスト影響

Stage 2 の input tokens が +200-300 程度（価格テーブル分）。月額 +$0.3 程度。

### 変更ファイル

- `apps/worker/src/summarizer/prompts.ts` — プロンプト変更
- `apps/worker/src/summarizer/stage2_daily.ts` — 価格データ引数追加
- `apps/worker/src/jobs/daily.ts` — 価格データを Stage 2 に渡す

## 4. Discord 出力（Forum チャンネル）

### 前提

- Discord に Forum チャンネルを新設し、Webhook をそのチャンネルに設定する（手動操作）
- 自動アーカイブ: 24 時間
- 既存の `DISCORD_WEBHOOK_URL` シークレットを新しい Webhook URL に更新する

### 投稿フロー

```
1. POST webhook?wait=true  { thread_name: "2026-05-26 半導体ダイジェスト", embeds: [概要] }
   → レスポンスから channel_id (= スレッド ID) を取得

2. POST webhook?thread_id={id}  { content: 詳細分析テキスト }
   → 250ms 待機

3. POST webhook?thread_id={id}  { content: 今日の用語テキスト }
```

### 投稿内容

| 投稿 | 形式 | 内容 | 文字数目安 |
|---|---|---|---|
| 1 (概要) | embed | ドメインタイトル + 見出し一覧 + ウォッチリスト速報 | 1,500 文字 |
| 2 (詳細) | plain text | 各記事の詳細分析 + 強弱コメント | 2,000 文字 |
| 3 (用語) | plain text | 今日の用語 | 300 文字 |

### エラーハンドリング

- 1 投稿目が失敗した場合はスレッド作成自体が失敗。`deliveries` にエラー記録
- 2, 3 投稿目が失敗した場合は概要だけ届いた状態。ログで検知可能
- Webhook レート制限（5 req / 2 秒）には 3 投稿なら問題なし

### 変更ファイル

- `apps/worker/src/notifier/discord.ts` — `sendForumDigest` 新設、`sendDailyEmbed` は残す（fallback / テスト用）

## 5. フィードバック基盤

### 方針

LLM 追加コールなし。既存 D1 データ + Workers Observability ログで定量分析する。

### 測定指標

| 指標 | データソース | アラート基準 |
|---|---|---|
| Stage 1 パース成功率 | extracted 数 / fetch 数 | < 95% |
| significance 分布 | `articles.extractedJson` | 全件 sig=3 に偏っている |
| ソース別ヒット率 | `articles.source` | 特定ソースが 3 日連続 0 件 |
| ウォッチリスト関連率 | `articles.watchlistMatched` | < 10% |
| 1 回あたりコスト | `deliveries.costUsdMicro` | > $0.30（想定の 2 倍） |
| Stage 2 出力文字数 | ログ出力 | < 500 文字 or > 3,500 文字 |
| 価格データ取得成功率 | ログ出力 | < 80% |

### 実装

`daily.ts` の既存 `console.log` を拡充する。追加するフィールド:

- `watchlistMatchedCount`: ウォッチリストマッチ記事数
- `stage2OutputChars`: Stage 2 出力文字数
- `priceDataFetched`: 価格データ取得成功銘柄数

Workers Observability（有効化済み）で永続ログとして残る。

分析タイミングは手動。1 週間運用後に Cloudflare Dashboard Logs で確認、
もしくは D1 に直接クエリ（`SELECT * FROM deliveries ORDER BY attempted_at DESC LIMIT 30`）。

### 変更ファイル

- `apps/worker/src/jobs/daily.ts` — ログ出力拡充のみ

## 6. 手動操作（デプロイ前）

1. Discord に Forum チャンネル「finews-digest」を作成
2. そのチャンネルに Webhook を作成
3. `wrangler secret put DISCORD_WEBHOOK_URL` で新しい Webhook URL を設定
4. Forum チャンネルの自動アーカイブを 24 時間に設定

## 7. ファイル変更一覧

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `apps/worker/src/fetchers/market.ts` | 新規 | Stooq CSV 取得 + パース |
| `apps/worker/src/config/watchlist.ts` | 変更 | 型変更 + 銘柄追加 |
| `apps/worker/src/matchers/watchlist.ts` | 変更 | alias マッチング対応 |
| `apps/worker/src/summarizer/prompts.ts` | 変更 | 値動きプロンプト追加 + 3 セクション分割指示 |
| `apps/worker/src/summarizer/stage2_daily.ts` | 変更 | 価格データ引数追加 |
| `apps/worker/src/notifier/discord.ts` | 変更 | `sendForumDigest` 新設 |
| `apps/worker/src/jobs/daily.ts` | 変更 | 価格 fetch 並列化 + Stage 2 連携 + ログ拡充 |

### テスト

| テスト | 対象 |
|---|---|
| `test/fetchers/market.test.ts` | Stooq CSV パース（fixture ベース） |
| `test/matchers/watchlist.test.ts` | alias マッチング（完全一致、alias 一致、全角半角、大文字小文字） |
| `test/notifier/discord.test.ts` | Forum 投稿フロー（`?wait=true` レスポンスパース、`thread_id` 付与） |

Stage 2 プロンプト変更のテストは fixture ベースの Stage 1 テスト（既存）で間接確認。
Stage 2 自体は LLM 出力のため自動テスト対象外（手動検証 + フィードバック指標で品質担保）。

## 8. コスト影響

| 項目 | 変化 |
|---|---|
| Stooq API | $0（無料） |
| Stage 2 input tokens | +200-300 tokens/回（価格テーブル分） |
| 月額影響 | +$0.3 程度 |
| Discord 投稿数 | 1 → 3 メッセージ/日（Webhook 無料枠内） |
