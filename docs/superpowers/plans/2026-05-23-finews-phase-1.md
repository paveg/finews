# finews Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 平日朝(JST 6:30) に 1 領域(半導体)以上のニュースダイジェストが Discord に届く最小実装を完成させる。

**Architecture:** Cloudflare Workers (Paid) + D1 + Hono を pnpm workspace に置き、Cron Trigger 直叩きで RSS → Stage 1 (Haiku) → Stage 2 (Sonnet) → Discord の直列パイプラインを 1 ジョブで実行。

**Tech Stack:** TypeScript / Cloudflare Workers / D1 / Hono / Drizzle ORM / Valibot / @anthropic-ai/sdk / fast-xml-parser / Vitest + @cloudflare/vitest-pool-workers

**関連設計**:
- 設計書: `docs/superpowers/specs/2026-05-23-finews-design.md`
- ADR-0001 〜 0005: `docs/adr/`

---

## Phase 1 で作るもの / 作らないもの

| 含める | 含めない |
|---|---|
| pnpm workspace + worker scaffold | apps/worker 以外のアプリ |
| D1 + Drizzle schema 全テーブル | weekly/monthly ジョブ |
| RSS fetcher (3-5 ソース) | market_fetcher / etf_fetcher |
| Stage 1 (Haiku 4.5) + Valibot golden test | LLM-as-judge 品質テスト |
| Stage 2 Daily — **1 領域だけ**(半導体) | 4 領域同時配信(Phase 1.5) |
| Discord Webhook 1メッセージ送信 | 4 メッセージ分割(Phase 1.5) |
| dedup (sha256 + URL 正規化)+ TDD | 継続テーマスコア(Phase 1.5) |
| 簡易 watchlist マッチ(ticker 完全一致) | alias マッチング(Phase 1.5) |
| Cron Trigger 設定 + 手動リハ | 休場日処理(Phase 1.5) |
| **Budget guard + retry + cost 記録(ADR-0006)** | LLM-as-judge 品質テスト |
| **Anthropic Console 月予算 $20 設定(手動)** | (上記の Layer 1) |

## File Structure

```
finews/
├── pnpm-workspace.yaml          (Task 1)
├── package.json                 (Task 1, root)
├── tsconfig.base.json           (Task 1)
├── apps/
│   └── worker/
│       ├── package.json         (Task 1)
│       ├── tsconfig.json        (Task 1)
│       ├── wrangler.toml        (Task 1, 2, 14)
│       ├── drizzle.config.ts    (Task 3)
│       ├── vitest.config.ts     (Task 6)
│       ├── src/
│       │   ├── index.ts         (Task 1, 13)  scheduled handler
│       │   ├── jobs/
│       │   │   └── daily.ts     (Task 13)
│       │   ├── fetchers/
│       │   │   └── news.ts      (Task 7)
│       │   ├── summarizer/
│       │   │   ├── stage1.ts    (Task 9)
│       │   │   ├── stage2_daily.ts (Task 11)
│       │   │   └── prompts.ts   (Task 9, 11)
│       │   ├── matchers/
│       │   │   └── watchlist.ts (Task 10)
│       │   ├── notifier/
│       │   │   └── discord.ts   (Task 12)
│       │   ├── db/
│       │   │   ├── schema.ts    (Task 3)
│       │   │   ├── client.ts    (Task 3)
│       │   │   └── migrations/  (Task 3, generated)
│       │   ├── config/
│       │   │   ├── sources.ts   (Task 5)
│       │   │   ├── watchlist.ts (Task 10)
│       │   │   └── budget.ts    (Task 6.5)
│       │   └── lib/
│       │       ├── dedup.ts        (Task 6)
│       │       ├── budget-guard.ts (Task 6.5)
│       │       └── retry.ts        (Task 6.5)
│       └── test/
│           ├── lib/
│           │   ├── dedup.test.ts         (Task 6)
│           │   └── budget-guard.test.ts  (Task 6.5)
│           ├── summarizer/
│           │   └── stage1.test.ts       (Task 9)
│           └── fixtures/
│               ├── article_01_nvda.json (Task 9)
│               ├── article_02_fomc.json (Task 9)
│               └── article_03_boj.json  (Task 9)
├── packages/
│   └── shared/
│       ├── package.json         (Task 8)
│       ├── tsconfig.json        (Task 8)
│       └── src/
│           └── schemas.ts       (Task 8)
└── scripts/
    └── verify-sources.sh        (Task 4)
```

---

## Task 1: pnpm workspace と worker スキャフォールド

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json` (root)
- Create: `tsconfig.base.json`
- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/wrangler.toml`
- Create: `apps/worker/src/index.ts`

- [ ] **Step 1: pnpm-workspace.yaml を作成**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 2: root package.json を作成**

```json
{
  "name": "finews",
  "private": true,
  "version": "0.0.1",
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "dev": "pnpm --filter worker dev",
    "deploy": "pnpm --filter worker deploy",
    "test": "pnpm --filter worker test",
    "typecheck": "pnpm -r typecheck"
  }
}
```

- [ ] **Step 3: tsconfig.base.json を作成**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "types": ["@cloudflare/workers-types"]
  }
}
```

- [ ] **Step 4: apps/worker/package.json を作成**

```json
{
  "name": "worker",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate:local": "wrangler d1 migrations apply finews --local",
    "db:migrate:remote": "wrangler d1 migrations apply finews --remote"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.98.0",
    "drizzle-orm": "^0.45.0",
    "fast-xml-parser": "^5.0.0",
    "hono": "^4.12.0",
    "valibot": "^1.4.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.16.0",
    "@cloudflare/workers-types": "^4.20260523.0",
    "drizzle-kit": "^0.31.0",
    "typescript": "^5.9.0",
    "vite": "^8.0.0",
    "vitest": "^4.1.0",
    "wrangler": "^4.0.0"
  }
}
```

注: バージョンは 2026-05-23 時点の最新。`vite` は `@cloudflare/vitest-pool-workers` の peer dependency 要件(vite ^6/^7/^8)を満たすために devDependencies に明示的に追加している。

- [ ] **Step 5: apps/worker/tsconfig.json を作成**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 6: apps/worker/wrangler.toml を作成**(D1 binding は Task 2 で追加)

```toml
name = "finews"
main = "src/index.ts"
compatibility_date = "2026-05-23"
compatibility_flags = ["nodejs_compat"]

[vars]
ENVIRONMENT = "development"
```

- [ ] **Step 7: apps/worker/src/index.ts を作成**(最小 scheduled handler)

```typescript
export interface Env {
  ANTHROPIC_API_KEY: string;
  DISCORD_WEBHOOK_URL: string;
  ENVIRONMENT: string;
}

export default {
  async scheduled(
    event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    console.log({ cron: event.cron, time: new Date().toISOString() });
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 8: pnpm install を実行**

Run: `pnpm install`
Expected: lockfile が生成され、`node_modules/` 配下に依存が展開される

- [ ] **Step 9: typecheck で動作確認**

Run: `pnpm typecheck`
Expected: エラーなし

- [ ] **Step 10: Commit**

```bash
git add pnpm-workspace.yaml package.json tsconfig.base.json apps/ pnpm-lock.yaml
git commit -m "feat: bootstrap pnpm workspace with worker scaffold"
```

---

## Task 2: D1 データベース作成と binding 追加

**Files:**
- Modify: `apps/worker/wrangler.toml`

- [ ] **Step 1: D1 データベースを作成**

Run: `cd apps/worker && pnpm wrangler d1 create finews`
Expected: 出力に `database_id = "..."` が含まれる。**この id をメモする**

- [ ] **Step 2: wrangler.toml に D1 binding を追記**

`apps/worker/wrangler.toml` に以下を追加(Step 1 でメモした id を貼る):

```toml
[[d1_databases]]
binding = "DB"
database_name = "finews"
database_id = "<paste-the-id-from-step-1>"
```

- [ ] **Step 3: Env interface に DB を追加**

`apps/worker/src/index.ts` の `Env` を変更:

```typescript
export interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY: string;
  DISCORD_WEBHOOK_URL: string;
  ENVIRONMENT: string;
}
```

- [ ] **Step 4: typecheck**

Run: `pnpm typecheck`
Expected: エラーなし

- [ ] **Step 5: Commit**

```bash
git add apps/worker/wrangler.toml apps/worker/src/index.ts
git commit -m "feat: add D1 database binding for finews"
```

---

## Task 3: Drizzle スキーマとマイグレーション

**Files:**
- Create: `apps/worker/drizzle.config.ts`
- Create: `apps/worker/src/db/schema.ts`
- Create: `apps/worker/src/db/client.ts`
- Create: `apps/worker/src/db/migrations/` (生成)

- [ ] **Step 1: drizzle.config.ts を作成**

```typescript
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
  driver: 'd1-http',
} satisfies Config;
```

- [ ] **Step 2: src/db/schema.ts を作成**(設計書セクション 7 のテーブル定義に従う)

```typescript
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  primaryKey,
} from 'drizzle-orm/sqlite-core';

export const articles = sqliteTable(
  'articles',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull(),
    domain: text('domain').notNull(),
    url: text('url').notNull(),
    title: text('title').notNull(),
    publishedAt: integer('published_at').notNull(),
    extractedJson: text('extracted_json'),
    watchlistMatched: integer('watchlist_matched', { mode: 'boolean' })
      .notNull()
      .default(false),
    continuingThemeScore: integer('continuing_theme_score').notNull().default(0),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    publishedIdx: index('idx_articles_published').on(t.publishedAt),
    domainPublishedIdx: index('idx_articles_domain').on(
      t.domain,
      t.publishedAt,
    ),
  }),
);

export const summaries = sqliteTable(
  'summaries',
  {
    id: text('id').primaryKey(),
    jobType: text('job_type').notNull(),
    domain: text('domain').notNull(),
    content: text('content').notNull(),
    articleIds: text('article_ids').notNull(),
    modelUsed: text('model_used').notNull(),
    deliveredAt: integer('delivered_at').notNull(),
  },
  (t) => ({
    jobTypeIdx: index('idx_summaries_job').on(t.jobType, t.deliveredAt),
  }),
);

export const watchlist = sqliteTable('watchlist', {
  ticker: text('ticker').primaryKey(),
  market: text('market').notNull(),
  reason: text('reason'),
  tags: text('tags').notNull(),
  aliases: text('aliases').notNull().default('[]'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  addedAt: integer('added_at').notNull(),
});

export const marketSnapshots = sqliteTable(
  'market_snapshots',
  {
    date: integer('date').notNull(),
    symbol: text('symbol').notNull(),
    price: real('price').notNull(),
    changePct1d: real('change_pct_1d'),
    rawJson: text('raw_json'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.date, t.symbol] }),
  }),
);

export const etfSnapshots = sqliteTable(
  'etf_snapshots',
  {
    date: integer('date').notNull(),
    symbol: text('symbol').notNull(),
    domain: text('domain').notNull(),
    price: real('price').notNull(),
    changePct1d: real('change_pct_1d'),
    volume: integer('volume'),
    volumeAvg20d: integer('volume_avg_20d'),
    sharesOutstanding: integer('shares_outstanding'),
    netAssetsUsd: real('net_assets_usd'),
    flow1d: real('flow_1d'),
    flow5d: real('flow_5d'),
    rawJson: text('raw_json'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.date, t.symbol] }),
    symbolDateIdx: index('idx_etf_symbol_date').on(t.symbol, t.date),
  }),
);

export const glossary = sqliteTable('glossary', {
  term: text('term').primaryKey(),
  definition: text('definition').notNull(),
  firstSeenAt: integer('first_seen_at').notNull(),
  lastSeenAt: integer('last_seen_at').notNull(),
  occurrenceCount: integer('occurrence_count').notNull().default(1),
});

export const deliveries = sqliteTable('deliveries', {
  id: text('id').primaryKey(),
  jobType: text('job_type').notNull(),
  step: text('step').notNull(),
  status: text('status').notNull(), // 'success' | 'failed' | 'skipped' | 'budget_exceeded'
  error: text('error'),
  durationMs: integer('duration_ms'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  costUsdMicro: integer('cost_usd_micro'),
  attemptedAt: integer('attempted_at').notNull(),
});
```

- [ ] **Step 3: src/db/client.ts を作成**

```typescript
import { drizzle } from 'drizzle-orm/d1';
import type { D1Database } from '@cloudflare/workers-types';
import * as schema from './schema';

export const createDb = (d1: D1Database) => drizzle(d1, { schema });
export type Db = ReturnType<typeof createDb>;
```

- [ ] **Step 4: マイグレーションを生成**

Run: `cd apps/worker && pnpm db:generate`
Expected: `src/db/migrations/0000_*.sql` が生成され、journal も作られる

- [ ] **Step 5: ローカル D1 にマイグレーションを適用**

Run: `cd apps/worker && pnpm db:migrate:local`
Expected: 全テーブルが作成された旨のログが出る

- [ ] **Step 6: typecheck**

Run: `pnpm typecheck`
Expected: エラーなし

- [ ] **Step 7: Commit**

```bash
git add apps/worker/drizzle.config.ts apps/worker/src/db/
git commit -m "feat: add drizzle schema and initial D1 migration"
```

---

## Task 4: 外部ソースの到達性検証(設計書 検証 TODO #1, #4)

**目的**: Phase 1 着手の最初に、Workers 実環境から Reuters/Nikkei xTech/BOJ/FRB と Yahoo Finance(`^SOX`)が取得できるかを確認する。失敗するソースは Task 5 の `sources.ts` から除外する。

**Files:**
- Create: `scripts/verify-sources.sh`

- [ ] **Step 1: スクリプトを作成**

```bash
#!/usr/bin/env bash
set -u
URLS=(
  "https://www.federalreserve.gov/feeds/press_all.xml"
  "https://www.boj.or.jp/rss/whatsnew.xml"
  "https://xtech.nikkei.com/rss/index.rdf"
  "https://www.reuters.com/technology/feed/"
  "https://www.reuters.com/markets/feed/"
  "https://query1.finance.yahoo.com/v7/finance/quote?symbols=%5ESOX"
  "https://query1.finance.yahoo.com/v7/finance/quote?symbols=%5EVIX"
  "https://feeds.bbci.co.uk/news/business/rss.xml"
)
for u in "${URLS[@]}"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -A "finews/0.0.1" -m 10 "$u")
  printf "%-3s  %s\n" "$code" "$u"
done
```

- [ ] **Step 2: 実行権限を付与して実行**

Run: `chmod +x scripts/verify-sources.sh && ./scripts/verify-sources.sh`
Expected: 各URL の HTTP status が出る。**200/301/302 = OK、403/404/5xx = NG**

- [ ] **Step 3: Workers 環境からの到達性を確認**

`apps/worker/src/index.ts` の `scheduled` ハンドラを一時的に検証コードに置き換え:

```typescript
export default {
  async scheduled(event, env, ctx) {
    const urls = [
      'https://www.federalreserve.gov/feeds/press_all.xml',
      'https://www.boj.or.jp/rss/whatsnew.xml',
      'https://xtech.nikkei.com/rss/index.rdf',
      'https://www.reuters.com/technology/feed/',
      'https://www.reuters.com/markets/feed/',
      'https://query1.finance.yahoo.com/v7/finance/quote?symbols=%5ESOX',
    ];
    for (const u of urls) {
      try {
        const r = await fetch(u, { headers: { 'User-Agent': 'finews/0.0.1' } });
        console.log({ url: u, status: r.status });
      } catch (e) {
        console.log({ url: u, error: String(e) });
      }
    }
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 4: ローカルで Cron 発火**

Run: `cd apps/worker && pnpm wrangler dev --test-scheduled`
別ターミナルで: `curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"`
Expected: 各URL の status がログに出る

- [ ] **Step 5: 結果をメモして Task 5 で参照**

各 URL の status を `scripts/verify-results-2026-05-23.md` に記録(コミットしない):

```markdown
# Source verification - 2026-05-23

## Local curl
- 200 federalreserve.gov  → OK
- 200 boj.or.jp           → OK
- 200 xtech.nikkei.com    → OK
- ??? reuters.com         → ???
...

## Workers fetch
- 200 federalreserve.gov  → OK
...

## 採用方針
- Phase 1 で採用: ...
- フォールバック: ...
```

- [ ] **Step 6: index.ts を元の最小実装に戻す**

```typescript
export default {
  async scheduled(event, env, ctx) {
    console.log({ cron: event.cron, time: new Date().toISOString() });
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 7: Commit**(検証スクリプトのみ)

```bash
git add scripts/verify-sources.sh apps/worker/src/index.ts
git commit -m "chore: add external source verification script"
```

---

## Task 5: RSS ソース config

**Files:**
- Create: `apps/worker/src/config/sources.ts`

- [ ] **Step 1: Domain 型と NewsSource 型を定義**

```typescript
import * as v from 'valibot';

export const DomainSchema = v.picklist([
  'semiconductor',
  'ai_tech',
  'us_macro',
  'jp_macro',
  'earnings',
  'market_context',
]);
export type Domain = v.InferOutput<typeof DomainSchema>;

export type NewsSource = {
  id: string;
  type: 'rss';
  url: string;
  domain: Domain;
  priority: 1 | 2 | 3;
};
```

- [ ] **Step 2: Task 4 の結果に基づいてソース配列を定義**

`apps/worker/src/config/sources.ts` に追記(Task 4 で **OK だったソースのみ**を残す):

```typescript
export const newsSources: NewsSource[] = [
  {
    id: 'nikkei_xtech',
    type: 'rss',
    url: 'https://xtech.nikkei.com/rss/index.rdf',
    domain: 'semiconductor',
    priority: 1,
  },
  {
    id: 'frb_press',
    type: 'rss',
    url: 'https://www.federalreserve.gov/feeds/press_all.xml',
    domain: 'us_macro',
    priority: 1,
  },
  {
    id: 'boj',
    type: 'rss',
    url: 'https://www.boj.or.jp/rss/whatsnew.xml',
    domain: 'jp_macro',
    priority: 1,
  },
  // Reuters が Workers から 200 を返したら追加:
  // { id: 'reuters_tech', type: 'rss', url: 'https://www.reuters.com/technology/feed/', domain: 'semiconductor', priority: 1 },
  // 上記が NG なら BBC Business を semiconductor 補完用に追加:
  // { id: 'bbc_business', type: 'rss', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', domain: 'us_macro', priority: 2 },
];
```

- [ ] **Step 3: typecheck**

Run: `pnpm typecheck`
Expected: エラーなし

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/config/sources.ts
git commit -m "feat: add news source config (verified RSS feeds)"
```

---

## Task 6: dedup ユーティリティ(TDD)

**Files:**
- Create: `apps/worker/vitest.config.ts`
- Create: `apps/worker/test/lib/dedup.test.ts`
- Create: `apps/worker/src/lib/dedup.ts`

- [ ] **Step 1: vitest.config.ts を作成**

```typescript
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
      },
    },
  },
});
```

- [ ] **Step 2: 失敗するテストを書く (Red)**

`apps/worker/test/lib/dedup.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { normalizeUrl, articleId } from '../../src/lib/dedup';

describe('normalizeUrl', () => {
  it('strips utm_* query params', () => {
    expect(
      normalizeUrl('https://example.com/a?utm_source=x&utm_medium=y&id=1'),
    ).toBe('https://example.com/a?id=1');
  });

  it('removes trailing slash from path', () => {
    expect(normalizeUrl('https://example.com/path/')).toBe(
      'https://example.com/path',
    );
  });

  it('lowercases host', () => {
    expect(normalizeUrl('https://Example.COM/A')).toBe('https://example.com/A');
  });

  it('preserves non-tracking query params and order', () => {
    expect(normalizeUrl('https://example.com/a?b=2&a=1')).toBe(
      'https://example.com/a?a=1&b=2',
    );
  });
});

describe('articleId', () => {
  it('returns sha256 hex of normalized URL', async () => {
    const id1 = await articleId(
      'https://example.com/a?utm_source=x&utm_medium=y',
    );
    const id2 = await articleId('https://example.com/a');
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns different ids for different normalized URLs', async () => {
    const id1 = await articleId('https://example.com/a');
    const id2 = await articleId('https://example.com/b');
    expect(id1).not.toBe(id2);
  });
});
```

- [ ] **Step 3: テストを実行して失敗を確認**

Run: `cd apps/worker && pnpm test test/lib/dedup.test.ts`
Expected: FAIL — `Cannot find module '../../src/lib/dedup'`

- [ ] **Step 4: dedup.ts を実装 (Green)**

`apps/worker/src/lib/dedup.ts`:

```typescript
const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  '_ga',
]);

export function normalizeUrl(input: string): string {
  const u = new URL(input);
  u.hostname = u.hostname.toLowerCase();
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.slice(0, -1);
  }
  const params = Array.from(u.searchParams.entries())
    .filter(([k]) => !TRACKING_PARAMS.has(k.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));
  u.search = '';
  for (const [k, v] of params) u.searchParams.append(k, v);
  return u.toString();
}

export async function articleId(url: string): Promise<string> {
  const normalized = normalizeUrl(url);
  const data = new TextEncoder().encode(normalized);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
```

- [ ] **Step 5: テストを実行して合格を確認**

Run: `cd apps/worker && pnpm test test/lib/dedup.test.ts`
Expected: 全テスト PASS

- [ ] **Step 6: Commit**

```bash
git add apps/worker/vitest.config.ts apps/worker/test/lib/dedup.test.ts apps/worker/src/lib/dedup.ts
git commit -m "feat: add URL normalization and sha256 article id (TDD)"
```

---

## Task 6.5: Budget guard と retry 実装(ADR-0006)

**Files:**
- Create: `apps/worker/src/config/budget.ts`
- Create: `apps/worker/src/lib/budget-guard.ts`
- Create: `apps/worker/src/lib/retry.ts`
- Create: `apps/worker/test/lib/budget-guard.test.ts`

- [ ] **Step 1: config/budget.ts を作成**

```typescript
export const BUDGET = {
  MAX_STAGE1_CALLS_PER_JOB: 30,
  MAX_STAGE2_CALLS_PER_JOB: 5,
  MAX_INPUT_TOKENS_PER_JOB: 200_000,
  MAX_OUTPUT_TOKENS_PER_JOB: 50_000,
  MAX_RETRIES: 3,
  BACKOFF_BASE_MS: 1000,
} as const;

export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-sonnet-4-6':         { input: 3, output: 15 },
  'claude-opus-4-7':           { input: 5, output: 25 },
};

export type ModelId = keyof typeof MODEL_PRICING | string;
```

- [ ] **Step 2: budget-guard.ts の failing test を書く (Red)**

`apps/worker/test/lib/budget-guard.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  BudgetTracker,
  BudgetExceededError,
  estimateCostMicroUsd,
} from '../../src/lib/budget-guard';

describe('BudgetTracker', () => {
  it('allows calls under the limit', () => {
    const t = new BudgetTracker();
    t.recordCall('stage1', 'claude-haiku-4-5-20251001', 1000, 200);
    expect(t.summary().stage1Calls).toBe(1);
    expect(t.summary().inputTokens).toBe(1000);
  });

  it('throws BudgetExceededError when stage1 call count exceeds limit', () => {
    const t = new BudgetTracker();
    for (let i = 0; i < 30; i++) {
      t.recordCall('stage1', 'claude-haiku-4-5-20251001', 10, 10);
    }
    expect(() => t.assertCanCall('stage1')).toThrow(BudgetExceededError);
  });

  it('throws BudgetExceededError when input tokens exceed limit', () => {
    const t = new BudgetTracker();
    t.recordCall('stage1', 'claude-haiku-4-5-20251001', 200_001, 0);
    expect(() => t.assertCanCall('stage1')).toThrow(BudgetExceededError);
  });

  it('accumulates cost across multiple calls', () => {
    const t = new BudgetTracker();
    t.recordCall('stage1', 'claude-haiku-4-5-20251001', 1_000_000, 0);
    t.recordCall('stage2', 'claude-sonnet-4-6', 1_000_000, 0);
    // Haiku: $1/M input = 1_000_000 micro USD
    // Sonnet: $3/M input = 3_000_000 micro USD
    expect(t.summary().costUsdMicro).toBe(4_000_000);
  });
});

describe('estimateCostMicroUsd', () => {
  it('computes Haiku cost correctly', () => {
    // $1 input + $5 output per MTok
    expect(
      estimateCostMicroUsd('claude-haiku-4-5-20251001', 1000, 100),
    ).toBe(1000 * 1 + 100 * 5);
  });

  it('returns 0 for unknown model', () => {
    expect(estimateCostMicroUsd('unknown-model', 1000, 100)).toBe(0);
  });
});
```

- [ ] **Step 3: テスト実行で失敗確認**

Run: `cd apps/worker && pnpm test test/lib/budget-guard.test.ts`
Expected: FAIL — `Cannot find module '../../src/lib/budget-guard'`

- [ ] **Step 4: budget-guard.ts を実装 (Green)**

`apps/worker/src/lib/budget-guard.ts`:

```typescript
import { BUDGET, MODEL_PRICING } from '../config/budget';

export type CallStage = 'stage1' | 'stage2';

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export function estimateCostMicroUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = MODEL_PRICING[model];
  if (!p) return 0;
  return Math.ceil(p.input * inputTokens + p.output * outputTokens);
}

export type BudgetSummary = {
  stage1Calls: number;
  stage2Calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsdMicro: number;
};

export class BudgetTracker {
  private stage1Calls = 0;
  private stage2Calls = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private costUsdMicro = 0;

  assertCanCall(stage: CallStage): void {
    if (stage === 'stage1' && this.stage1Calls >= BUDGET.MAX_STAGE1_CALLS_PER_JOB) {
      throw new BudgetExceededError(
        `Stage 1 call limit reached: ${this.stage1Calls}/${BUDGET.MAX_STAGE1_CALLS_PER_JOB}`,
      );
    }
    if (stage === 'stage2' && this.stage2Calls >= BUDGET.MAX_STAGE2_CALLS_PER_JOB) {
      throw new BudgetExceededError(
        `Stage 2 call limit reached: ${this.stage2Calls}/${BUDGET.MAX_STAGE2_CALLS_PER_JOB}`,
      );
    }
    if (this.inputTokens >= BUDGET.MAX_INPUT_TOKENS_PER_JOB) {
      throw new BudgetExceededError(
        `Input token limit reached: ${this.inputTokens}/${BUDGET.MAX_INPUT_TOKENS_PER_JOB}`,
      );
    }
    if (this.outputTokens >= BUDGET.MAX_OUTPUT_TOKENS_PER_JOB) {
      throw new BudgetExceededError(
        `Output token limit reached: ${this.outputTokens}/${BUDGET.MAX_OUTPUT_TOKENS_PER_JOB}`,
      );
    }
  }

  recordCall(
    stage: CallStage,
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): void {
    if (stage === 'stage1') this.stage1Calls += 1;
    if (stage === 'stage2') this.stage2Calls += 1;
    this.inputTokens += inputTokens;
    this.outputTokens += outputTokens;
    this.costUsdMicro += estimateCostMicroUsd(model, inputTokens, outputTokens);
  }

  summary(): BudgetSummary {
    return {
      stage1Calls: this.stage1Calls,
      stage2Calls: this.stage2Calls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      costUsdMicro: this.costUsdMicro,
    };
  }
}
```

- [ ] **Step 5: テスト実行で合格確認**

Run: `cd apps/worker && pnpm test test/lib/budget-guard.test.ts`
Expected: 全テスト PASS

- [ ] **Step 6: retry.ts を実装**

`apps/worker/src/lib/retry.ts`:

```typescript
import { BUDGET } from '../config/budget';

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export type RetryOptions = {
  maxAttempts?: number;
  backoffBaseMs?: number;
};

function isRetryable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const status = (err as { status?: number }).status;
  return typeof status === 'number' && RETRYABLE_STATUSES.has(status);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? BUDGET.MAX_RETRIES;
  const backoffBase = opts.backoffBaseMs ?? BUDGET.BACKOFF_BASE_MS;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err)) throw err;
      if (attempt === maxAttempts - 1) break;
      const delay = backoffBase * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
```

- [ ] **Step 7: typecheck**

Run: `pnpm typecheck`
Expected: エラーなし

- [ ] **Step 8: Commit**

```bash
git add apps/worker/src/config/budget.ts apps/worker/src/lib/budget-guard.ts apps/worker/src/lib/retry.ts apps/worker/test/lib/budget-guard.test.ts
git commit -m "feat: add budget guard and retry policy (ADR-0006)"
```

---

## Task 7: News fetcher

**Files:**
- Create: `apps/worker/src/fetchers/news.ts`

- [ ] **Step 1: RSS 解析の型を定義**

```typescript
import { XMLParser } from 'fast-xml-parser';
import type { NewsSource, Domain } from '../config/sources';
import { articleId } from '../lib/dedup';

export type FetchedArticle = {
  id: string;
  source: string;
  domain: Domain;
  url: string;
  title: string;
  description: string;
  publishedAt: number; // unix ms
};
```

- [ ] **Step 2: 1 ソース取得関数を実装**

`apps/worker/src/fetchers/news.ts` に追記:

```typescript
async function fetchOne(source: NewsSource): Promise<FetchedArticle[]> {
  const res = await fetch(source.url, {
    headers: { 'User-Agent': 'finews/0.0.1' },
  });
  if (!res.ok) {
    console.warn({ source: source.id, status: res.status });
    return [];
  }
  const xml = await res.text();
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });
  const parsed = parser.parse(xml);

  // RSS 2.0: channel.item[], RDF: RDF.item[]
  const items =
    parsed?.rss?.channel?.item ??
    parsed?.['rdf:RDF']?.item ??
    parsed?.RDF?.item ??
    [];
  const itemArray = Array.isArray(items) ? items : [items];

  const out: FetchedArticle[] = [];
  for (const item of itemArray) {
    if (!item?.link || !item?.title) continue;
    const url = String(item.link).trim();
    const title = String(item.title).trim();
    const description = String(item.description ?? '').trim().slice(0, 500);
    const pubDateRaw =
      item.pubDate ?? item['dc:date'] ?? item.date ?? new Date().toISOString();
    const publishedAt = new Date(String(pubDateRaw)).getTime();
    if (Number.isNaN(publishedAt)) continue;

    out.push({
      id: await articleId(url),
      source: source.id,
      domain: source.domain,
      url,
      title,
      description,
      publishedAt,
    });
  }
  return out;
}
```

- [ ] **Step 3: 並列取得関数を実装**

```typescript
export async function fetchAllSources(
  sources: NewsSource[],
): Promise<FetchedArticle[]> {
  const results = await Promise.allSettled(sources.map(fetchOne));
  const articles: FetchedArticle[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') articles.push(...r.value);
  }
  return articles;
}
```

- [ ] **Step 4: typecheck**

Run: `pnpm typecheck`
Expected: エラーなし

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/fetchers/news.ts
git commit -m "feat: add RSS fetcher with parallel execution"
```

---

## Task 8: Stage 1 Valibot スキーマ(shared package)

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/schemas.ts`
- Modify: `apps/worker/package.json` (依存追加)

- [ ] **Step 1: packages/shared/package.json**

```json
{
  "name": "@finews/shared",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "main": "./src/schemas.ts",
  "types": "./src/schemas.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "valibot": "^1.0.0"
  }
}
```

- [ ] **Step 2: packages/shared/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: packages/shared/src/schemas.ts**

```typescript
import * as v from 'valibot';

export const ExtractedArticleSchema = v.object({
  headline_ja: v.pipe(v.string(), v.maxLength(80)),
  category: v.picklist([
    'earnings',
    'policy',
    'product',
    'macro_indicator',
    'm&a',
    'other',
  ]),
  tickers: v.array(v.string()),
  ticker_aliases_used: v.array(v.string()),
  indicators: v.array(v.string()),
  key_numbers: v.array(
    v.object({
      label: v.string(),
      value: v.string(),
    }),
  ),
  significance: v.pipe(v.number(), v.minValue(1), v.maxValue(5)),
  rationale: v.pipe(v.string(), v.maxLength(60)),
  glossary_terms: v.array(
    v.object({
      term: v.string(),
      definition: v.pipe(v.string(), v.maxLength(50)),
    }),
  ),
});

export type ExtractedArticle = v.InferOutput<typeof ExtractedArticleSchema>;
```

- [ ] **Step 4: worker から shared を参照可能に**

`apps/worker/package.json` の `dependencies` に追加:

```json
"@finews/shared": "workspace:*"
```

- [ ] **Step 5: pnpm install で workspace リンクを張る**

Run: `pnpm install`
Expected: `node_modules/@finews/shared` が `packages/shared` への symlink になる

- [ ] **Step 6: typecheck**

Run: `pnpm typecheck`
Expected: エラーなし

- [ ] **Step 7: Commit**

```bash
git add packages/ apps/worker/package.json pnpm-lock.yaml
git commit -m "feat: add shared package with Valibot schemas"
```

---

## Task 9: Stage 1 実装(Haiku 4.5) — Valibot golden test TDD

**Files:**
- Create: `apps/worker/test/fixtures/article_01_nvda.json`
- Create: `apps/worker/test/fixtures/article_02_fomc.json`
- Create: `apps/worker/test/fixtures/article_03_boj.json`
- Create: `apps/worker/test/summarizer/stage1.test.ts`
- Create: `apps/worker/src/summarizer/prompts.ts`
- Create: `apps/worker/src/summarizer/stage1.ts`

- [ ] **Step 1: fixture を 3 件作成**

`apps/worker/test/fixtures/article_01_nvda.json`:

```json
{
  "title": "Nvidia reports record Q1 revenue of $26B, up 262% year-over-year",
  "description": "Nvidia (NVDA) reported first-quarter revenue of $26 billion on Wednesday, up 262% from the prior year. Data center revenue reached $22.5B, accounting for 87% of total revenue. The company guided to Q2 revenue of $28B, $2B above analyst estimates."
}
```

`apps/worker/test/fixtures/article_02_fomc.json`:

```json
{
  "title": "Fed holds rates steady, signals two cuts in 2026",
  "description": "The Federal Open Market Committee (FOMC) voted unanimously to keep the federal funds rate at 4.25-4.50%. The updated dot plot shows two 25bp cuts expected in 2026, down from three projected in March."
}
```

`apps/worker/test/fixtures/article_03_boj.json`:

```json
{
  "title": "日銀、政策金利を0.5%に据え置き YCC撤廃後の正常化路線継続",
  "description": "日本銀行は金融政策決定会合で政策金利を0.5%に据え置くことを決定した。植田総裁は記者会見で「基調的な物価上昇率は2%に向けて徐々に高まっている」と発言。市場は年内追加利上げ織り込みを高めた。"
}
```

- [ ] **Step 2: Valibot 検証テストを書く (Red)**

`apps/worker/test/summarizer/stage1.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import * as v from 'valibot';
import { ExtractedArticleSchema } from '@finews/shared';
import { extractArticle } from '../../src/summarizer/stage1';
import article01 from '../fixtures/article_01_nvda.json';
import article02 from '../fixtures/article_02_fomc.json';
import article03 from '../fixtures/article_03_boj.json';

const env = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
};

describe.skipIf(!env.ANTHROPIC_API_KEY)(
  'Stage 1 extraction (live API)',
  () => {
    it.each([
      ['nvda', article01],
      ['fomc', article02],
      ['boj', article03],
    ])('returns valid ExtractedArticle for %s', async (_name, fixture) => {
      const result = await extractArticle(fixture, env.ANTHROPIC_API_KEY);
      const parsed = v.safeParse(ExtractedArticleSchema, result);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.output.significance).toBeGreaterThanOrEqual(1);
        expect(parsed.output.significance).toBeLessThanOrEqual(5);
        expect(parsed.output.headline_ja.length).toBeLessThanOrEqual(80);
      }
    });
  },
);
```

- [ ] **Step 3: テストを実行して失敗を確認**

Run: `cd apps/worker && pnpm test test/summarizer/stage1.test.ts`
Expected: FAIL — `Cannot find module '../../src/summarizer/stage1'`

- [ ] **Step 4: prompts.ts を作成**

`apps/worker/src/summarizer/prompts.ts`:

```typescript
export const STAGE1_SYSTEM = `あなたは金融ニュース分析のエキスパートです。
記事を読み、厳密にJSONフォーマットで出力してください。

【出力ルール】
- 必ず指定スキーマのJSONのみを返す(前置き・後書き禁止)
- 数値は記事中の表現をそのまま value に入れる("$26B", "+262%")
- significance: 1=些末, 3=注目, 5=市場を動かす重要材料
- rationale は60字以内で「なぜ重要か」
- glossary_terms には金融初学者が分からなそうな専門用語を最大3つ
  ただし基本用語(GDP, CPI, FOMC, 決算, 為替, 利回り, ETF)は除外
- tickers は正規化(例: "Nvidia" → "NVDA"), 元表記は ticker_aliases_used に
- 該当が無いフィールドは空配列を返す`;

export const stage1UserPrompt = (title: string, body: string) =>
  `タイトル: ${title}\n本文: ${body}`;
```

- [ ] **Step 5: stage1.ts を実装 (Green)**

`apps/worker/src/summarizer/stage1.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import * as v from 'valibot';
import { ExtractedArticleSchema, type ExtractedArticle } from '@finews/shared';
import { STAGE1_SYSTEM, stage1UserPrompt } from './prompts';

export type Stage1Input = {
  title: string;
  description: string;
};

export async function extractArticle(
  input: Stage1Input,
  apiKey: string,
): Promise<ExtractedArticle> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: STAGE1_SYSTEM,
    messages: [
      {
        role: 'user',
        content: stage1UserPrompt(input.title, input.description),
      },
    ],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('');

  // モデルが ```json ... ``` を返すケースに備えて剥がす
  const jsonStr = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/```$/, '')
    .trim();

  const parsed = JSON.parse(jsonStr);
  return v.parse(ExtractedArticleSchema, parsed);
}
```

- [ ] **Step 6: ANTHROPIC_API_KEY を設定して live test を流す**

Run: `cd apps/worker && export ANTHROPIC_API_KEY=sk-ant-... && pnpm test test/summarizer/stage1.test.ts`
Expected: 3 件すべて PASS(`significance` が 1-5、`headline_ja` が80字以内)

失敗時の対応:
- Valibot エラー: モデル出力をログ出力し、プロンプトを調整
- パース失敗: `jsonStr` のログを出して JSON 抽出ロジックを修正

- [ ] **Step 7: Commit**

```bash
git add apps/worker/test/fixtures/ apps/worker/test/summarizer/ apps/worker/src/summarizer/
git commit -m "feat: add Stage 1 extraction with Haiku 4.5 (TDD with golden fixtures)"
```

---

## Task 10: 簡易 watchlist マッチャ

**Files:**
- Create: `apps/worker/src/config/watchlist.ts`
- Create: `apps/worker/src/matchers/watchlist.ts`

- [ ] **Step 1: watchlist config を作成**

`apps/worker/src/config/watchlist.ts`:

```typescript
export const watchlistTickers: ReadonlyArray<string> = [
  'NVDA',
  'AMD',
  'TSM',
  'AAPL',
  'MSFT',
  '6857.T',
  '8035.T',
];
```

- [ ] **Step 2: matcher を実装(Phase 1 は完全一致のみ)**

`apps/worker/src/matchers/watchlist.ts`:

```typescript
import { watchlistTickers } from '../config/watchlist';

const watchlistSet = new Set(watchlistTickers.map((t) => t.toUpperCase()));

export function isWatchlistMatched(tickers: ReadonlyArray<string>): boolean {
  return tickers.some((t) => watchlistSet.has(t.toUpperCase()));
}
```

- [ ] **Step 3: typecheck**

Run: `pnpm typecheck`
Expected: エラーなし

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/config/watchlist.ts apps/worker/src/matchers/watchlist.ts
git commit -m "feat: add watchlist matcher (exact-match, Phase 1)"
```

---

## Task 11: Stage 2 Daily(半導体 1 領域のみ)

**Files:**
- Modify: `apps/worker/src/summarizer/prompts.ts`
- Create: `apps/worker/src/summarizer/stage2_daily.ts`

- [ ] **Step 1: prompts.ts に Stage 2 のプロンプトを追加**

`apps/worker/src/summarizer/prompts.ts` の末尾に追記:

```typescript
export const STAGE2_DAILY_SYSTEM = `あなたは投資判断と金融リテラシー向上の両方をサポートするアナリストです。
読み手は金融ニュースを読み慣れていない技術者で、要約を通じて
「なぜこの数字・動きが重要なのか」を学習することも目的としています。

【要約方針】
1. 事実だけでなく「なぜ重要か」を必ず添える
2. 専門用語には30字以内の短い注釈を付ける
   ただし基本用語(GDP, CPI, FOMC, 決算, 為替, 利回り, ETF)は注釈不要
3. 「読み解きポイント」を1〜2個、初学者が次回以降自力で読めるよう型を提示
4. ウォッチリスト関連を優先ハイライト

【ハルシネーション対策】
- 数値・固有名詞は必ず key_numbers / tickers から引用すること
- 新たな数値や記事に無い因果を創出してはならない
- 不確実な解釈は「と見られる」「の可能性がある」で明示

【出力フォーマット】
プレーンテキストで以下の構成にする(Markdown 強調は最小限):

### 半導体・AIテック

🔥 [見出し] (significance N)
   事実: ...
   なぜ重要:
     1. ...
     2. ...
   読み解きポイント: ...

(2-3 件繰り返し)

### 今日の用語
• 用語1: 30字以内の説明
• 用語2: 30字以内の説明

最大 3500 文字以内。`;

export const stage2DailyUser = (
  domain: string,
  extractedArticles: unknown[],
  watchlistTickers: ReadonlyArray<string>,
) => `# 領域: ${domain}

# 今日のニュース材料(Stage 1抽出済み)
${JSON.stringify(extractedArticles, null, 2)}

# ウォッチリスト
${watchlistTickers.join(', ')}`;
```

- [ ] **Step 2: stage2_daily.ts を実装**

`apps/worker/src/summarizer/stage2_daily.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import type { ExtractedArticle } from '@finews/shared';
import { STAGE2_DAILY_SYSTEM, stage2DailyUser } from './prompts';
import { watchlistTickers } from '../config/watchlist';
import type { Domain } from '../config/sources';

export type Stage2DailyInput = {
  domain: Domain;
  articles: ExtractedArticle[];
};

export async function generateDailySummary(
  input: Stage2DailyInput,
  apiKey: string,
): Promise<string> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: [
      {
        type: 'text',
        text: STAGE2_DAILY_SYSTEM,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: stage2DailyUser(input.domain, input.articles, watchlistTickers),
      },
    ],
  });

  return response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('');
}
```

- [ ] **Step 3: typecheck**

Run: `pnpm typecheck`
Expected: エラーなし

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/summarizer/
git commit -m "feat: add Stage 2 daily summarization for one domain"
```

---

## Task 12: Discord notifier(1 embed)

**Files:**
- Create: `apps/worker/src/notifier/discord.ts`

- [ ] **Step 1: 領域色マップを定義**

```typescript
const DOMAIN_COLORS: Record<string, number> = {
  semiconductor: 0x3498db,
  ai_tech: 0x9b59b6,
  us_macro: 0x2ecc71,
  jp_macro: 0xe74c3c,
  earnings: 0xf1c40f,
  market_context: 0x95a5a6,
};
```

- [ ] **Step 2: embed 構築関数**

`apps/worker/src/notifier/discord.ts`:

```typescript
const DOMAIN_COLORS: Record<string, number> = {
  semiconductor: 0x3498db,
  ai_tech: 0x9b59b6,
  us_macro: 0x2ecc71,
  jp_macro: 0xe74c3c,
  earnings: 0xf1c40f,
  market_context: 0x95a5a6,
};

const DOMAIN_TITLES: Record<string, string> = {
  semiconductor: '半導体・AIテック',
  ai_tech: 'AIテック',
  us_macro: '米国マクロ',
  jp_macro: '日本マクロ',
  earnings: '決算・ガイダンス',
  market_context: 'マーケット',
};

export type DailyEmbed = {
  domain: string;
  body: string;
};

export async function sendDailyEmbed(
  webhookUrl: string,
  embed: DailyEmbed,
): Promise<void> {
  const description = embed.body.slice(0, 4000); // safety margin
  const payload = {
    embeds: [
      {
        title: `📰 ${DOMAIN_TITLES[embed.domain] ?? embed.domain}`,
        description,
        color: DOMAIN_COLORS[embed.domain] ?? 0x95a5a6,
        timestamp: new Date().toISOString(),
        footer: { text: 'finews / Sonnet 4.6' },
      },
    ],
  };
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Discord webhook failed: ${res.status} ${await res.text()}`);
  }
}
```

- [ ] **Step 3: typecheck**

Run: `pnpm typecheck`
Expected: エラーなし

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/notifier/discord.ts
git commit -m "feat: add Discord webhook notifier for single embed"
```

---

## Task 13: Daily ジョブ配線と scheduled handler

> **注(ADR-0006)**: Task 6.5 で実装した `BudgetTracker` と `withRetry` を以下のように組み込むこと:
> - `runDaily` 開始時に `tracker = new BudgetTracker()` を生成
> - Stage 1/2 の各呼び出し**前**に `tracker.assertCanCall('stage1' | 'stage2')`
> - 各呼び出し**後**に `tracker.recordCall(stage, model, response.usage.input_tokens, response.usage.output_tokens)`
> - Anthropic SDK 呼び出しは `withRetry(() => ...)` でラップ
> - `BudgetExceededError` を捕捉した時は `deliveries` に `status: 'budget_exceeded'` を記録し、Anthropic を**再呼び出しせず**プレーンテキストの「予算上限到達」通知を Discord に送って終了
> - ジョブ末尾の `deliveries.insert` で `inputTokens` / `outputTokens` / `costUsdMicro` を `tracker.summary()` から埋める

`extractArticle` と `generateDailySummary` のシグネチャを `(input, apiKey, tracker)` に拡張し、関数内部で `tracker.assertCanCall` / `tracker.recordCall` を呼ぶ実装に変更すること(Task 9 / Task 11 のコードは tracker 引数なし版だが、ここで拡張する)。

**Files:**
- Create: `apps/worker/src/jobs/daily.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/summarizer/stage1.ts` (tracker 引数追加)
- Modify: `apps/worker/src/summarizer/stage2_daily.ts` (tracker 引数追加)

- [ ] **Step 1: jobs/daily.ts を実装**

`apps/worker/src/jobs/daily.ts`:

```typescript
import { eq, gte, inArray } from 'drizzle-orm';
import { createDb } from '../db/client';
import { articles, deliveries } from '../db/schema';
import { newsSources, type Domain } from '../config/sources';
import { fetchAllSources } from '../fetchers/news';
import { extractArticle } from '../summarizer/stage1';
import { generateDailySummary } from '../summarizer/stage2_daily';
import { isWatchlistMatched } from '../matchers/watchlist';
import { sendDailyEmbed } from '../notifier/discord';
import type { ExtractedArticle } from '@finews/shared';
import type { Env } from '../index';

const PHASE_1_DOMAIN: Domain = 'semiconductor';
const MAX_ARTICLES_FOR_STAGE2 = 6;

export async function runDaily(env: Env): Promise<void> {
  const db = createDb(env.DB);
  const startedAt = Date.now();

  // 1. RSS 取得
  const fetched = await fetchAllSources(newsSources);
  const targetSources = newsSources.filter((s) => s.domain === PHASE_1_DOMAIN);
  const targetSourceIds = new Set(targetSources.map((s) => s.id));
  const candidates = fetched.filter((a) => targetSourceIds.has(a.source));

  // 2. dedup: 過去 7 日の articles と URL hash 比較
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const existingRows = await db
    .select({ id: articles.id })
    .from(articles)
    .where(gte(articles.publishedAt, sevenDaysAgo));
  const existing = new Set(existingRows.map((r) => r.id));
  const fresh = candidates.filter((a) => !existing.has(a.id));

  // 3. priority * recency でソートして上位 N に絞る
  const ranked = fresh
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, 15);

  // 4. Stage 1: 並列度 3 で抽出
  const extracted: Array<{ raw: typeof ranked[0]; ex: ExtractedArticle }> = [];
  for (let i = 0; i < ranked.length; i += 3) {
    const batch = ranked.slice(i, i + 3);
    const results = await Promise.allSettled(
      batch.map((a) =>
        extractArticle(
          { title: a.title, description: a.description },
          env.ANTHROPIC_API_KEY,
        ).then((ex) => ({ raw: a, ex })),
      ),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') extracted.push(r.value);
    }
  }

  // 5. articles に保存
  const now = Date.now();
  for (const { raw, ex } of extracted) {
    await db
      .insert(articles)
      .values({
        id: raw.id,
        source: raw.source,
        domain: raw.domain,
        url: raw.url,
        title: raw.title,
        publishedAt: raw.publishedAt,
        extractedJson: JSON.stringify(ex),
        watchlistMatched: isWatchlistMatched(ex.tickers),
        continuingThemeScore: 0,
        createdAt: now,
      })
      .onConflictDoNothing();
  }

  // 6. Stage 2 入力: significance >= 3 上位
  const stage2Input = extracted
    .filter(({ ex }) => ex.significance >= 3)
    .sort((a, b) => b.ex.significance - a.ex.significance)
    .slice(0, MAX_ARTICLES_FOR_STAGE2)
    .map(({ ex }) => ex);

  if (stage2Input.length === 0) {
    console.log({ job: 'daily', skipped: 'no significant articles' });
    await db.insert(deliveries).values({
      id: crypto.randomUUID(),
      jobType: 'daily',
      step: 'stage2_semiconductor',
      status: 'skipped',
      error: 'no significant articles',
      durationMs: Date.now() - startedAt,
      attemptedAt: now,
    });
    return;
  }

  // 7. Stage 2 Daily
  const summary = await generateDailySummary(
    { domain: PHASE_1_DOMAIN, articles: stage2Input },
    env.ANTHROPIC_API_KEY,
  );

  // 8. Discord 配信
  await sendDailyEmbed(env.DISCORD_WEBHOOK_URL, {
    domain: PHASE_1_DOMAIN,
    body: summary,
  });

  // 9. delivery ログ
  await db.insert(deliveries).values({
    id: crypto.randomUUID(),
    jobType: 'daily',
    step: 'stage2_semiconductor',
    status: 'success',
    durationMs: Date.now() - startedAt,
    attemptedAt: now,
  });

  console.log({
    job: 'daily',
    articlesFetched: fetched.length,
    fresh: fresh.length,
    extracted: extracted.length,
    stage2Input: stage2Input.length,
    durationMs: Date.now() - startedAt,
  });
}
```

- [ ] **Step 2: index.ts を scheduled handler に書き換え**

`apps/worker/src/index.ts`:

```typescript
import type { D1Database } from '@cloudflare/workers-types';
import { runDaily } from './jobs/daily';

export interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY: string;
  DISCORD_WEBHOOK_URL: string;
  ENVIRONMENT: string;
}

export default {
  async scheduled(
    event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    console.log({ cron: event.cron, time: new Date().toISOString() });
    switch (event.cron) {
      case '30 21 * * 0-4':
        ctx.waitUntil(runDaily(env));
        break;
      default:
        console.log({ ignored: event.cron });
    }
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 3: typecheck**

Run: `pnpm typecheck`
Expected: エラーなし

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/jobs/ apps/worker/src/index.ts
git commit -m "feat: wire daily job (RSS -> Stage1 -> Stage2 -> Discord)"
```

---

## Task 14: Cron Trigger 設定と本番リハーサル

**Files:**
- Modify: `apps/worker/wrangler.toml`

- [ ] **Step 1: wrangler.toml に triggers を追加**

`apps/worker/wrangler.toml` の末尾に追記:

```toml
[triggers]
crons = [
  "30 21 * * 0-4"
]
```

注: Phase 1 は daily のみ。market/weekly/monthly は Phase 1.5 以降。

- [ ] **Step 1.5: Anthropic Console で月予算を設定(ADR-0006 Layer 1)**

ブラウザで `https://console.anthropic.com/settings/billing` を開き:

1. **Monthly spend limit** を **$20 USD** に設定
2. **Usage alerts** で **50% / 80%** を有効化(email 通知)
3. 設定後、画面の合計予算が "$20.00 / month" になっていることを確認

これは API レイヤーの最後の砦で、コード側の budget guard が全て失敗しても月 $20 を超えない保証になる。**コードを書く前にやっておくのが望ましいが、Phase 1 終盤のここで必ず確認する**。

- [ ] **Step 2: シークレットを設定**

```bash
cd apps/worker
pnpm wrangler secret put ANTHROPIC_API_KEY
# プロンプトで sk-ant-... を貼る
pnpm wrangler secret put DISCORD_WEBHOOK_URL
# プロンプトで https://discord.com/api/webhooks/... を貼る
```

- [ ] **Step 3: リモート D1 にマイグレーションを適用**

Run: `cd apps/worker && pnpm db:migrate:remote`
Expected: 全テーブルが本番 D1 に作成される旨のログ

- [ ] **Step 4: deploy**

Run: `cd apps/worker && pnpm run deploy`(`run` を省くと pnpm built-in の workspace deploy が走る)
Expected: `https://finews.<account>.workers.dev` にデプロイされる

- [ ] **Step 5: ローカルで scheduled handler を発火**

Run: `cd apps/worker && pnpm wrangler dev --test-scheduled --remote --var ENVIRONMENT:production`

別ターミナルで:

```bash
curl "http://localhost:8787/__scheduled?cron=30+21+*+*+0-4"
```

Expected:
- 標準出力に `{ job: 'daily', articlesFetched: N, fresh: M, extracted: K, ... }` が出る
- **Discord チャネルに半導体領域のダイジェストが届く**

- [ ] **Step 6: 本番 Cron でリハーサル**

Cloudflare Dashboard で Worker の "Triggers" タブから `30 21 * * 0-4` を **manual trigger** で発火、Discord 到達を確認。

- [ ] **Step 7: Commit**

```bash
git add apps/worker/wrangler.toml
git commit -m "feat: enable daily cron trigger and deploy to production"
```

---

## Phase 1 完了条件チェックリスト

- [x] `pnpm typecheck` がエラーなしで完了する(2026-05-24 確認)
- [x] `pnpm test` で dedup と budget-guard のテストが PASS する(12 passed、Stage 1 live API は 3 skipped — API key 設定後にローカルで実行)
- [ ] 手動 cron 発火で Discord に半導体領域のダイジェスト 1 通が届く(Task 14 Step F、ユーザー手動)
- [ ] `articles` テーブルに最低 1 件のレコードが入る(同上)
- [ ] `deliveries` テーブルに `success` レコードが入る(同上)
- [ ] 翌平日 6:30 JST に自動配信が走り、Discord に届く(ユーザー観察)

完了したら Phase 1.5 へ進む(残り 3 領域、ETF、watchlist alias、継続テーマスコア)。

---

## 実装中の規約変更・修正履歴

Phase 1 実装中に判明し、設計に取り込んだ変更:

1. **依存バージョン全体最新化** (commit `6bc1417`) — 当初の plan は古い caret range を採用していたが、wrangler 3 → 4、drizzle-orm 0.36 → 0.45、@anthropic-ai/sdk 0.30 → 0.98 など、2026-05-23 時点の latest に揃え直した。Task 1 の `apps/worker/package.json` の依存ブロックは現状の最新版を反映済み。

2. **コスト暴走対策の組込み** (ADR-0006、Task 6.5、commit `2fa880d` / `59a1c08`) — 当初 plan には budget guard が無く、レビューで欠落が判明。Task 6.5 を挿入し、`BudgetTracker` / `withRetry` / `deliveries` 拡張(input/output tokens + cost)を全 Stage に適用。

3. **Reuters / Yahoo Finance が 401** (Task 4 検証結果) — `scripts/verify-sources.sh` で確認。Phase 1 は FRB / BOJ / Nikkei xTech / BBC Business の 4 ソースで運用。Phase 1.5 で Yahoo Finance の代替検討が必要。

4. **Drizzle タイムスタンプ規約適用** (commit `6882c4d`) — Drizzle ハーネスの「createdAt + updatedAt 必須、SQLite は ISO 8601 text」規約に合わせて全テーブルを refactor。可変テーブルに `createdAt` / `updatedAt`、不変単一イベントテーブル(`summaries` / `marketSnapshots` / `etfSnapshots` / `deliveries`)はドメイン名タイムスタンプのまま例外適用。snapshot 系は `date` → `snapshotDate` にリネーム。初回マイグレーション `0000_*.sql` はリモート未適用だったため `rm` + `db:generate` で再生成。Task 3 の schema コードブロックは古い integer 版のまま残しているが、現行の `apps/worker/src/db/schema.ts` を正とする。

5. **コード単純化** (commit `6882c4d`) — Phase 1 完了時の横断レビューで判明した重複・冗長を整理: stage1/stage2 のテキスト抽出(filter+map → map のみ)、discord.ts の `postWebhook` 抽出、daily.ts の `for...of + .entries()`、Discord BudgetExceeded メッセージの行分割。

---

## Self-Review Notes

設計書セクションとの突合せ:

- ✅ §3 配信スケジュール → Task 14 で `30 21 * * 0-4` のみ設定(他は Phase 1.5+)
- ✅ §5.1 daily データフロー → Task 13 で 1-9 ステップを実装(ETF/market は省略)
- ✅ §7 D1 スキーマ → Task 3 で全テーブル作成
- ✅ §8.1 ニュースソース → Task 4 検証結果に応じて Task 5 で確定
- ✅ §9.1 Stage 1 → Task 9 で TDD 実装
- ✅ §9.2 Stage 2 Daily → Task 11 で 1 領域版実装(キャッシュ含む)
- ✅ §10 Discord フォーマット → Task 12 で 1 メッセージ版実装(4 分割は Phase 1.5)
- ✅ §13 Phase 1 必須テスト → Task 6 (dedup), Task 9 (Stage 1)
- ✅ §14 検証 TODO #1, #4 → Task 4

スコープ外を含めない確認:
- ❌ market_fetcher / etf_fetcher → Phase 1.5
- ❌ weekly/monthly ジョブ → Phase 1.5+
- ❌ glossary 蓄積 → Phase 1.5
- ❌ 継続テーマスコア計算 → Phase 1.5
- ❌ alias マッチング → Phase 1.5
- ❌ 休場日処理 → Phase 1.5
- ❌ 4 メッセージ分割 → Phase 1.5
