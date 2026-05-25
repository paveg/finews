export const SCORING = {
  significanceThreshold: 3,
  maxArticlesForStage1: 10,
  maxArticlesForStage2: 6,
  stage1Concurrency: 8,
  dedupWindowDays: 7,
} as const;

export const MONTHLY_BUDGET = {
  limitUsdMicro: 20_000_000, // $20 hard cap (matches Anthropic Console limit)
} as const;
