import { describe, it, expect } from 'vitest';
import {
  BudgetTracker,
  BudgetExceededError,
  estimateCostMicroUsd,
} from '../../src/lib/budget-guard';

describe('BudgetTracker', () => {
  it('allows calls under the limit', () => {
    const t = new BudgetTracker();
    t.recordCall('stage1', 'claude-haiku-4-5-20251001', 1000, 200);
    expect(t.summary().stage1Calls).toBe(1);
    expect(t.summary().inputTokens).toBe(1000);
  });

  it('throws BudgetExceededError when stage1 call count exceeds limit', () => {
    const t = new BudgetTracker();
    for (let i = 0; i < 30; i++) {
      t.recordCall('stage1', 'claude-haiku-4-5-20251001', 10, 10);
    }
    expect(() => t.assertCanCall('stage1')).toThrow(BudgetExceededError);
  });

  it('throws BudgetExceededError when input tokens exceed limit', () => {
    const t = new BudgetTracker();
    t.recordCall('stage1', 'claude-haiku-4-5-20251001', 200_001, 0);
    expect(() => t.assertCanCall('stage1')).toThrow(BudgetExceededError);
  });

  it('accumulates cost across multiple calls', () => {
    const t = new BudgetTracker();
    t.recordCall('stage1', 'claude-haiku-4-5-20251001', 1_000_000, 0);
    t.recordCall('stage2', 'claude-sonnet-4-6', 1_000_000, 0);
    // Haiku: $1/M input = 1_000_000 micro USD
    // Sonnet: $3/M input = 3_000_000 micro USD
    expect(t.summary().costUsdMicro).toBe(4_000_000);
  });
});

describe('estimateCostMicroUsd', () => {
  it('computes Haiku cost correctly', () => {
    // $1 input + $5 output per MTok
    expect(
      estimateCostMicroUsd('claude-haiku-4-5-20251001', 1000, 100),
    ).toBe(1000 * 1 + 100 * 5);
  });

  it('returns 0 for unknown model', () => {
    expect(estimateCostMicroUsd('unknown-model', 1000, 100)).toBe(0);
  });
});
