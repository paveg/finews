export type WatchlistEntry = {
  ticker: string;
  market: 'us' | 'jp';
  aliases: string[];
};

export const watchlistEntries: ReadonlyArray<WatchlistEntry> = [
  { ticker: 'NVDA', market: 'us', aliases: ['Nvidia', 'エヌビディア'] },
  { ticker: 'AMD', market: 'us', aliases: ['Advanced Micro Devices', 'アドバンスト・マイクロ'] },
  { ticker: 'TSM', market: 'us', aliases: ['TSMC', '台湾セミコンダクター', '2330.TW'] },
  { ticker: 'AAPL', market: 'us', aliases: ['Apple', 'アップル'] },
  { ticker: 'MSFT', market: 'us', aliases: ['Microsoft', 'マイクロソフト'] },
  { ticker: 'GOOGL', market: 'us', aliases: ['Google', 'Alphabet', 'グーグル'] },
  { ticker: '6857.T', market: 'jp', aliases: ['アドバンテスト', 'Advantest'] },
  { ticker: '8035.T', market: 'jp', aliases: ['東京エレクトロン', 'Tokyo Electron', 'TEL'] },
  { ticker: '285A.T', market: 'jp', aliases: ['キオクシア', 'Kioxia', 'KIOXIA'] },
  { ticker: 'SOXX', market: 'us', aliases: ['iShares Semiconductor ETF'] },
  { ticker: 'SMH', market: 'us', aliases: ['VanEck Semiconductor ETF'] },
];

// Backward compat for existing imports
export const watchlistTickers: ReadonlyArray<string> = watchlistEntries.map((e) => e.ticker);
