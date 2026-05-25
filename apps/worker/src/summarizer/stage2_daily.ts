import Anthropic from '@anthropic-ai/sdk';
import type { ExtractedArticle } from '@finews/shared';
import { STAGE2_DAILY_SYSTEM, stage2DailyUser } from './prompts';
import type { MarketDataForPrompt, PreviousContext } from './prompts';
import { watchlistTickers } from '../config/watchlist';
import type { Domain } from '../config/sources';
import { BudgetTracker } from '../lib/budget-guard';
import { withRetry } from '../lib/retry';

export type Stage2DailyInput = {
  domain: Domain;
  articles: ExtractedArticle[];
  marketData?: MarketDataForPrompt;
  previousContext?: PreviousContext;
};

export async function generateDailySummary(
  input: Stage2DailyInput,
  apiKey: string,
  tracker: BudgetTracker,
): Promise<string> {
  tracker.assertCanCall('stage2');
  const client = new Anthropic({ apiKey });
  const model = 'claude-sonnet-4-6';
  const response = await withRetry(() =>
    client.messages.create({
      model,
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
          content: stage2DailyUser(input.domain, input.articles, watchlistTickers, input.marketData, input.previousContext),
        },
      ],
    }),
  );
  tracker.recordCall('stage2', model, response.usage.input_tokens, response.usage.output_tokens);

  return response.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('');
}
