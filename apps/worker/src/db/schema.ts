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
