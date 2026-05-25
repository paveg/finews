// 2026 US market holidays (NYSE/NASDAQ)
// Floating holidays are pre-computed for the year.
// Update annually before Jan 1.
const US_HOLIDAYS_2026 = new Set([
  '2026-01-01', // New Year's Day
  '2026-01-19', // MLK Day (3rd Mon of Jan)
  '2026-02-16', // Presidents' Day (3rd Mon of Feb)
  '2026-04-03', // Good Friday
  '2026-05-25', // Memorial Day (last Mon of May)
  '2026-06-19', // Juneteenth
  '2026-07-03', // Independence Day observed (Jul 4 = Sat → Fri)
  '2026-09-07', // Labor Day (1st Mon of Sep)
  '2026-11-26', // Thanksgiving (4th Thu of Nov)
  '2026-12-25', // Christmas
]);

// 2026 JP market holidays (TSE)
const JP_HOLIDAYS_2026 = new Set([
  '2026-01-01', // 元日
  '2026-01-02', // 年始休業
  '2026-01-03', // 年始休業
  '2026-01-12', // 成人の日 (2nd Mon of Jan)
  '2026-02-11', // 建国記念の日
  '2026-02-23', // 天皇誕生日
  '2026-03-20', // 春分の日
  '2026-04-29', // 昭和の日
  '2026-05-03', // 憲法記念日
  '2026-05-04', // みどりの日
  '2026-05-05', // こどもの日
  '2026-05-06', // 振替休日
  '2026-07-20', // 海の日 (3rd Mon of Jul)
  '2026-08-11', // 山の日
  '2026-09-21', // 敬老の日 (3rd Mon of Sep)
  '2026-09-23', // 秋分の日
  '2026-10-12', // スポーツの日 (2nd Mon of Oct)
  '2026-11-03', // 文化の日
  '2026-11-23', // 勤労感謝の日
  '2026-12-31', // 大納会
]);

export type Market = 'us' | 'jp';

export function isMarketHoliday(date: Date, market: Market): boolean {
  const iso = date.toISOString().split('T')[0] ?? '';
  if (market === 'us') return US_HOLIDAYS_2026.has(iso);
  return JP_HOLIDAYS_2026.has(iso);
}
