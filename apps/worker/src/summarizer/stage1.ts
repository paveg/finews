import Anthropic from '@anthropic-ai/sdk';
import * as v from 'valibot';
import { ExtractedArticleSchema, type ExtractedArticle } from '@finews/shared';
import { STAGE1_SYSTEM, stage1UserPrompt } from './prompts';
import { BudgetTracker } from '../lib/budget-guard';
import { withRetry } from '../lib/retry';

export type Stage1Input = {
  title: string;
  description: string;
};

export async function extractArticle(
  input: Stage1Input,
  apiKey: string,
  tracker: BudgetTracker,
): Promise<ExtractedArticle> {
  tracker.assertCanCall('stage1');
  const client = new Anthropic({ apiKey });
  const model = 'claude-haiku-4-5-20251001';
  const response = await withRetry(() =>
    client.messages.create({
      model,
      max_tokens: 1024,
      system: STAGE1_SYSTEM,
      messages: [
        {
          role: 'user',
          content: stage1UserPrompt(input.title, input.description),
        },
      ],
    }),
  );
  tracker.recordCall('stage1', model, response.usage.input_tokens, response.usage.output_tokens);

  const text = response.content
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
