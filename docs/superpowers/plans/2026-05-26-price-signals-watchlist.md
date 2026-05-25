# Price Signals + Watchlist Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real-time price data from Stooq/Yahoo to the daily digest, improve watchlist with aliases, switch Discord output to Forum channel threads.

**Architecture:** Market data fetcher (Stooq CSV + Yahoo VIX) runs in parallel with RSS fetch. Price quotes flow into Stage 2 prompt for integrated bullish/bearish analysis. Discord output splits into Forum thread (overview embed + detail + glossary).

**Tech Stack:** Cloudflare Workers, Stooq CSV API, Yahoo Finance v8 (VIX only), Drizzle/D1, Discord Webhooks (Forum threads)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/config/watchlist.ts` | Modify | Type → `WatchlistEntry[]` with aliases, add entries |
| `src/matchers/watchlist.ts` | Modify | Alias matching + full-width normalization |
| `src/fetchers/market.ts` | Create | Stooq CSV fetch/parse + Yahoo VIX + ticker conversion |
| `src/notifier/discord.ts` | Modify | Add `sendForumDigest` + content splitting |
| `src/summarizer/prompts.ts` | Modify | Price table in user prompt, section separator, signal instructions |
| `src/summarizer/stage2_daily.ts` | Modify | Accept market data parameter |
| `src/jobs/daily.ts` | Modify | Parallel market fetch, D1 snapshot, section split, Forum output, feedback logs |
| `test/matchers/watchlist.test.ts` | Create | Alias matching tests |
| `test/fetchers/market.test.ts` | Create | CSV parse + ticker conversion tests |
| `test/notifier/discord.test.ts` | Create | Forum post flow tests |

---

### Task 1: Watchlist Config Type Change

**Files:**
- Modify: `apps/worker/src/config/watchlist.ts`

- [ ] **Step 1: Update type and data**

```ts
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
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd apps/worker && npx tsc --noEmit`
Expected: No errors (backward compat export preserves existing imports)

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/config/watchlist.ts
git commit -m "feat(watchlist): expand to WatchlistEntry type with aliases"
```

---

### Task 2: Watchlist Alias Matcher (TDD)

**Files:**
- Create: `apps/worker/test/matchers/watchlist.test.ts`
- Modify: `apps/worker/src/matchers/watchlist.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { isWatchlistMatched, matchedTickers } from '../../src/matchers/watchlist';

describe('isWatchlistMatched', () => {
  it('matches exact ticker', () => {
    expect(isWatchlistMatched(['NVDA', 'INTC'])).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(isWatchlistMatched(['nvda'])).toBe(true);
  });

  it('returns false for unrelated tickers', () => {
    expect(isWatchlistMatched(['INTC', 'QCOM'])).toBe(false);
  });

  it('matches via alias', () => {
    expect(isWatchlistMatched([], ['エヌビディア'])).toBe(true);
  });

  it('matches alias case-insensitively', () => {
    expect(isWatchlistMatched([], ['nvidia'])).toBe(true);
  });

  it('normalizes full-width to half-width', () => {
    expect(isWatchlistMatched([], ['ＮＶＩＤＩＡ'])).toBe(true);
  });

  it('matches Japanese stock ticker', () => {
    expect(isWatchlistMatched(['6857.T'])).toBe(true);
  });

  it('handles empty arrays', () => {
    expect(isWatchlistMatched([])).toBe(false);
  });
});

describe('matchedTickers', () => {
  it('returns matched tickers from direct match', () => {
    expect(matchedTickers(['NVDA', 'INTC'])).toEqual(['NVDA']);
  });

  it('returns matched tickers from alias', () => {
    expect(matchedTickers([], ['キオクシア'])).toEqual(['285A.T']);
  });

  it('deduplicates when both ticker and alias match', () => {
    expect(matchedTickers(['NVDA'], ['Nvidia'])).toEqual(['NVDA']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/worker && npx vitest run test/matchers/watchlist.test.ts`
Expected: FAIL — `matchedTickers` is not exported from the module

- [ ] **Step 3: Implement the matcher**

Replace `apps/worker/src/matchers/watchlist.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/worker && npx vitest run test/matchers/watchlist.test.ts`
Expected: All 11 tests PASS

- [ ] **Step 5: Update call site in daily.ts**

In `apps/worker/src/jobs/daily.ts`, change:
```ts
watchlistMatched: isWatchlistMatched(ex.tickers),
```
to:
```ts
watchlistMatched: isWatchlistMatched(ex.tickers, ex.ticker_aliases_used),
```

- [ ] **Step 6: Verify typecheck**

Run: `cd apps/worker && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/matchers/watchlist.ts apps/worker/test/matchers/watchlist.test.ts apps/worker/src/jobs/daily.ts
git commit -m "feat(watchlist): alias matching with full-width normalization"
```

---

### Task 3: Market Data Fetcher (TDD)

**Files:**
- Create: `apps/worker/test/fetchers/market.test.ts`
- Create: `apps/worker/src/fetchers/market.ts`

- [ ] **Step 1: Write failing tests for CSV parsing and ticker conversion**

```ts
import { describe, it, expect } from 'vitest';
import { parseStooqCsv, toStooqSymbol, parseVixJson } from '../../src/fetchers/market';
import type { WatchlistEntry } from '../../src/config/watchlist';

const STOOQ_FIXTURE = `Symbol,Date,Time,Open,High,Low,Close,Volume
NVDA.US,2026-05-22,22:00:18,220.904,221.01,214.8,215.33,169275710
285A.JP,2026-05-22,08:00:00,57500,58880,56280,57400,25359700
^SPX,2026-05-22,23:00:00,7468.8,7506.3,7463.3,7473.5,2697941253
USDJPY,2026-05-25,17:37:20,158.878,159.0415,158.7585,158.9005,`;

describe('parseStooqCsv', () => {
  it('parses multi-row CSV into typed rows', () => {
    const rows = parseStooqCsv(STOOQ_FIXTURE);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({
      symbol: 'NVDA.US',
      date: '2026-05-22',
      close: 215.33,
      volume: 169275710,
    });
  });

  it('handles missing volume (trailing comma)', () => {
    const rows = parseStooqCsv(STOOQ_FIXTURE);
    expect(rows[3].volume).toBeNull();
  });

  it('skips rows with N/D values', () => {
    const csv = `Symbol,Date,Time,Open,High,Low,Close,Volume
^VIX,N/D,N/D,N/D,N/D,N/D,N/D,N/D`;
    expect(parseStooqCsv(csv)).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    expect(parseStooqCsv('')).toHaveLength(0);
  });
});

describe('toStooqSymbol', () => {
  it('converts US ticker', () => {
    const entry: WatchlistEntry = { ticker: 'NVDA', market: 'us', aliases: [] };
    expect(toStooqSymbol(entry)).toBe('NVDA.US');
  });

  it('converts JP ticker (.T → .JP)', () => {
    const entry: WatchlistEntry = { ticker: '6857.T', market: 'jp', aliases: [] };
    expect(toStooqSymbol(entry)).toBe('6857.JP');
  });

  it('converts JP ticker with alpha prefix', () => {
    const entry: WatchlistEntry = { ticker: '285A.T', market: 'jp', aliases: [] };
    expect(toStooqSymbol(entry)).toBe('285A.JP');
  });
});

const VIX_FIXTURE = {
  chart: {
    result: [{
      meta: { regularMarketTime: 1779722521, chartPreviousClose: 16.7 },
      indicators: { quote: [{ close: [16.7, 16.59] }] },
    }],
  },
};

describe('parseVixJson', () => {
  it('extracts close and computes changePct1d', () => {
    const result = parseVixJson(VIX_FIXTURE);
    expect(result).not.toBeNull();
    expect(result!.symbol).toBe('VIX');
    expect(result!.close).toBe(16.59);
    expect(result!.changePct1d).toBeCloseTo(-0.66, 1);
  });

  it('returns null for malformed response', () => {
    expect(parseVixJson({})).toBeNull();
    expect(parseVixJson({ chart: { result: [] } })).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/worker && npx vitest run test/fetchers/market.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the market fetcher**

Create `apps/worker/src/fetchers/market.ts`:

```ts
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
  { name: 'S&P 500', stooqSymbol: '^SPX' },
  { name: '日経平均', stooqSymbol: '^NKX' },
  { name: 'USD/JPY', stooqSymbol: 'USDJPY' },
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseVixJson(json: any): MarketQuote | null {
  try {
    const result = json?.chart?.result?.[0];
    if (!result) return null;
    const closes: number[] | undefined = result.indicators?.quote?.[0]?.close;
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
      date: new Date((result.meta?.regularMarketTime ?? 0) * 1000).toISOString().split('T')[0],
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/worker && npx vitest run test/fetchers/market.test.ts`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/fetchers/market.ts apps/worker/test/fetchers/market.test.ts
git commit -m "feat(market): Stooq CSV fetcher + Yahoo VIX parser with tests"
```

---

### Task 4: Discord Forum Notifier (TDD)

**Files:**
- Create: `apps/worker/test/notifier/discord.test.ts`
- Modify: `apps/worker/src/notifier/discord.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { splitContent, buildForumPayload } from '../../src/notifier/discord';

describe('splitContent', () => {
  it('returns single chunk when under limit', () => {
    expect(splitContent('short text', 2000)).toEqual(['short text']);
  });

  it('splits at newline before limit', () => {
    const text = 'line1\n' + 'x'.repeat(1999);
    const chunks = splitContent(text, 2000);
    expect(chunks[0]).toBe('line1');
    expect(chunks[1].length).toBeLessThanOrEqual(2000);
  });

  it('hard-splits when no newline found', () => {
    const text = 'x'.repeat(4000);
    const chunks = splitContent(text, 2000);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].length).toBe(2000);
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
    expect(payload.embeds[0].title).toBe('📰 半導体・AIテック');
    expect(payload.embeds[0].description).toBe('overview text');
    expect(payload.embeds[0].color).toBe(0x3498db);
    expect(payload.embeds[0].timestamp).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/worker && npx vitest run test/notifier/discord.test.ts`
Expected: FAIL — `splitContent` and `buildForumPayload` not exported

- [ ] **Step 3: Implement Forum notifier**

Add to `apps/worker/src/notifier/discord.ts` (keep existing functions intact):

```ts
// --- Forum Channel Support ---

export function splitContent(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitIdx = remaining.lastIndexOf('\n', maxLen);
    if (splitIdx <= 0) splitIdx = maxLen;
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }
  return chunks;
}

type ForumOverview = {
  threadName: string;
  title: string;
  description: string;
  color: number;
};

export function buildForumPayload(overview: ForumOverview) {
  return {
    thread_name: overview.threadName,
    embeds: [
      {
        title: overview.title,
        description: overview.description.slice(0, 4000),
        color: overview.color,
        timestamp: new Date().toISOString(),
        footer: { text: 'finews / Sonnet 4.6' },
      },
    ],
  };
}

export type ForumDigest = {
  threadName: string;
  title: string;
  color: number;
  overview: string;
  detail: string;
  glossary: string;
};

export async function sendForumDigest(
  webhookUrl: string,
  digest: ForumDigest,
): Promise<void> {
  const payload = buildForumPayload({
    threadName: digest.threadName,
    title: digest.title,
    description: digest.overview,
    color: digest.color,
  });

  const createRes = await fetch(`${webhookUrl}?wait=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!createRes.ok) {
    throw new Error(`Discord forum create failed: ${createRes.status} ${await createRes.text()}`);
  }
  const created = (await createRes.json()) as { channel_id: string };
  const threadId = created.channel_id;

  await new Promise((r) => setTimeout(r, 250));

  if (digest.detail) {
    await postToThread(webhookUrl, threadId, digest.detail);
  }
  if (digest.glossary) {
    await new Promise((r) => setTimeout(r, 250));
    await postToThread(webhookUrl, threadId, digest.glossary);
  }
}

async function postToThread(webhookUrl: string, threadId: string, content: string): Promise<void> {
  const chunks = splitContent(content, 2000);
  for (const chunk of chunks) {
    const res = await fetch(`${webhookUrl}?thread_id=${threadId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: chunk }),
    });
    if (!res.ok) {
      console.warn({ discord_thread_post_failed: res.status, threadId });
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/worker && npx vitest run test/notifier/discord.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/notifier/discord.ts apps/worker/test/notifier/discord.test.ts
git commit -m "feat(discord): Forum channel posting with content splitting"
```

---

### Task 5: Stage 2 Prompt Changes

**Files:**
- Modify: `apps/worker/src/summarizer/prompts.ts`
- Modify: `apps/worker/src/summarizer/stage2_daily.ts`

- [ ] **Step 1: Update system prompt**

In `apps/worker/src/summarizer/prompts.ts`, replace `STAGE2_DAILY_SYSTEM`:

```ts
export const STAGE2_DAILY_SYSTEM = `あなたは投資判断と金融リテラシー向上の両方をサポートするアナリストです。
読み手は金融ニュースを読み慣れていない技術者で、要約を通じて
「なぜこの数字・動きが重要なのか」を学習することも目的としています。

【要約方針】
1. 事実だけでなく「なぜ重要か」を必ず添える
2. 専門用語には30字以内の短い注釈を付ける
   ただし基本用語(GDP, CPI, FOMC, 決算, 為替, 利回り, ETF)は注釈不要
3. 「読み解きポイント」を1〜2個、初学者が次回以降自力で読めるよう型を提示
4. ウォッチリスト関連を優先ハイライト

【値動きシグナル】
5. ウォッチリスト銘柄の値動きデータが提供された場合:
   - ニュースとの因果関係がある値動きを紐付けて解説する
   - 値動きの方向（上昇/下落）と記事内容から、短期的な強気/弱気の見立てを述べる
   - 見立ては必ず「〜と見られる」「〜の可能性がある」で表現し、断定しない
   - 値動きデータが無い銘柄について値動きを創作しない
6. 市場コンテキスト指標(S&P 500, 日経平均, USD/JPY, VIX)が提供された場合:
   - 個別銘柄の動きが市場全体の方向と同じか逆行かを判断材料にする
   - VIX が高い(>25)場合は市場ストレスが高いことに言及する

【ハルシネーション対策】
- 数値・固有名詞は必ず key_numbers / tickers / 値動きデータから引用すること
- 新たな数値や記事に無い因果を創出してはならない
- 不確実な解釈は「と見られる」「の可能性がある」で明示

【出力フォーマット】
プレーンテキストで以下の構成にする。各セクションを ---SECTION--- で区切ること:

セクション1（概要 — 1500字以内）:
📰 [ドメイン名]
• [見出し1] (sig N) ← 関連ティッカー
• [見出し2] (sig N)

📊 ウォッチリスト速報
[銘柄] [終値] ([前日比]) ← 関連ニュースがあれば一行コメント
...

市場背景: S&P500 [値]([前日比]) / 日経 [値]([前日比]) / USD/JPY [値] / VIX [値]

---SECTION---

セクション2（詳細分析 — 各記事300-500字、合計2000字以内）:
🔥 [見出し] (sig N)
★ウォッチリスト関連: [ティッカー]
事実: ...
なぜ重要: ...
強弱シグナル: [強気/弱気/中立] — [一行の理由]
読み解きポイント: ...

---SECTION---

セクション3（今日の用語 — 300字以内）:
• 用語1: 30字以内の説明
• 用語2: 30字以内の説明`;
```

- [ ] **Step 2: Update user prompt builder**

In `apps/worker/src/summarizer/prompts.ts`, replace `stage2DailyUser`:

```ts
import type { MarketQuote } from '../fetchers/market';

export type MarketDataForPrompt = {
  quotes: MarketQuote[];
  context: MarketQuote[];
};

export const stage2DailyUser = (
  domain: string,
  extractedArticles: unknown[],
  watchlistTickers: ReadonlyArray<string>,
  marketData?: MarketDataForPrompt,
) => {
  let content = `# 領域: ${domain}\n\n`;
  content += `# 今日のニュース材料(Stage 1抽出済み)\n${JSON.stringify(extractedArticles, null, 2)}\n\n`;
  content += `# ウォッチリスト\n${watchlistTickers.join(', ')}`;

  if (marketData) {
    content += '\n\n# ウォッチリスト銘柄の値動き\n';
    content += '| 銘柄 | 終値 | 前日比 |\n|------|------|--------|\n';
    for (const q of marketData.quotes) {
      const change = q.changePct1d !== null
        ? `${q.changePct1d >= 0 ? '+' : ''}${q.changePct1d.toFixed(1)}%`
        : 'N/A';
      content += `| ${q.symbol} | ${q.close} | ${change} |\n`;
    }

    content += '\n# 市場コンテキスト指標\n';
    content += '| 指標 | 値 | 前日比 |\n|------|-----|--------|\n';
    for (const c of marketData.context) {
      const change = c.changePct1d !== null
        ? `${c.changePct1d >= 0 ? '+' : ''}${c.changePct1d.toFixed(1)}%`
        : 'N/A';
      content += `| ${c.symbol} | ${c.close} | ${change} |\n`;
    }
  }

  return content;
};
```

- [ ] **Step 3: Update stage2_daily.ts signature**

In `apps/worker/src/summarizer/stage2_daily.ts`, update the function:

```ts
import type { MarketDataForPrompt } from './prompts';

export type Stage2DailyInput = {
  domain: Domain;
  articles: ExtractedArticle[];
  marketData?: MarketDataForPrompt;
};

export async function generateDailySummary(
  input: Stage2DailyInput,
  apiKey: string,
  tracker: BudgetTracker,
): Promise<string> {
  tracker.assertCanCall('stage2');
  const client = new Anthropic({ apiKey });
  const model = 'claude-sonnet-4-6';
  const response = await withRetry(() =>
    client.messages.create({
      model,
      max_tokens: 2048,
      system: [
        {
          type: 'text',
          text: STAGE2_DAILY_SYSTEM,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: stage2DailyUser(input.domain, input.articles, watchlistTickers, input.marketData),
        },
      ],
    }),
  );
  tracker.recordCall('stage2', model, response.usage.input_tokens, response.usage.output_tokens);

  return response.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('');
}
```

- [ ] **Step 4: Verify typecheck**

Run: `cd apps/worker && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/summarizer/prompts.ts apps/worker/src/summarizer/stage2_daily.ts
git commit -m "feat(stage2): integrate price data + bullish/bearish signals in prompt"
```

---

### Task 6: Daily Pipeline Integration + Feedback Logging

**Files:**
- Modify: `apps/worker/src/jobs/daily.ts`

- [ ] **Step 1: Add market fetch imports and section splitter**

At the top of `apps/worker/src/jobs/daily.ts`, add:

```ts
import {
  fetchStooqPrices,
  fetchVix,
  toStooqSymbol,
  CONTEXT_INDICATORS,
  type MarketQuote,
} from '../fetchers/market';
import { watchlistEntries } from '../config/watchlist';
import { marketSnapshots } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { sendForumDigest, type ForumDigest } from '../notifier/discord';
import type { MarketDataForPrompt } from '../summarizer/prompts';
```

Add the section splitter helper:

```ts
function splitSections(text: string): { overview: string; detail: string; glossary: string } {
  const parts = text.split('---SECTION---').map((s) => s.trim());
  if (parts.length >= 3) return { overview: parts[0], detail: parts[1], glossary: parts[2] };
  if (parts.length === 2) return { overview: parts[0], detail: parts[1], glossary: '' };
  return { overview: text, detail: '', glossary: '' };
}
```

- [ ] **Step 2: Add market data fetch (parallel with RSS)**

Replace step 1 in `runDaily`:

```ts
// 1. RSS fetch + Market data fetch (parallel)
const [fetched, marketResult] = await Promise.all([
  fetchAllSources(newsSources),
  fetchMarketQuotes(db),
]);
```

Add the `fetchMarketQuotes` helper function (above `runDaily`):

```ts
async function fetchMarketQuotes(
  db: ReturnType<typeof createDb>,
): Promise<{ quotes: MarketQuote[]; context: MarketQuote[] } | null> {
  try {
    const watchlistSymbols = watchlistEntries.map(toStooqSymbol);
    const contextSymbols = CONTEXT_INDICATORS.map((i) => i.stooqSymbol);
    const allStooqSymbols = [...watchlistSymbols, ...contextSymbols];

    const [stooqRows, vixQuote] = await Promise.all([
      fetchStooqPrices(allStooqSymbols),
      fetchVix(),
    ]);

    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    // Get yesterday's snapshots for changePct1d calculation
    const prevSnapshots = await db
      .select({ symbol: marketSnapshots.symbol, price: marketSnapshots.price })
      .from(marketSnapshots)
      .where(eq(marketSnapshots.snapshotDate, yesterday));
    const prevMap = new Map(prevSnapshots.map((r) => [r.symbol, r.price]));

    // Build quotes for watchlist entries
    const quotes: MarketQuote[] = [];
    for (const entry of watchlistEntries) {
      const stooqSym = toStooqSymbol(entry);
      const row = stooqRows.find((r) => r.symbol === stooqSym);
      if (!row) continue;
      const prev = prevMap.get(entry.ticker);
      const changePct1d = prev ? ((row.close - prev) / prev) * 100 : null;
      quotes.push({ symbol: entry.ticker, close: row.close, changePct1d, date: row.date });
    }

    // Build context indicators
    const context: MarketQuote[] = [];
    for (const ind of CONTEXT_INDICATORS) {
      const row = stooqRows.find((r) => r.symbol === ind.stooqSymbol);
      if (!row) continue;
      const prev = prevMap.get(ind.name);
      const changePct1d = prev ? ((row.close - prev) / prev) * 100 : null;
      context.push({ symbol: ind.name, close: row.close, changePct1d, date: row.date });
    }

    // Add VIX
    if (vixQuote) context.push(vixQuote);

    // Persist today's snapshots
    const snapshotsToInsert = [
      ...quotes.map((q) => ({ snapshotDate: today, symbol: q.symbol, price: q.close, changePct1d: q.changePct1d })),
      ...context.filter((c) => c.symbol !== 'VIX').map((c) => ({ snapshotDate: today, symbol: c.symbol, price: c.close, changePct1d: c.changePct1d })),
      ...(vixQuote ? [{ snapshotDate: today, symbol: 'VIX', price: vixQuote.close, changePct1d: vixQuote.changePct1d }] : []),
    ];
    for (const snap of snapshotsToInsert) {
      await db.insert(marketSnapshots).values(snap).onConflictDoNothing();
    }

    return { quotes, context };
  } catch (err) {
    console.warn({ job: 'daily', stage: 'market_fetch', error: String(err) });
    return null;
  }
}
```

- [ ] **Step 3: Pass market data to Stage 2**

Update the Stage 2 call:

```ts
// 7. Stage 2
const marketData: MarketDataForPrompt | undefined = marketResult ?? undefined;
const summaryText = await generateDailySummary(
  { domain: PHASE_1_DOMAIN, articles: stage2Input, marketData },
  env.ANTHROPIC_API_KEY,
  tracker,
);
```

- [ ] **Step 4: Replace Discord delivery with Forum digest**

Replace the existing `sendDailyEmbed` call:

```ts
// 8. Deliver via Forum thread
const sections = splitSections(summaryText);
const today = new Date().toISOString().split('T')[0];
await sendForumDigest(env.DISCORD_WEBHOOK_URL, {
  threadName: `${today} 半導体ダイジェスト`,
  title: '📰 半導体・AIテック',
  color: 0x3498db,
  overview: sections.overview,
  detail: sections.detail,
  glossary: sections.glossary,
});
```

- [ ] **Step 5: Expand feedback logging**

Update the final `console.log`:

```ts
console.log({
  job: 'daily',
  articlesFetched: fetched.length,
  fresh: fresh.length,
  extracted: extracted.length,
  stage2Input: stage2Input.length,
  watchlistMatchedCount: extracted.filter(({ ex }) => isWatchlistMatched(ex.tickers, ex.ticker_aliases_used)).length,
  stage2OutputChars: summaryText.length,
  priceDataFetched: marketResult ? marketResult.quotes.length + marketResult.context.length : 0,
  durationMs: Date.now() - startedAt,
  budget: finalSummary,
});
```

- [ ] **Step 6: Verify typecheck**

Run: `cd apps/worker && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Run all tests**

Run: `cd apps/worker && npx vitest run`
Expected: All tests pass (existing + new)

- [ ] **Step 8: Commit**

```bash
git add apps/worker/src/jobs/daily.ts
git commit -m "feat(daily): integrate market data, Forum output, and feedback logging"
```

---

## Post-Implementation Checklist

- [ ] Run full test suite: `cd apps/worker && npx vitest run`
- [ ] Typecheck: `cd apps/worker && npx tsc --noEmit`
- [ ] Verify `marketSnapshots` table exists in D1: `npx wrangler d1 execute finews --command "SELECT name FROM sqlite_master WHERE type='table' AND name='market_snapshots'"`
- [ ] Create Discord Forum channel + webhook (manual)
- [ ] `wrangler secret put DISCORD_WEBHOOK_URL` with new Forum webhook
- [ ] Push to main → Cloudflare Workers Builds auto-deploys
- [ ] Wait for next cron (6:30 JST) and verify Forum thread appears
