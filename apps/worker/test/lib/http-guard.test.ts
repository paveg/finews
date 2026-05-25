import { describe, it, expect } from 'vitest';
import {
  isResponseTooLarge,
  MAX_RSS_BYTES,
  MAX_MARKET_BYTES,
} from '../../src/lib/http-guard';

describe('isResponseTooLarge', () => {
  it('returns true when content-length exceeds max', () => {
    const headers = new Headers({ 'content-length': '6000000' });
    expect(isResponseTooLarge(headers, MAX_RSS_BYTES)).toBe(true);
  });

  it('returns false when content-length is within max', () => {
    const headers = new Headers({ 'content-length': '1024' });
    expect(isResponseTooLarge(headers, MAX_RSS_BYTES)).toBe(false);
  });

  it('returns false when content-length equals max exactly', () => {
    const headers = new Headers({
      'content-length': String(MAX_RSS_BYTES),
    });
    expect(isResponseTooLarge(headers, MAX_RSS_BYTES)).toBe(false);
  });

  it('returns false when content-length header is absent', () => {
    const headers = new Headers();
    expect(isResponseTooLarge(headers, MAX_RSS_BYTES)).toBe(false);
  });

  it('returns false when content-length is not a number', () => {
    const headers = new Headers({ 'content-length': 'abc' });
    expect(isResponseTooLarge(headers, MAX_RSS_BYTES)).toBe(false);
  });

  it('works with MAX_MARKET_BYTES (1MB)', () => {
    const over = new Headers({ 'content-length': '1048577' }); // 1MB + 1
    const under = new Headers({ 'content-length': '500000' });
    expect(isResponseTooLarge(over, MAX_MARKET_BYTES)).toBe(true);
    expect(isResponseTooLarge(under, MAX_MARKET_BYTES)).toBe(false);
  });
});
