import type {
  Budget,
  CategoryHistory,
  DailySpending,
  MonthlySnapshot,
  RecurringBill,
  Summary,
  TopSpending,
  TrendPoint,
} from '../../lib/types';

export type OverviewData = {
  snapshot: MonthlySnapshot;
  budgets: Budget[];
  trends: TrendPoint[];
  summary: Summary;
  bills: RecurringBill[];
  top: TopSpending;
  daily: DailySpending;
  history: CategoryHistory;
  accountCount: number;
  focusId: number | null;
};

export function txLink(month: string, category: number | 'uncategorized') {
  return `/transactions?month=${month}&category=${category}`;
}

export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** "Sat 12 Sep" for an ISO date. */
export function shortDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' }).format(
    new Date(y, m - 1, d)
  );
}
