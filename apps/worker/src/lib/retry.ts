import { BUDGET } from '../config/budget';

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export type RetryOptions = {
  maxAttempts?: number;
  backoffBaseMs?: number;
};

function isRetryable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const status = (err as { status?: number }).status;
  return typeof status === 'number' && RETRYABLE_STATUSES.has(status);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? BUDGET.MAX_RETRIES;
  const backoffBase = opts.backoffBaseMs ?? BUDGET.BACKOFF_BASE_MS;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err)) throw err;
      if (attempt === maxAttempts - 1) break;
      const delay = backoffBase * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
