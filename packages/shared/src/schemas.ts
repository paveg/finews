import * as v from 'valibot';

// LLM (Anthropic Tool Use) は `required` フィールドの存在は守るが、
// maxLength / minimum / maximum はソフトな hint 扱いで厳密強制されない。
// このため Valibot 側は受け入れ可能な範囲を緩く取り、Stage 1 の後処理
// (apps/worker/src/summarizer/stage1.ts)で truncate して契約を満たす。

export const ExtractedArticleSchema = v.object({
  headline_ja: v.string(),
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
  rationale: v.string(),
  glossary_terms: v.array(
    v.object({
      term: v.string(),
      definition: v.string(),
    }),
  ),
});

export type ExtractedArticle = v.InferOutput<typeof ExtractedArticleSchema>;

/**
 * Stage 1 出力の契約値 (spec §9.1)。LLM が守らない可能性があるため、
 * Stage 1 で truncate / slice により正規化して契約を満たす。
 */
export const EXTRACTED_LIMITS = {
  HEADLINE_JA_MAX: 80,
  RATIONALE_MAX: 60,
  GLOSSARY_DEFINITION_MAX: 50,
  GLOSSARY_TERMS_MAX_COUNT: 3,
} as const;
