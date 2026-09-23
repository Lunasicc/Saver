import type { RecurringBill } from './types';
import { today } from './format';

/** Approximate monthly cost of a bill charged at the given frequency. */
export function monthlyEquivalent(amount: number, frequency: string) {
  if (frequency === 'yearly') return amount / 12;
  if (frequency === 'weekly') return amount * (52 / 12);
  if (frequency === 'fortnightly') return amount * (26 / 12);
  return amount;
}

/**
 * Days until a monthly bill's next due day. Weekly/fortnightly/yearly bills only
 * store a day-of-month, which doesn't pin down their next date, so they return null.
 */
export function daysUntilDue(bill: Pick<RecurringBill, 'due_day' | 'frequency'>, now = new Date()) {
  if (bill.frequency !== 'monthly') return null;
  const [y, m, d] = today(now).split('-').map(Number);
  const start = new Date(y, m - 1, d);
  let due = new Date(y, m - 1, bill.due_day);
  if (due < start) due = new Date(y, m, bill.due_day);
  return Math.round((due.getTime() - start.getTime()) / 86_400_000);
}

export function dueLabel(days: number | null, frequency: string) {
  if (days === null) return frequency.charAt(0).toUpperCase() + frequency.slice(1);
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due in ${days} days`;
}
