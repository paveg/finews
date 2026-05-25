import { describe, it, expect } from 'vitest';
import { XMLParser } from 'fast-xml-parser';

/**
 * Verifies the XMLParser configuration used in news.ts
 * rejects entity expansion (Billion Laughs / XXE).
 */
describe('XMLParser entity processing', () => {
  // The production parser config:
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    processEntities: false,
  });

  it('does not expand internal entities when processEntities is false', () => {
    const xmlWithEntity = `<?xml version="1.0"?>
<!DOCTYPE foo [
  <!ENTITY xxe "expanded-value">
]>
<rss><channel><item><title>&xxe;</title><link>http://example.com</link></item></channel></rss>`;

    const parsed = parser.parse(xmlWithEntity);
    const title = parsed?.rss?.channel?.item?.title;
    // With processEntities: false, the entity reference should NOT be expanded
    expect(title).not.toBe('expanded-value');
  });

  it('parses normal RSS items correctly with processEntities disabled', () => {
    const xml = `<?xml version="1.0"?>
<rss><channel><item><title>Hello World</title><link>http://example.com</link></item></channel></rss>`;

    const parsed = parser.parse(xml);
    const item = parsed?.rss?.channel?.item;
    expect(item?.title).toBe('Hello World');
    expect(item?.link).toBe('http://example.com');
  });
});
