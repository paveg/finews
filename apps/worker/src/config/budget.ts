export const BUDGET = {
  MAX_STAGE1_CALLS_PER_JOB: 30,
  MAX_STAGE2_CALLS_PER_JOB: 5,
  MAX_INPUT_TOKENS_PER_JOB: 200_000,
  MAX_OUTPUT_TOKENS_PER_JOB: 50_000,
  MAX_RETRIES: 3,
  BACKOFF_BASE_MS: 1000,
} as const;

export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-opus-4-7': { input: 5, output: 25 },
};

export type ModelId = keyof typeof MODEL_PRICING | string;
