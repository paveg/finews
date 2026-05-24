import { gte } from 'drizzle-orm';
import { createDb } from '../db/client';
import { articles, deliveries } from '../db/schema';
import { newsSources, type Domain } from '../config/sources';
import { fetchAllSources } from '../fetchers/news';
import { extractArticle } from '../summarizer/stage1';
import { generateDailySummary } from '../summarizer/stage2_daily';
import { isWatchlistMatched } from '../matchers/watchlist';
import { sendDailyEmbed, sendPlainText } from '../notifier/discord';
import { BudgetTracker, BudgetExceededError } from '../lib/budget-guard';
import type { ExtractedArticle } from '@finews/shared';
import type { Env } from '../index';

const PHASE_1_DOMAIN: Domain = 'semiconductor';
const MAX_ARTICLES_FOR_STAGE2 = 6;

export async function runDaily(env: Env): Promise<void> {
  const db = createDb(env.DB);
  const tracker = new BudgetTracker();
  const startedAt = Date.now();

  try {
    // 1. RSS fetch
    const fetched = await fetchAllSources(newsSources);
    const targetSourceIds = new Set(
      newsSources.filter((s) => s.domain === PHASE_1_DOMAIN).map((s) => s.id),
    );
    const candidates = fetched.filter((a) => targetSourceIds.has(a.source));

    // 2. dedup: compare against past 7 days
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const existingRows = await db
      .select({ id: articles.id })
      .from(articles)
      .where(gte(articles.publishedAt, sevenDaysAgo));
    const existing = new Set(existingRows.map((r) => r.id));
    const fresh = candidates.filter((a) => !existing.has(a.id));

    // 3. rank by recency, cap at 15
    const ranked = fresh
      .sort((a, b) => b.publishedAt - a.publishedAt)
      .slice(0, 15);

    // 4. Stage 1 with concurrency 3
    const extracted: Array<{ raw: typeof ranked[0]; ex: ExtractedArticle }> = [];
    for (let i = 0; i < ranked.length; i += 3) {
      const batch = ranked.slice(i, i + 3);
      const results = await Promise.allSettled(
        batch.map((a) =>
          extractArticle(
            { title: a.title, description: a.description },
            env.ANTHROPIC_API_KEY,
            tracker,
          ).then((ex) => ({ raw: a, ex })),
        ),
      );
      for (let idx = 0; idx < results.length; idx++) {
        const r = results[idx];
        if (!r) continue;
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

    // 5. Persist articles
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

    // 6. Stage 2 input filter
    const stage2Input = extracted
      .filter(({ ex }) => ex.significance >= 3)
      .sort((a, b) => b.ex.significance - a.ex.significance)
      .slice(0, MAX_ARTICLES_FOR_STAGE2)
      .map(({ ex }) => ex);

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
        attemptedAt: now,
      });
      return;
    }

    // 7. Stage 2
    const summaryText = await generateDailySummary(
      { domain: PHASE_1_DOMAIN, articles: stage2Input },
      env.ANTHROPIC_API_KEY,
      tracker,
    );

    // 8. Deliver
    await sendDailyEmbed(env.DISCORD_WEBHOOK_URL, {
      domain: PHASE_1_DOMAIN,
      body: summaryText,
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
      attemptedAt: now,
    });

    console.log({
      job: 'daily',
      articlesFetched: fetched.length,
      fresh: fresh.length,
      extracted: extracted.length,
      stage2Input: stage2Input.length,
      durationMs: Date.now() - startedAt,
      budget: finalSummary,
    });
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      const summary = tracker.summary();
      const now = Date.now();
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
        attemptedAt: now,
      });
      // Plain-text Discord notification — does NOT call Anthropic again
      try {
        await sendPlainText(
          env.DISCORD_WEBHOOK_URL,
          `⚠️ finews: 予算上限到達のため daily ジョブを中断しました\n${err.message}\nStage1 calls: ${summary.stage1Calls}, Stage2 calls: ${summary.stage2Calls}, cost: $${(summary.costUsdMicro / 1_000_000).toFixed(4)}`,
        );
      } catch (notifyErr) {
        console.error({ notifyErr: String(notifyErr) });
      }
      return;
    }
    throw err;
  }
}
