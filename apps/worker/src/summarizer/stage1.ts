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
