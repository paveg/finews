import { describe, it, expect } from 'vitest';
import { normalizeUrl, articleId } from '../../src/lib/dedup';

describe('normalizeUrl', () => {
  it('strips utm_* query params', () => {
    expect(
      normalizeUrl('https://example.com/a?utm_source=x&utm_medium=y&id=1'),
    ).toBe('https://example.com/a?id=1');
  });

  it('removes trailing slash from path', () => {
    expect(normalizeUrl('https://example.com/path/')).toBe(
      'https://example.com/path',
    );
  });

  it('lowercases host', () => {
    expect(normalizeUrl('https://Example.COM/A')).toBe('https://example.com/A');
  });

  it('preserves non-tracking query params and order', () => {
    expect(normalizeUrl('https://example.com/a?b=2&a=1')).toBe(
      'https://example.com/a?a=1&b=2',
    );
  });
});

describe('articleId', () => {
  it('returns sha256 hex of normalized URL', async () => {
    const id1 = await articleId(
      'https://example.com/a?utm_source=x&utm_medium=y',
    );
    const id2 = await articleId('https://example.com/a');
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns different ids for different normalized URLs', async () => {
    const id1 = await articleId('https://example.com/a');
    const id2 = await articleId('https://example.com/b');
    expect(id1).not.toBe(id2);
  });
});
