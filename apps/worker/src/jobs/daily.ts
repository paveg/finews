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
import type { MarketDataForPrompt } from '../summarizer/prompts';
import type { ExtractedArticle } from '@finews/shared';
import type { Env } from '../index';
import type { Db } from '../db/client';

const PHASE_1_DOMAIN: Domain = 'semiconductor';
const MAX_ARTICLES_FOR_STAGE1 = 10;
const MAX_ARTICLES_FOR_STAGE2 = 6;
const STAGE1_CONCURRENCY = 8;
const DEDUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
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
    const watchlistSymbols = watchlistEntries.map(toStooqSymbol);
    const contextSymbols = CONTEXT_INDICATORS.map((i) => i.stooqSymbol);
    const allStooqSymbols = [...watchlistSymbols, ...contextSymbols];

    const [stooqRows, vixQuote] = await Promise.all([
      fetchStooqPrices(allStooqSymbols),
      fetchVix(),
    ]);

    const today = new Date().toISOString().split('T')[0] ?? '';
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0] ?? '';

    const prevSnapshots = await db
      .select({ symbol: marketSnapshots.symbol, price: marketSnapshots.price })
      .from(marketSnapshots)
      .where(eq(marketSnapshots.snapshotDate, yesterday));
    const prevMap = new Map(prevSnapshots.map((r) => [r.symbol, r.price]));

    const quotes: MarketQuote[] = [];
    for (const entry of watchlistEntries) {
      const stooqSym = toStooqSymbol(entry);
      const row = stooqRows.find((r) => r.symbol === stooqSym);
      if (!row) continue;
      const prev = prevMap.get(entry.ticker);
      const changePct1d = prev ? ((row.close - prev) / prev) * 100 : null;
      quotes.push({ symbol: entry.ticker, close: row.close, changePct1d, date: row.date });
    }

    const context: MarketQuote[] = [];
    for (const ind of CONTEXT_INDICATORS) {
      const row = stooqRows.find((r) => r.symbol === ind.stooqSymbol);
      if (!row) continue;
      const prev = prevMap.get(ind.name);
      const changePct1d = prev ? ((row.close - prev) / prev) * 100 : null;
      context.push({ symbol: ind.name, close: row.close, changePct1d, date: row.date });
    }
    if (vixQuote) context.push(vixQuote);

    const snapshotsToInsert = [
      ...quotes.map((q) => ({
        snapshotDate: today,
        symbol: q.symbol,
        price: q.close,
        changePct1d: q.changePct1d,
      })),
      ...context.map((c) => ({
        snapshotDate: today,
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
    console.warn({ job: 'daily', stage: 'market_fetch', error: String(err) });
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
      .slice(0, MAX_ARTICLES_FOR_STAGE1);

    // 4. Stage 1 with concurrency to keep total wall time under ~20s
    const extracted: Array<{ raw: typeof ranked[0]; ex: ExtractedArticle }> = [];
    for (let i = 0; i < ranked.length; i += STAGE1_CONCURRENCY) {
      const batch = ranked.slice(i, i + STAGE1_CONCURRENCY);
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
            error: String(r.reason),
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
      .slice(0, MAX_ARTICLES_FOR_STAGE2)
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

    // 7. Stage 2
    const marketData: MarketDataForPrompt | undefined = marketResult ?? undefined;
    const summaryText = await generateDailySummary(
      { domain: PHASE_1_DOMAIN, articles: stage2Input, marketData },
      env.ANTHROPIC_API_KEY,
      tracker,
    );

    // 8. Deliver via Forum thread
    const sections = splitSections(summaryText);
    const todayStr = new Date().toISOString().split('T')[0] ?? '';
    const domainTitle = DOMAIN_TITLES[PHASE_1_DOMAIN] ?? PHASE_1_DOMAIN;
    await sendForumDigest(env.DISCORD_WEBHOOK_URL, {
      threadName: `${todayStr} ${domainTitle}`,
      title: `📰 ${domainTitle}`,
      color: DOMAIN_COLORS[PHASE_1_DOMAIN] ?? 0x95a5a6,
      overview: sections.overview,
      detail: sections.detail,
      glossary: sections.glossary,
    });

    // 9. Log success
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
        console.error({ notifyErr: String(notifyErr) });
      }
      return;
    }
    throw err;
  }
}
