# ADR-0006: コストスパイクガードレールを多層防御で実装する

## Status

Accepted (2026-05-23)

## Context

個人プロジェクトでも以下のシナリオでコストが暴走する。**設計レビュー時の見落としで、当初設計には明示的対策が無かった**。

- RSS が破損して大量(100件超)の記事を返す
- Anthropic API の 429/500 でリトライループが暴走
- ジョブ実装の bug で無限ループ
- Discord webhook 失敗 → ジョブ全体リトライ → Anthropic 二重呼び出し
- ローカル開発中に scheduled handler を誤発火

設計書の絞り込み(上位25件、significance ≥ 3)はソフトキャップで、防御ではない。**1日で月予算を食い潰す事故を防ぐには、コード側と API 設定側の多層防御が必要**。

選択肢:
1. **多層防御(Console 月予算 + ジョブ内ハードリミット + リトライ上限)** — 採用
2. Anthropic Console の月予算設定のみに頼る — 1日で月予算消費の事故は防げない
3. 外部の budget guard ライブラリを導入 — 過剰

## Decision

3 層の防御を組み合わせる。

### Layer 1: Anthropic Console の月予算上限

`console.anthropic.com/settings/billing` で **monthly spend limit = $20 USD** を設定。API レイヤーの最後の砦で、コード側の対策が全て失敗しても**月 $20 を超えて課金されない**。50% / 80% / 100% で email 通知も設定。

これは**コードを書く前に**ユーザーが手動で行う(Phase 1 Task 14 の最後)。

### Layer 2: ジョブ内ハードリミット (`config/budget.ts` + `lib/budget-guard.ts`)

各ジョブで以下のリミットを超えたら即停止:

```typescript
// apps/worker/src/config/budget.ts
export const BUDGET = {
  MAX_STAGE1_CALLS_PER_JOB: 30,      // Stage 1 (Haiku) 呼び出し回数
  MAX_STAGE2_CALLS_PER_JOB: 5,       // Stage 2 (Sonnet) 呼び出し回数
  MAX_INPUT_TOKENS_PER_JOB: 200_000, // 累計 input tokens
  MAX_OUTPUT_TOKENS_PER_JOB: 50_000, // 累計 output tokens
  MAX_RETRIES: 3,
  BACKOFF_BASE_MS: 1000,
} as const;
```

リミット値の根拠(daily ジョブ典型):

| 指標 | 通常値 | リミット | 余裕 |
|---|---|---|---|
| Stage 1 呼び出し | 15-25 | 30 | 安全 |
| Stage 2 呼び出し | 1-4 | 5 | 安全 |
| Input tokens | 30-50k | 200k | 4倍以上 |
| Output tokens | 10-15k | 50k | 3倍以上 |

`BudgetTracker` クラスを実装し、各 API 呼び出し前に許可確認、呼び出し後に usage を加算。リミット到達時は `BudgetExceededError` を投げる。

handler 側は `BudgetExceededError` を捕捉して **静かに skip + deliveries に `status: 'budget_exceeded'` を記録** + 可能なら**Discord に「予算上限到達」通知**を送る(これは小さいプレーンテキストメッセージ、Anthropic を再呼び出ししない)。

### Layer 3: リトライポリシー (`lib/retry.ts`)

```typescript
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; backoffMs?: number; tracker: BudgetTracker },
): Promise<T>
```

- 最大 3 回(`BUDGET.MAX_RETRIES`)
- backoff: 1s, 2s, 4s (exponential)
- リトライ対象 HTTP status: `429, 500, 502, 503, 504` のみ
- `400, 401, 403, 404` は即 throw(永続エラーをリトライしない)
- **リトライも `tracker` に加算**(リトライ暴走防止)

### deliveries テーブル拡張

```typescript
// db/schema.ts (immutable single-event テーブル: attemptedAt が唯一のドメインイベント)
const timestampDefault = () => new Date().toISOString();

export const deliveries = sqliteTable('deliveries', {
  id: text('id').primaryKey(),
  jobType: text('job_type').notNull(),
  step: text('step').notNull(),
  status: text('status').notNull(),       // 'success' | 'failed' | 'skipped' | 'budget_exceeded'
  error: text('error'),
  durationMs: integer('duration_ms'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  costUsdMicro: integer('cost_usd_micro'),// 10^-6 USD 単位
  attemptedAt: text('attempted_at').notNull().$defaultFn(timestampDefault),
});
```

毎ジョブのトークン使用量とコスト概算を残し、異常検知の事後分析に使う。タイムスタンプは ISO 8601 UTC(text)。`deliveries` は insert 専用なので、Drizzle ハーネスの「immutable single-event」例外に該当し `createdAt` + `updatedAt` ペアは不要。

### コスト計算

```typescript
// lib/budget-guard.ts 内
const MODEL_PRICING = {
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-sonnet-4-6':         { input: 3, output: 15 },
  'claude-opus-4-7':           { input: 5, output: 25 },
} as const;

function estimateCostMicroUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = MODEL_PRICING[model];
  if (!p) return 0;
  // $X / MTok = X / 1_000_000 USD/token = X micro USD/token
  return Math.ceil(p.input * inputTokens + p.output * outputTokens);
}
```

## Consequences

### Positive

- 月予算が3層で保護され、設計の他の部分(絞り込み等)が壊れても安全
- `deliveries` テーブルでトークン・コストの事後集計が可能
- リトライポリシーが明示的、各ジョブの予測可能性が高い
- Anthropic Console の月予算は無料で設定可能(必ず先にやる)

### Negative

- `BudgetTracker` のテストが必要(ハードリミット到達時の挙動確認)
- `budget_exceeded` で skip すると、その日のダイジェストが届かない or 部分配信になる(対策: 予算上限到達 Discord 通知)
- ローカル開発で大量呼び出しすると本番月予算を消費する
  → 対策: 別 Anthropic API key(開発用、別予算 $5)を `.dev.vars` で使い分ける

### 運用ポイント

- 月初に `SELECT SUM(cost_usd_micro)/1000000.0 AS usd FROM deliveries WHERE attempted_at > strftime('%s', 'now', '-30 days')*1000` で前月総コスト集計
- Anthropic Console の月予算通知(50%/80%)を email 受信設定
- 1 ジョブで `tokens > MAX_*` が連続発生したら、絞り込みロジック(`config/sources.ts` の上位件数、`significance` 閾値)を見直し
- `status = 'budget_exceeded'` のレコードが週1回以上出るなら、リミット値の引き上げではなく**異常検知**(RSS の品質劣化、プロンプト bug)を疑う

### Phase 1 への組み込み

- 新規 Task: `Task 6.5: Budget guard 実装`(Task 6 の後、Task 7 の前)
- Task 3 (Drizzle schema) の `deliveries` 定義に 3 カラム追加
- Task 13 (daily ジョブ) で `BudgetTracker` を全 API 呼び出しに適用
- Task 14 で **Anthropic Console 月予算 $20 設定** を必須手順に
