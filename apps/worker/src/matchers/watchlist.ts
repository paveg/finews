import { watchlistTickers } from '../config/watchlist';

const watchlistSet = new Set(watchlistTickers.map((t) => t.toUpperCase()));

export function isWatchlistMatched(tickers: ReadonlyArray<string>): boolean {
  return tickers.some((t) => watchlistSet.has(t.toUpperCase()));
}
