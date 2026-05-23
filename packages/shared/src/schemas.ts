import * as v from 'valibot';

export const ExtractedArticleSchema = v.object({
  headline_ja: v.pipe(v.string(), v.maxLength(80)),
  category: v.picklist([
    'earnings',
    'policy',
    'product',
    'macro_indicator',
    'm&a',
    'other',
  ]),
  tickers: v.array(v.string()),
  ticker_aliases_used: v.array(v.string()),
  indicators: v.array(v.string()),
  key_numbers: v.array(
    v.object({
      label: v.string(),
      value: v.string(),
    }),
  ),
  significance: v.pipe(v.number(), v.minValue(1), v.maxValue(5)),
  rationale: v.pipe(v.string(), v.maxLength(60)),
  glossary_terms: v.array(
    v.object({
      term: v.string(),
      definition: v.pipe(v.string(), v.maxLength(50)),
    }),
  ),
});

export type ExtractedArticle = v.InferOutput<typeof ExtractedArticleSchema>;
