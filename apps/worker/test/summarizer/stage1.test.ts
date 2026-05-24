import { describe, it, expect } from 'vitest';
import * as v from 'valibot';
import { ExtractedArticleSchema } from '@finews/shared';
import { extractArticle } from '../../src/summarizer/stage1';
import { BudgetTracker } from '../../src/lib/budget-guard';
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
      const result = await extractArticle(fixture, env.ANTHROPIC_API_KEY, new BudgetTracker());
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
