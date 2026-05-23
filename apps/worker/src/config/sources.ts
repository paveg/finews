import * as v from 'valibot';

export const DomainSchema = v.picklist([
  'semiconductor',
  'ai_tech',
  'us_macro',
  'jp_macro',
  'earnings',
  'market_context',
]);
export type Domain = v.InferOutput<typeof DomainSchema>;

export type NewsSource = {
  id: string;
  type: 'rss';
  url: string;
  domain: Domain;
  priority: 1 | 2 | 3;
};

export const newsSources: NewsSource[] = [
  {
    id: 'nikkei_xtech',
    type: 'rss',
    url: 'https://xtech.nikkei.com/rss/index.rdf',
    domain: 'semiconductor',
    priority: 1,
  },
  {
    id: 'frb_press',
    type: 'rss',
    url: 'https://www.federalreserve.gov/feeds/press_all.xml',
    domain: 'us_macro',
    priority: 1,
  },
  {
    id: 'boj',
    type: 'rss',
    url: 'https://www.boj.or.jp/rss/whatsnew.xml',
    domain: 'jp_macro',
    priority: 1,
  },
  {
    id: 'bbc_business',
    type: 'rss',
    url: 'https://feeds.bbci.co.uk/news/business/rss.xml',
    domain: 'us_macro',
    priority: 2,
  },
];
