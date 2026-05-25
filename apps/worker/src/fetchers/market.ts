import type { WatchlistEntry } from '../config/watchlist';

export type MarketQuote = {
  symbol: string;
  close: number;
  changePct1d: number | null;
  date: string;
};

export type StooqRow = {
  symbol: string;
  date: string;
  close: number;
  volume: number | null;
};

export const CONTEXT_INDICATORS = [
  { name: 'S&P 500', stooqSymbol: '^SPX', market: 'us' as const },
  { name: '日経平均', stooqSymbol: '^NKX', market: 'jp' as const },
  { name: 'USD/JPY', stooqSymbol: 'USDJPY', market: null },
] as const;

const VIX_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?range=2d&interval=1d';

export function toStooqSymbol(entry: WatchlistEntry): string {
  if (entry.market === 'jp') {
    return entry.ticker.replace(/\.T$/, '.JP');
  }
  return `${entry.ticker}.US`;
}

export function parseStooqCsv(csv: string): StooqRow[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  return lines
    .slice(1)
    .map((line) => {
      const parts = line.split(',');
      const close = Number(parts[6]);
      if (Number.isNaN(close)) return null;
      return {
        symbol: parts[0],
        date: parts[1],
        close,
        volume: parts[7] ? Number(parts[7]) || null : null,
      };
    })
    .filter((row): row is StooqRow => row !== null);
}

type VixApiResponse = {
  chart?: {
    result?: Array<{
      meta?: { regularMarketTime?: number; chartPreviousClose?: number };
      indicators?: { quote?: Array<{ close?: number[] }> };
    }>;
  };
};

export function parseVixJson(json: unknown): MarketQuote | null {
  try {
    const obj = json as VixApiResponse;
    const result = obj?.chart?.result?.[0];
    if (!result) return null;
    const closes = result.indicators?.quote?.[0]?.close;
    if (!closes || closes.length === 0) return null;
    const latestClose = closes[closes.length - 1];
    if (latestClose == null) return null;
    const prevClose =
      closes.length > 1 ? closes[closes.length - 2] : result.meta?.chartPreviousClose;
    const changePct1d = prevClose ? ((latestClose - prevClose) / prevClose) * 100 : null;
    return {
      symbol: 'VIX',
      close: latestClose,
      changePct1d,
      date: new Date((result.meta?.regularMarketTime ?? 0) * 1000).toISOString().split('T')[0] ?? '',
    };
  } catch {
    return null;
  }
}

export async function fetchStooqPrices(symbols: string[]): Promise<StooqRow[]> {
  const query = symbols.map((s) => encodeURIComponent(s)).join('+');
  const url = `https://stooq.com/q/l/?s=${query}&f=sd2t2ohlcv&h&e=csv`;
  const res = await fetch(url, { headers: { 'User-Agent': 'finews/0.1.0' } });
  if (!res.ok) return [];
  const csv = await res.text();
  return parseStooqCsv(csv);
}

export async function fetchVix(): Promise<MarketQuote | null> {
  try {
    const res = await fetch(VIX_URL);
    if (!res.ok) return null;
    const json = await res.json();
    return parseVixJson(json);
  } catch {
    return null;
  }
}
