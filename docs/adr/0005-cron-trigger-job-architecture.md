# ADR-0005: ジョブは Cron Trigger 直叩きで実装、Queues/Workflows は使わない

## Status

Accepted (2026-05-23)

## Context

設計レビュー初期段階では「朝刊で記事20本 × Stage 1 + Stage 2 = 60秒以上、Workers 30秒CPU 制限を超える」という懸念があり、Cloudflare Queues や Workflows の導入を検討していた。

しかし [Workers limits documentation](https://developers.cloudflare.com/workers/platform/limits/) で確認したところ、想定が誤っていた。

| 起動経路 | CPU 上限 |
|---|---|
| HTTP リクエスト | デフォルト 30 秒、最大 5 分 |
| **Cron Triggers (interval < 1h)** | 30 秒 CPU |
| **Cron Triggers (interval >= 1h)** | **15 分 CPU** |

加えて重要な仕様:

> "Waiting on network requests (such as `fetch()` calls, KV reads, or database queries) does not count toward CPU time"

つまり Anthropic API 呼び出し・RSS fetch・Discord Webhook の **I/O 待ち時間は CPU 時間にカウントされない**。Stage 1 を 20 回呼ぶ場合、ネットワーク待ちは累計 60-120 秒でも、Worker 自身が消費する CPU 時間は数秒のオーダー。

finews のすべての Cron は **>=1h interval**:

- daily `30 21 * * 0-4` (1日1回)
- market `0 22 * * 0-4` (1日1回)
- weekly `30 23 * * 5` (週1回)
- monthly `0 0 1 * *` (月1回)

→ **全ジョブで 15 分 CPU 利用可能**。Queues/Workflows は不要。

## Decision

**Cron Trigger の `scheduled` handler に直接ロジックを書く**。Queues/Workflows は導入しない。

```typescript
// src/index.ts
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const cron = event.cron;
    switch (cron) {
      case '30 21 * * 0-4': return ctx.waitUntil(runDaily(env));
      case '0 22 * * 0-4':  return ctx.waitUntil(runMarket(env));
      case '30 23 * * 5':   return ctx.waitUntil(runWeekly(env));
      case '0 0 1 * *':     return ctx.waitUntil(runMonthly(env));
    }
  },
} satisfies ExportedHandler<Env>;
```

### CPU 効率化の実装方針

CPU は余裕があるが、**API レート制限とジョブ完了時間**は意識する:

1. **Stage 1 並列度 3**: Promise.allSettled で同時 3 記事処理。Anthropic API のレート制限(Tier 1 で 50 req/min)に余裕を持たせる
2. **記事絞り込み**: RSS 取得後、`significance` フィールドが無い段階では `priority * recency` でソートし上位 25 件のみ Stage 1
3. **Stage 2 のドメイン別呼び出し**: 4 ドメイン × 各 Stage 2 を直列(プロンプトキャッシュ TTL 5 分内で実行するため)
4. **Discord 配信は `waitUntil`**: handler 本体終了後も配信が走るようにする

### Phase 2 で導入を検討する条件

- 朝刊ジョブが 14 分(CPU 限界の 90%)を超え始めたら Queues 移行を検討
- LLM プロバイダ多重化(Anthropic + Bedrock など)で並列度を上げたい時

## Consequences

### Positive

- インフラ構成がシンプル(wrangler.toml の bindings が D1 1個のみ)
- ローカル開発が `wrangler dev --test-scheduled` で完結
- 障害解析が容易(ジョブ全体が1関数の中に閉じる)
- 追加コストゼロ(Queues 1M 操作/月 込みだが、ops の見積もり不要)

### Negative

- ジョブ実装が長くなり、1ハンドラ数百行になる可能性。早期にモジュール分割が必要
- CPU 15 分を意識せず無計画にループを書くと CPU 超過する(早期にメトリクス計測を入れる)
- リトライ戦略を自前で書く必要がある(Queues なら自動リトライがある)

### モニタリング

- 各ジョブの開始・終了を `console.log({ job, durationMs, articlesProcessed })` で出力
- D1 の `deliveries` テーブルに `attemptedAt` + `status` を残し、後で失敗パターンを集計
- Phase 2 で Cloudflare Workers Analytics Engine への移行を検討
