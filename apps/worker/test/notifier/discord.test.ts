import { describe, it, expect } from 'vitest';
import { splitContent, buildForumPayload } from '../../src/notifier/discord';

describe('splitContent', () => {
  it('returns single chunk when under limit', () => {
    expect(splitContent('short text', 2000)).toEqual(['short text']);
  });

  it('splits at newline before limit', () => {
    const text = 'line1\n' + 'x'.repeat(1999);
    const chunks = splitContent(text, 2000);
    expect(chunks[0]!).toBe('line1');
    expect(chunks[1]!.length).toBeLessThanOrEqual(2000);
  });

  it('hard-splits when no newline found', () => {
    const text = 'x'.repeat(4000);
    const chunks = splitContent(text, 2000);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.length).toBe(2000);
  });
});

describe('buildForumPayload', () => {
  it('constructs thread creation payload', () => {
    const payload = buildForumPayload({
      threadName: '2026-05-26 半導体',
      title: '📰 半導体・AIテック',
      description: 'overview text',
      color: 0x3498db,
    });
    expect(payload.thread_name).toBe('2026-05-26 半導体');
    expect(payload.embeds[0]!.title).toBe('📰 半導体・AIテック');
    expect(payload.embeds[0]!.description).toBe('overview text');
    expect(payload.embeds[0]!.color).toBe(0x3498db);
    expect(payload.embeds[0]!.timestamp).toBeDefined();
  });
});
