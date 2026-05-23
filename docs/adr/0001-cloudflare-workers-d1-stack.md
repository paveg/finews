# ADR-0001: Cloudflare Workers + D1 + Hono + Drizzle をプラットフォームに採用する

## Status

Accepted (2026-05-23)

## Context

finews は平日朝・週次・月次に金融ニュースダイジェストを Discord 配信する個人向けパイプライン。以下を満たす実行基盤が必要。

- 月額固定費を $20 以内に抑えたい(個人プロジェクト)
- Cron で1日数回起動するスケジュールジョブ
- 構造化データを蓄積し、過去文脈として再利用したい
- RSS取得・LLM呼び出し・Discord配信を 1 ジョブ内で直列実行
- TypeScript で書きたい

選択肢:
1. **Cloudflare Workers + D1 + Hono + Drizzle (採用)**
2. AWS Lambda + DynamoDB or RDS
3. Fly.io + Postgres
4. 自宅サーバー + cron

## Decision

**Cloudflare Workers (Paid) + D1 + Hono + Drizzle ORM + Valibot** で構築する。

選定根拠:

- **Workers Paid プラン $5/月**で 10M リクエスト + 30M CPU ミリ秒込み。finews の負荷(月数千リクエスト)では実質固定費
- **D1** は SQLite 互換、5GB / 25億行read / 5000万行write の無料枠が finews のデータ規模を十分カバー
- **Hono** はエッジ環境に最適化された軽量フレームワーク、Cloudflare 公式テンプレートが豊富
- **Drizzle ORM** は D1 ファーストクラスサポート、マイグレーション生成が標準化
- **Valibot** はバンドルサイズが小さく(zod の 1/10)、Workers のスクリプトサイズ制限に優しい
- Cron Triggers が組み込みでスケジューラ不要
- **Cron Trigger は `>=1h interval` で CPU 15分まで利用可能**、かつ `fetch()` 等の I/O 待ちは CPU 時間に算入されない([Workers limits](https://developers.cloudflare.com/workers/platform/limits/))。LLM 呼び出しが多くても余裕

## Consequences

### Positive

- 月額 $5(Workers) + $10-12(Anthropic) = **約$15-17/月** で運用可能
- インフラ運用ゼロ(サーバー監視・更新不要)
- ローカル開発は `wrangler dev` で完結、デプロイは `wrangler deploy`
- D1 は SQLite なので、本番データをローカルにダウンロードしてデバッグ可能

### Negative

- Workers の **30秒CPU 制限** は HTTP リクエストに対するもの。Cron では緩和されるが、設計時にバッチ処理を意識する必要あり
- D1 の書き込みは結果整合性、強整合が必要なケースでは注意
- Cloudflare のスクリプトサイズ制限 1MB(gzip後) を意識(依存追加時に確認)
- 外部HTTPアクセスは Cloudflare の IP レンジから出るため、**サイトによっては Bot 検出でブロックされる**(検証必要 — 特に金融ニュースサイト、ETF発行体)

### 検証 TODO

- [ ] 実 Workers 環境から Reuters/Nikkei/iShares への fetch が成功するか(Claude Code WebFetch はブロックされたが、Workers では成功する可能性が高い)
- [ ] D1 のクエリパフォーマンス(`articles` テーブルが10万件規模になった時の挙動)
