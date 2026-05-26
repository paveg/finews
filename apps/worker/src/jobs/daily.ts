import { eq, gte } from 'drizzle-orm';
import { createDb } from '../db/client';
import { articles, deliveries, marketSnapshots } from '../db/schema';
import { newsSources, type Domain } from '../config/sources';
import { fetchAllSources } from '../fetchers/news';
import {
  fetchStooqPrices,
  fetchVix,
  toStooqSymbol,
  CONTEXT_INDICATORS,
  type MarketQuote,
} from '../fetchers/market';
import { watchlistEntries } from '../config/watchlist';
import { extractArticle } from '../summarizer/stage1';
import { generateDailySummary } from '../summarizer/stage2_daily';
import { isWatchlistMatched } from '../matchers/watchlist';
import { sendForumDigest, sendPlainText, DOMAIN_COLORS, DOMAIN_TITLES } from '../notifier/discord';
import { BudgetTracker, BudgetExceededError } from '../lib/budget-guard';
import { isMarketHoliday } from '../config/holidays';
import { SCORING, MONTHLY_BUDGET } from '../config/scoring';
import type { MarketDataForPrompt, PreviousContext } from '../summarizer/prompts';
import type { ExtractedArticle } from '@finews/shared';
import type { Env } from '../index';
import type { Db } from '../db/client';

const PHASE_1_DOMAIN: Domain = 'semiconductor';
const DEDUP_WINDOW_MS = SCORING.dedupWindowDays * 24 * 60 * 60 * 1000;
// fetch handler (/__run-daily リハ用) の wall time は 30 秒固定。
// scheduled handler 経由(natural cron)なら 15 分 CPU 使えるが、
// リハ可能にするため Stage 1 を絞り + 並列度を上げる。

function splitSections(text: string): { overview: string; detail: string; glossary: string } {
  const parts = text.split('---SECTION---').map((s) => s.trim());
  if (parts.length >= 3) return { overview: parts[0] ?? '', detail: parts[1] ?? '', glossary: parts[2] ?? '' };
  if (parts.length === 2) return { overview: parts[0] ?? '', detail: parts[1] ?? '', glossary: '' };
  return { overview: text, detail: '', glossary: '' };
}

async function fetchMarketQuotes(
  db: Db,
): Promise<{ quotes: MarketQuote[]; context: MarketQuote[] } | null> {
  try {
    const today = new Date();
    const usOpen = !isMarketHoliday(today, 'us');
    const jpOpen = !isMarketHoliday(today, 'jp');

    const activeEntries = watchlistEntries.filter(
      (e) => (e.market === 'us' && usOpen) || (e.market === 'jp' && jpOpen),
    );
    const activeIndicators = CONTEXT_INDICATORS.filter(
      (i) => i.market === null || (i.market === 'us' && usOpen) || (i.market === 'jp' && jpOpen),
    );

    const watchlistSymbols = activeEntries.map(toStooqSymbol);
    const contextSymbols = activeIndicators.map((i) => i.stooqSymbol);
    const allStooqSymbols = [...watchlistSymbols, ...contextSymbols];

    if (allStooqSymbols.length === 0) return { quotes: [], context: [] };

    const todayStr = today.toISOString().split('T')[0] ?? '';

    // Same-day cache: skip fetch if today's snapshots already exist
    const cached = await db
      .select({ symbol: marketSnapshots.symbol, price: marketSnapshots.price, changePct1d: marketSnapshots.changePct1d })
      .from(marketSnapshots)
      .where(eq(marketSnapshots.snapshotDate, todayStr));
    if (cached.length > 0) {
      const cacheMap = new Map(cached.map((r) => [r.symbol, r]));
      const quotes: MarketQuote[] = activeEntries
        .filter((e) => cacheMap.has(e.ticker))
        .map((e) => {
          const c = cacheMap.get(e.ticker)!;
          return { symbol: e.ticker, close: c.price, changePct1d: c.changePct1d, date: todayStr };
        });
      const context: MarketQuote[] = activeIndicators
        .filter((i) => cacheMap.has(i.name))
        .map((i) => {
          const c = cacheMap.get(i.name)!;
          return { symbol: i.name, close: c.price, changePct1d: c.changePct1d, date: todayStr };
        });
      const vix = cacheMap.get('VIX');
      if (vix) context.push({ symbol: 'VIX', close: vix.price, changePct1d: vix.changePct1d, date: todayStr });
      console.log({ job: 'daily', stage: 'market_fetch', cache_hit: true, symbols: cached.length });
      return { quotes, context };
    }

    const [stooqRows, vixQuote] = await Promise.all([
      fetchStooqPrices(allStooqSymbols),
      usOpen ? fetchVix() : Promise.resolve(null),
    ]);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0] ?? '';

    const prevSnapshots = await db
      .select({ symbol: marketSnapshots.symbol, price: marketSnapshots.price })
      .from(marketSnapshots)
      .where(eq(marketSnapshots.snapshotDate, yesterday));
    const prevMap = new Map(prevSnapshots.map((r) => [r.symbol, r.price]));

    const quotes: MarketQuote[] = [];
    for (const entry of activeEntries) {
      const stooqSym = toStooqSymbol(entry);
      const row = stooqRows.find((r) => r.symbol === stooqSym);
      if (!row) continue;
      const prev = prevMap.get(entry.ticker);
      const changePct1d = prev ? ((row.close - prev) / prev) * 100 : null;
      quotes.push({ symbol: entry.ticker, close: row.close, changePct1d, date: row.date });
    }

    const context: MarketQuote[] = [];
    for (const ind of activeIndicators) {
      const row = stooqRows.find((r) => r.symbol === ind.stooqSymbol);
      if (!row) continue;
      const prev = prevMap.get(ind.name);
      const changePct1d = prev ? ((row.close - prev) / prev) * 100 : null;
      context.push({ symbol: ind.name, close: row.close, changePct1d, date: row.date });
    }
    if (vixQuote) context.push(vixQuote);

    const snapshotsToInsert = [
      ...quotes.map((q) => ({
        snapshotDate: todayStr,
        symbol: q.symbol,
        price: q.close,
        changePct1d: q.changePct1d,
      })),
      ...context.map((c) => ({
        snapshotDate: todayStr,
        symbol: c.symbol,
        price: c.close,
        changePct1d: c.changePct1d,
      })),
    ];
    for (const snap of snapshotsToInsert) {
      await db.insert(marketSnapshots).values(snap).onConflictDoNothing();
    }

    return { quotes, context };
  } catch (err) {
    console.warn({ job: 'daily', stage: 'market_fetch', error: err instanceof Error ? err.message : 'Unknown error' });
    return null;
  }
}

export async function runDaily(env: Env): Promise<void> {
  const db = createDb(env.DB);
  const tracker = new BudgetTracker();
  const startedAt = Date.now();

  // 0. Holiday check — skip if both US and JP markets are closed
  const today = new Date();
  if (isMarketHoliday(today, 'us') && isMarketHoliday(today, 'jp')) {
    console.log({ job: 'daily', skipped: 'market_holiday' });
    await db.insert(deliveries).values({
      id: crypto.randomUUID(),
      jobType: 'daily',
      step: 'holiday_check',
      status: 'skipped',
      error: 'US + JP both closed',
      durationMs: Date.now() - startedAt,
      inputTokens: 0,
      outputTokens: 0,
      costUsdMicro: 0,
    });
    return;
  }

  // 0b. Monthly cost guard — refuse to run if monthly spend exceeds limit
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
  const monthlySpend = await db
    .select({ total: deliveries.costUsdMicro })
    .from(deliveries)
    .where(gte(deliveries.attemptedAt, monthStart));
  const totalCostThisMonth = monthlySpend.reduce((sum, r) => sum + (r.total ?? 0), 0);
  if (totalCostThisMonth >= MONTHLY_BUDGET.limitUsdMicro) {
    console.warn({ job: 'daily', skipped: 'monthly_budget_exceeded', totalCostThisMonth });
    await db.insert(deliveries).values({
      id: crypto.randomUUID(),
      jobType: 'daily',
      step: 'monthly_budget',
      status: 'skipped',
      error: `Monthly cost $${(totalCostThisMonth / 1_000_000).toFixed(2)} >= limit $${(MONTHLY_BUDGET.limitUsdMicro / 1_000_000).toFixed(2)}`,
      durationMs: Date.now() - startedAt,
      inputTokens: 0,
      outputTokens: 0,
      costUsdMicro: 0,
    });
    return;
  }

  try {
    // 1. RSS fetch + Market data fetch (parallel)
    const [fetched, marketResult] = await Promise.all([
      fetchAllSources(newsSources),
      fetchMarketQuotes(db),
    ]);
    const targetSourceIds = new Set(
      newsSources.filter((s) => s.domain === PHASE_1_DOMAIN).map((s) => s.id),
    );
    const candidates = fetched.filter((a) => targetSourceIds.has(a.source));

    // 2. dedup: compare against past 7 days (ISO strings sort lexicographically)
    const sevenDaysAgoIso = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
    const existingRows = await db
      .select({ id: articles.id })
      .from(articles)
      .where(gte(articles.publishedAt, sevenDaysAgoIso));
    const existing = new Set(existingRows.map((r) => r.id));
    const fresh = candidates.filter((a) => !existing.has(a.id));

    // 3. rank by recency, cap to fit fetch handler 30s wall time
    const ranked = fresh
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, SCORING.maxArticlesForStage1);

    // 4. Stage 1 with concurrency to keep total wall time under ~20s
    const extracted: Array<{ raw: typeof ranked[0]; ex: ExtractedArticle }> = [];
    for (let i = 0; i < ranked.length; i += SCORING.stage1Concurrency) {
      const batch = ranked.slice(i, i + SCORING.stage1Concurrency);
      const results = await Promise.allSettled(
        batch.map((a) =>
          extractArticle(
            { title: a.title, description: a.description },
            env.ANTHROPIC_API_KEY,
            tracker,
          ).then((ex) => ({ raw: a, ex })),
        ),
      );
      for (const [idx, r] of results.entries()) {
        if (r.status === 'fulfilled') {
          extracted.push(r.value);
        } else {
          const article = batch[idx];
          console.warn({
            job: 'daily',
            stage: 'stage1',
            source: article?.source,
            url: article?.url,
            error: r.reason instanceof Error ? r.reason.message : 'Unknown error',
          });
        }
      }
    }

    // 5. Persist articles (createdAt/updatedAt filled by $defaultFn)
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
          watchlistMatched: isWatchlistMatched(ex.tickers, ex.ticker_aliases_used),
          continuingThemeScore: 0,
        })
        .onConflictDoNothing();
    }

    // 6. Stage 2 input filter (keep sourceUrl for link attribution)
    const stage2Input = extracted
      .filter(({ ex }) => ex.significance >= 3)
      .sort((a, b) => b.ex.significance - a.ex.significance)
      .slice(0, SCORING.maxArticlesForStage2)
      .map(({ raw, ex }) => ({ ...ex, sourceUrl: raw.url }));

    if (stage2Input.length === 0) {
      console.log({ job: 'daily', skipped: 'no significant articles' });
      const summary = tracker.summary();
      await db.insert(deliveries).values({
        id: crypto.randomUUID(),
        jobType: 'daily',
        step: 'stage2_semiconductor',
        status: 'skipped',
        error: 'no significant articles',
        durationMs: Date.now() - startedAt,
        inputTokens: summary.inputTokens,
        outputTokens: summary.outputTokens,
        costUsdMicro: summary.costUsdMicro,
      });
      return;
    }

    // 7. Sanity gate: discard stale market data (older than 2 trading days)
    const todayDate = today.toISOString().split('T')[0] ?? '';
    const staleThreshold = new Date(Date.now() - 3 * 86_400_000).toISOString().split('T')[0] ?? '';
    const marketData: MarketDataForPrompt | undefined = marketResult
      ? {
          quotes: marketResult.quotes.filter((q) => q.date >= staleThreshold),
          context: marketResult.context.filter((c) => c.date >= staleThreshold),
        }
      : undefined;
    if (marketResult && marketData && marketData.quotes.length < marketResult.quotes.length) {
      console.warn({
        job: 'daily',
        stage: 'sanity_gate',
        droppedStaleQuotes: marketResult.quotes.length - marketData.quotes.length,
        threshold: staleThreshold,
      });
    }

    // 8. Stage 2 (with previous day context for state-change filter)
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0] ?? '';
    const prevSnaps = await db
      .select({ symbol: marketSnapshots.symbol, price: marketSnapshots.price, changePct1d: marketSnapshots.changePct1d })
      .from(marketSnapshots)
      .where(eq(marketSnapshots.snapshotDate, yesterday));
    const previousContext = prevSnaps.length > 0
      ? {
          quotes: prevSnaps.filter((s) => watchlistEntries.some((e) => e.ticker === s.symbol)).map((s) => ({ symbol: s.symbol, close: s.price, changePct1d: s.changePct1d, date: yesterday })),
          context: prevSnaps.filter((s) => !watchlistEntries.some((e) => e.ticker === s.symbol)).map((s) => ({ symbol: s.symbol, close: s.price, changePct1d: s.changePct1d, date: yesterday })),
        }
      : undefined;

    const summaryText = await generateDailySummary(
      { domain: PHASE_1_DOMAIN, articles: stage2Input, marketData, previousContext },
      env.ANTHROPIC_API_KEY,
      tracker,
    );

    // 8b. Build market summary (code-side, not LLM-generated)
    const marketSummaryLines: string[] = [];
    if (marketData && marketData.quotes.length > 0) {
      const relevantTickers = new Set(stage2Input.flatMap((a) => (a as { tickers?: string[] }).tickers ?? []));
      marketSummaryLines.push('📊 **ウォッチリスト速報**');
      for (const q of marketData.quotes) {
        const change = q.changePct1d !== null
          ? `(${q.changePct1d >= 0 ? '+' : ''}${q.changePct1d.toFixed(1)}%)`
          : '';
        const comment = relevantTickers.has(q.symbol) ? ' ← 関連ニュースあり' : '';
        marketSummaryLines.push(`**${q.symbol}** ${q.close} ${change}${comment}`);
      }
    }
    if (marketData && marketData.context.length > 0) {
      const parts = marketData.context.map((c) => {
        const change = c.changePct1d !== null
          ? `(${c.changePct1d >= 0 ? '+' : ''}${c.changePct1d.toFixed(1)}%)`
          : '';
        return `${c.symbol} ${c.close}${change}`;
      });
      marketSummaryLines.push(`市場背景: ${parts.join(' / ')}`);
    }
    if (marketData && marketData.quotes.length === 0 && marketData.context.length === 0) {
      marketSummaryLines.push('📊 本日の値動きデータは取得できませんでした');
    }

    // 9. Deliver via Forum thread
    const sections = splitSections(summaryText);
    const overviewWithMarket = marketSummaryLines.length > 0
      ? `${sections.overview}\n\n${marketSummaryLines.join('\n')}`
      : sections.overview;
    const todayStr = new Date().toISOString().split('T')[0] ?? '';
    const domainTitle = DOMAIN_TITLES[PHASE_1_DOMAIN] ?? PHASE_1_DOMAIN;
    await sendForumDigest(env.DISCORD_WEBHOOK_URL, {
      threadName: `${todayStr} ${domainTitle}`,
      title: `📰 ${domainTitle}`,
      color: DOMAIN_COLORS[PHASE_1_DOMAIN] ?? 0x95a5a6,
      overview: overviewWithMarket,
      detail: sections.detail,
      glossary: sections.glossary,
    });

    // 10. Log success
    const finalSummary = tracker.summary();
    await db.insert(deliveries).values({
      id: crypto.randomUUID(),
      jobType: 'daily',
      step: 'stage2_semiconductor',
      status: 'success',
      durationMs: Date.now() - startedAt,
      inputTokens: finalSummary.inputTokens,
      outputTokens: finalSummary.outputTokens,
      costUsdMicro: finalSummary.costUsdMicro,
    });

    console.log({
      job: 'daily',
      articlesFetched: fetched.length,
      fresh: fresh.length,
      extracted: extracted.length,
      stage2Input: stage2Input.length,
      watchlistMatchedCount: extracted.filter(({ ex }) =>
        isWatchlistMatched(ex.tickers, ex.ticker_aliases_used),
      ).length,
      stage2OutputChars: summaryText.length,
      priceDataFetched: marketResult
        ? marketResult.quotes.length + marketResult.context.length
        : 0,
      durationMs: Date.now() - startedAt,
      budget: finalSummary,
    });
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      const summary = tracker.summary();
      console.warn({ job: 'daily', budget_exceeded: err.message, summary });
      await db.insert(deliveries).values({
        id: crypto.randomUUID(),
        jobType: 'daily',
        step: 'budget_guard',
        status: 'budget_exceeded',
        error: err.message,
        durationMs: Date.now() - startedAt,
        inputTokens: summary.inputTokens,
        outputTokens: summary.outputTokens,
        costUsdMicro: summary.costUsdMicro,
      });
      // Plain-text Discord notification — does NOT call Anthropic again
      try {
        await sendPlainText(
          env.DISCORD_WEBHOOK_URL,
          [
            '⚠️ finews: 予算上限到達のため daily ジョブを中断しました',
            err.message,
            `Stage1 calls: ${summary.stage1Calls}, Stage2 calls: ${summary.stage2Calls}`,
            `Cost: $${(summary.costUsdMicro / 1_000_000).toFixed(4)}`,
          ].join('\n'),
        );
      } catch (notifyErr) {
        console.error({ notifyErr: notifyErr instanceof Error ? notifyErr.message : 'Unknown error' });
      }
      return;
    }
    throw err;
  }
}
