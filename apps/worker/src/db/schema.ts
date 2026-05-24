import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  primaryKey,
} from 'drizzle-orm/sqlite-core';

// Phase 1 actively populates: `articles`, `deliveries`.
// Phase 1.5+ populates: `watchlist` (alias matching), `marketSnapshots`,
// `etfSnapshots`, `summaries`, `glossary`.
// All tables are defined upfront per design spec to keep migrations linear.
//
// Timestamp convention (Drizzle hook):
//   - Mutable tables (`articles`, `watchlist`, `glossary`) carry
//     `createdAt` + `updatedAt` (ISO 8601 text, UTC).
//   - Immutable single-event tables (`summaries`, `marketSnapshots`,
//     `etfSnapshots`, `deliveries`) use a single domain-named timestamp
//     per the exception in the hook — row creation IS the only event.

const timestampDefault = () => new Date().toISOString();

export const articles = sqliteTable(
  'articles',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull(),
    domain: text('domain').notNull(),
    url: text('url').notNull(),
    title: text('title').notNull(),
    publishedAt: text('published_at').notNull(),
    extractedJson: text('extracted_json'),
    watchlistMatched: integer('watchlist_matched', { mode: 'boolean' })
      .notNull()
      .default(false),
    continuingThemeScore: integer('continuing_theme_score').notNull().default(0),
    createdAt: text('created_at').notNull().$defaultFn(timestampDefault),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(timestampDefault)
      .$onUpdate(timestampDefault),
  },
  (t) => ({
    publishedIdx: index('idx_articles_published').on(t.publishedAt),
    domainPublishedIdx: index('idx_articles_domain').on(
      t.domain,
      t.publishedAt,
    ),
  }),
);

// Immutable: one row per (jobType, domain, deliveredAt). `deliveredAt` is the only event.
export const summaries = sqliteTable(
  'summaries',
  {
    id: text('id').primaryKey(),
    jobType: text('job_type').notNull(),
    domain: text('domain').notNull(),
    content: text('content').notNull(),
    articleIds: text('article_ids').notNull(),
    modelUsed: text('model_used').notNull(),
    deliveredAt: text('delivered_at').notNull().$defaultFn(timestampDefault),
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
  createdAt: text('created_at').notNull().$defaultFn(timestampDefault),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(timestampDefault)
    .$onUpdate(timestampDefault),
});

// Immutable daily snapshot: composite PK (snapshotDate, symbol) IS the event.
export const marketSnapshots = sqliteTable(
  'market_snapshots',
  {
    snapshotDate: text('snapshot_date').notNull(),
    symbol: text('symbol').notNull(),
    price: real('price').notNull(),
    changePct1d: real('change_pct_1d'),
    rawJson: text('raw_json'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.snapshotDate, t.symbol] }),
  }),
);

// Immutable daily snapshot: composite PK (snapshotDate, symbol) IS the event.
export const etfSnapshots = sqliteTable(
  'etf_snapshots',
  {
    snapshotDate: text('snapshot_date').notNull(),
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
    pk: primaryKey({ columns: [t.snapshotDate, t.symbol] }),
    symbolDateIdx: index('idx_etf_symbol_date').on(t.symbol, t.snapshotDate),
  }),
);

export const glossary = sqliteTable('glossary', {
  term: text('term').primaryKey(),
  definition: text('definition').notNull(),
  occurrenceCount: integer('occurrence_count').notNull().default(1),
  createdAt: text('created_at').notNull().$defaultFn(timestampDefault),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(timestampDefault)
    .$onUpdate(timestampDefault),
});

// Immutable job-attempt log: one row per (jobType, step, attemptedAt). `attemptedAt` is the only event.
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
  attemptedAt: text('attempted_at').notNull().$defaultFn(timestampDefault),
});
