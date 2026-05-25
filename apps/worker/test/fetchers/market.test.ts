import { describe, it, expect } from 'vitest';
import { parseStooqCsv, toStooqSymbol, parseVixJson } from '../../src/fetchers/market';
import type { WatchlistEntry } from '../../src/config/watchlist';

const STOOQ_FIXTURE = `Symbol,Date,Time,Open,High,Low,Close,Volume
NVDA.US,2026-05-22,22:00:18,220.904,221.01,214.8,215.33,169275710
285A.JP,2026-05-22,08:00:00,57500,58880,56280,57400,25359700
^SPX,2026-05-22,23:00:00,7468.8,7506.3,7463.3,7473.5,2697941253
USDJPY,2026-05-25,17:37:20,158.878,159.0415,158.7585,158.9005,`;

describe('parseStooqCsv', () => {
  it('parses multi-row CSV into typed rows', () => {
    const rows = parseStooqCsv(STOOQ_FIXTURE);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({
      symbol: 'NVDA.US',
      date: '2026-05-22',
      close: 215.33,
      volume: 169275710,
    });
  });

  it('handles missing volume (trailing comma)', () => {
    const rows = parseStooqCsv(STOOQ_FIXTURE);
    expect(rows[3].volume).toBeNull();
  });

  it('skips rows with N/D values', () => {
    const csv = `Symbol,Date,Time,Open,High,Low,Close,Volume
^VIX,N/D,N/D,N/D,N/D,N/D,N/D,N/D`;
    expect(parseStooqCsv(csv)).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    expect(parseStooqCsv('')).toHaveLength(0);
  });
});

describe('toStooqSymbol', () => {
  it('converts US ticker', () => {
    const entry: WatchlistEntry = { ticker: 'NVDA', market: 'us', aliases: [] };
    expect(toStooqSymbol(entry)).toBe('NVDA.US');
  });

  it('converts JP ticker (.T → .JP)', () => {
    const entry: WatchlistEntry = { ticker: '6857.T', market: 'jp', aliases: [] };
    expect(toStooqSymbol(entry)).toBe('6857.JP');
  });

  it('converts JP ticker with alpha prefix', () => {
    const entry: WatchlistEntry = { ticker: '285A.T', market: 'jp', aliases: [] };
    expect(toStooqSymbol(entry)).toBe('285A.JP');
  });
});

const VIX_FIXTURE = {
  chart: {
    result: [{
      meta: { regularMarketTime: 1779722521, chartPreviousClose: 16.7 },
      indicators: { quote: [{ close: [16.7, 16.59] }] },
    }],
  },
};

describe('parseVixJson', () => {
  it('extracts close and computes changePct1d', () => {
    const result = parseVixJson(VIX_FIXTURE);
    expect(result).not.toBeNull();
    expect(result!.symbol).toBe('VIX');
    expect(result!.close).toBe(16.59);
    expect(result!.changePct1d).toBeCloseTo(-0.66, 1);
  });

  it('returns null for malformed response', () => {
    expect(parseVixJson({})).toBeNull();
    expect(parseVixJson({ chart: { result: [] } })).toBeNull();
  });
});
