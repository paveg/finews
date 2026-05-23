import { XMLParser } from 'fast-xml-parser';
import type { NewsSource, Domain } from '../config/sources';
import { articleId } from '../lib/dedup';

export type FetchedArticle = {
  id: string;
  source: string;
  domain: Domain;
  url: string;
  title: string;
  description: string;
  publishedAt: number; // unix ms
};

async function fetchOne(source: NewsSource): Promise<FetchedArticle[]> {
  const res = await fetch(source.url, {
    headers: { 'User-Agent': 'finews/0.0.1' },
  });
  if (!res.ok) {
    console.warn({ source: source.id, status: res.status });
    return [];
  }
  const xml = await res.text();
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
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
    const publishedAt = new Date(String(pubDateRaw)).getTime();
    if (Number.isNaN(publishedAt)) continue;

    out.push({
      id: await articleId(url),
      source: source.id,
      domain: source.domain,
      url,
      title,
      description,
      publishedAt,
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
