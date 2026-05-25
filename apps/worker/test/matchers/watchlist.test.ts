import { describe, it, expect } from 'vitest';
import { isWatchlistMatched, matchedTickers } from '../../src/matchers/watchlist';

describe('isWatchlistMatched', () => {
  it('matches exact ticker', () => {
    expect(isWatchlistMatched(['NVDA', 'INTC'])).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(isWatchlistMatched(['nvda'])).toBe(true);
  });

  it('returns false for unrelated tickers', () => {
    expect(isWatchlistMatched(['INTC', 'QCOM'])).toBe(false);
  });

  it('matches via alias', () => {
    expect(isWatchlistMatched([], ['エヌビディア'])).toBe(true);
  });

  it('matches alias case-insensitively', () => {
    expect(isWatchlistMatched([], ['nvidia'])).toBe(true);
  });

  it('normalizes full-width to half-width', () => {
    expect(isWatchlistMatched([], ['ＮＶＩＤＩＡ'])).toBe(true);
  });

  it('matches Japanese stock ticker', () => {
    expect(isWatchlistMatched(['6857.T'])).toBe(true);
  });

  it('handles empty arrays', () => {
    expect(isWatchlistMatched([])).toBe(false);
  });
});

describe('matchedTickers', () => {
  it('returns matched tickers from direct match', () => {
    expect(matchedTickers(['NVDA', 'INTC'])).toEqual(['NVDA']);
  });

  it('returns matched tickers from alias', () => {
    expect(matchedTickers([], ['キオクシア'])).toEqual(['285A.T']);
  });

  it('deduplicates when both ticker and alias match', () => {
    expect(matchedTickers(['NVDA'], ['Nvidia'])).toEqual(['NVDA']);
  });
});
