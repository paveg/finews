import { describe, it, expect } from 'vitest';
import { isMarketHoliday } from '../../src/config/holidays';

describe('isMarketHoliday', () => {
  it('detects US New Year', () => {
    expect(isMarketHoliday(new Date('2026-01-01'), 'us')).toBe(true);
  });

  it('detects US Independence Day', () => {
    expect(isMarketHoliday(new Date('2026-07-03'), 'us')).toBe(true);
  });

  it('detects JP New Year period', () => {
    expect(isMarketHoliday(new Date('2026-01-02'), 'jp')).toBe(true);
  });

  it('detects JP Golden Week', () => {
    expect(isMarketHoliday(new Date('2026-05-05'), 'jp')).toBe(true);
  });

  it('returns false for regular trading day', () => {
    expect(isMarketHoliday(new Date('2026-06-10'), 'us')).toBe(false);
    expect(isMarketHoliday(new Date('2026-06-10'), 'jp')).toBe(false);
  });

  it('returns false for weekend (handled by cron, not holiday check)', () => {
    expect(isMarketHoliday(new Date('2026-06-06'), 'us')).toBe(false);
  });

  it('detects JP Mountain Day', () => {
    expect(isMarketHoliday(new Date('2026-08-11'), 'jp')).toBe(true);
  });

  it('detects US Thanksgiving 2026', () => {
    expect(isMarketHoliday(new Date('2026-11-26'), 'us')).toBe(true);
  });

  it('detects US Christmas', () => {
    expect(isMarketHoliday(new Date('2026-12-25'), 'us')).toBe(true);
  });
});
