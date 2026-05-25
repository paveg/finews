import { XMLParser } from 'fast-xml-parser';
import type { NewsSource, Domain } from '../config/sources';
import { articleId } from '../lib/dedup';
import { isResponseTooLarge, MAX_RSS_BYTES } from '../lib/http-guard';

export type FetchedArticle = {
  id: string;
  source: string;
  domain: Domain;
  url: string;
  title: string;
  description: string;
  publishedAt: string; // ISO 8601 UTC, lexicographically sortable
};

async function fetchOne(source: NewsSource): Promise<FetchedArticle[]> {
  const res = await fetch(source.url, {
    headers: { 'User-Agent': 'finews/0.0.1' },
  });
  if (!res.ok) {
    console.warn({ source: source.id, status: res.status });
    return [];
  }
  if (isResponseTooLarge(res.headers, MAX_RSS_BYTES)) {
    console.warn({ source: source.id, rejected: 'response_too_large', contentLength: res.headers.get('content-length') });
    return [];
  }
  const xml = await res.text();
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    processEntities: false,
  });
  const parsed = parser.parse(xml);

  // RSS 2.0: channel.item[], RDF: RDF.item[]
  const items =
    parsed?.rss?.channel?.item ??
    parsed?.['rdf:RDF']?.item ??
    parsed?.RDF?.item ??
    [];
  const itemArray = Array.isArray(items) ? items : [items];

  const out: FetchedArticle[] = [];
  for (const item of itemArray) {
    if (!item?.link || !item?.title) continue;
    const url = String(item.link).trim();
    const title = String(item.title).trim();
    const description = String(item.description ?? '').trim().slice(0, 500);
    const pubDateRaw =
      item.pubDate ?? item['dc:date'] ?? item.date ?? new Date().toISOString();
    const pubDate = new Date(String(pubDateRaw));
    if (Number.isNaN(pubDate.getTime())) continue;

    out.push({
      id: await articleId(url),
      source: source.id,
      domain: source.domain,
      url,
      title,
      description,
      publishedAt: pubDate.toISOString(),
    });
  }
  return out;
}

export async function fetchAllSources(
  sources: NewsSource[],
): Promise<FetchedArticle[]> {
  const results = await Promise.allSettled(sources.map(fetchOne));
  const articles: FetchedArticle[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') articles.push(...r.value);
  }
  return articles;
}
