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
