import { watchlistEntries } from '../config/watchlist';

function normalize(s: string): string {
  return s
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toUpperCase();
}

const tickerSet = new Set(watchlistEntries.map((e) => normalize(e.ticker)));
const aliasToTicker = new Map<string, string>();
for (const entry of watchlistEntries) {
  for (const alias of entry.aliases) {
    aliasToTicker.set(normalize(alias), entry.ticker);
  }
}

export function isWatchlistMatched(
  tickers: ReadonlyArray<string>,
  aliasesUsed?: ReadonlyArray<string>,
): boolean {
  if (tickers.some((t) => tickerSet.has(normalize(t)))) return true;
  if (aliasesUsed?.some((a) => aliasToTicker.has(normalize(a)))) return true;
  return false;
}

export function matchedTickers(
  tickers: ReadonlyArray<string>,
  aliasesUsed?: ReadonlyArray<string>,
): string[] {
  const matched = new Set<string>();
  for (const t of tickers) {
    const norm = normalize(t);
    for (const entry of watchlistEntries) {
      if (normalize(entry.ticker) === norm) matched.add(entry.ticker);
    }
  }
  if (aliasesUsed) {
    for (const a of aliasesUsed) {
      const ticker = aliasToTicker.get(normalize(a));
      if (ticker) matched.add(ticker);
    }
  }
  return [...matched];
}
