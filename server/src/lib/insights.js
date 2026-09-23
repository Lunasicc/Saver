import { db } from '../db/index.js';
import { deriveMerchantName } from './categorize.js';
import { currentMonthLocal, shiftMonth } from './dates.js';

// Categories that represent money moving around rather than real spending.
// They are still returned by the helpers below, but flagged as not recommended
// so the UI can pre-deselect them.
const NON_SPEND_CATEGORIES = new Set(['Transfers & Fees']);

function median(numbers) {
  if (numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/** First day of a month as YYYY-MM-DD. */
function monthStart(month) {
  return `${month}-01`;
}

function toUtcMillis(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function daysBetween(isoA, isoB) {
  return Math.round((toUtcMillis(isoB) - toUtcMillis(isoA)) / 86400000);
}

function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Maps a typical gap (in days) between charges onto one of the frequencies the
 * recurring_bills table supports. Returns null when the cadence is too irregular
 * or too sparse to be a useful bill.
 */
export function classifyFrequency(medianGapDays) {
  if (medianGapDays >= 5 && medianGapDays <= 9) return 'weekly';
  if (medianGapDays >= 11 && medianGapDays <= 18) return 'fortnightly';
  if (medianGapDays >= 25 && medianGapDays <= 38) return 'monthly';
  if (medianGapDays >= 330 && medianGapDays <= 400) return 'yearly';
  return null;
}

/**
 * Scans spending history for merchants that charge on a regular cadence and
 * returns them as candidate recurring bills.
 *
 * A merchant qualifies when it has at least `minOccurrences` charges whose gaps
 * are consistent (most gaps close to the median gap) and whose cadence maps to a
 * supported frequency. Amounts are allowed to vary — the median is used and an
 * `amount_varies` flag is set — because real bills like loan repayments and power
 * bills fluctuate.
 */
export function detectRecurringBills({ months = 12, minOccurrences = 3 } = {}) {
  const sinceMonth = shiftMonth(currentMonthLocal(), -Math.max(1, months) + 1);
  const rows = db
    .prepare(
      `SELECT t.date, t.amount, t.description, t.merchant, t.account_id,
              t.category_id, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.amount < 0 AND t.date >= ?
       ORDER BY t.date ASC`
    )
    .all(monthStart(sinceMonth));

  const groups = new Map();
  for (const row of rows) {
    const key = (row.merchant && row.merchant.trim()) || deriveMerchantName(row.description);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const existing = new Set(
    db
      .prepare('SELECT name FROM recurring_bills')
      .all()
      .map((b) => b.name.trim().toLowerCase())
  );

  const candidates = [];
  for (const [merchant, txs] of groups) {
    if (txs.length < minOccurrences) continue;

    // Collapse same-day charges (e.g. two coffees) to one occurrence so that
    // repeat visits on one day don't look like a zero-day cadence.
    const byDate = new Map();
    for (const tx of txs) {
      const prev = byDate.get(tx.date);
      if (prev) prev.amount += tx.amount;
      else byDate.set(tx.date, { ...tx });
    }
    const occurrences = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    if (occurrences.length < minOccurrences) continue;

    const gaps = [];
    for (let i = 1; i < occurrences.length; i += 1) {
      gaps.push(daysBetween(occurrences[i - 1].date, occurrences[i].date));
    }
    const medianGap = median(gaps);
    const frequency = classifyFrequency(medianGap);
    if (!frequency) continue;

    // Regularity: what share of gaps sit within 40% of the median gap.
    const tolerance = Math.max(2, medianGap * 0.4);
    const regularGaps = gaps.filter((g) => Math.abs(g - medianGap) <= tolerance).length;
    const regularity = gaps.length > 0 ? regularGaps / gaps.length : 0;
    if (regularity < 0.6) continue;

    const amounts = occurrences.map((o) => Math.abs(o.amount));
    const medianAmount = round2(median(amounts));
    if (medianAmount <= 0) continue;
    const spread = amounts.length > 1 ? (Math.max(...amounts) - Math.min(...amounts)) / medianAmount : 0;

    const last = occurrences[occurrences.length - 1];
    const nextExpected = addDays(last.date, Math.round(medianGap));

    // Prefer the most common category among the matched transactions.
    const categoryCounts = new Map();
    for (const o of occurrences) {
      if (!o.category_id) continue;
      categoryCounts.set(o.category_id, (categoryCounts.get(o.category_id) || 0) + 1);
    }
    const topCategoryId =
      [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const categoryRow = occurrences.find((o) => o.category_id === topCategoryId) || {};

    candidates.push({
      name: merchant,
      amount: medianAmount,
      frequency,
      median_gap_days: Math.round(medianGap),
      occurrences: occurrences.length,
      total_spent: round2(amounts.reduce((sum, a) => sum + a, 0)),
      first_charged: occurrences[0].date,
      last_charged: last.date,
      next_expected: nextExpected,
      due_day: Number(last.date.slice(8, 10)),
      account_id: last.account_id ?? null,
      category_id: topCategoryId,
      category_name: categoryRow.category_name ?? null,
      category_icon: categoryRow.category_icon ?? null,
      category_color: categoryRow.category_color ?? null,
      amount_varies: spread > 0.15,
      confidence: round2(Math.min(1, regularity * Math.min(1, occurrences.length / 6))),
      already_tracked: existing.has(merchant.trim().toLowerCase()),
    });
  }

  return candidates.sort(
    (a, b) => b.confidence - a.confidence || b.total_spent - a.total_spent
  );
}

/** Converts any supported frequency to an approximate monthly cost. */
export function monthlyEquivalent(amount, frequency) {
  switch (frequency) {
    case 'weekly':
      return amount * (52 / 12);
    case 'fortnightly':
      return amount * (26 / 12);
    case 'yearly':
      return amount / 12;
    default:
      return amount;
  }
}

/**
 * Suggests a monthly budget per expense category based on what the user actually
 * spent over the previous `lookback` complete months (the target month itself is
 * excluded so a partial month can't drag the suggestion down).
 *
 * Uses the median monthly spend rather than the mean so a single unusual month
 * doesn't skew the target, then rounds up to the nearest $10 for a tidy number.
 */
export function suggestBudgets({ month, lookback = 3 } = {}) {
  const targetMonth = month || currentMonthLocal();
  const windowSize = Math.max(1, Math.min(24, Number(lookback) || 3));
  const monthsInWindow = [];
  for (let i = windowSize; i >= 1; i -= 1) monthsInWindow.push(shiftMonth(targetMonth, -i));

  const placeholders = monthsInWindow.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT c.id AS category_id, c.name, c.icon, c.color,
              strftime('%Y-%m', t.date) AS month,
              COALESCE(SUM(-t.amount), 0) AS total
       FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE t.amount < 0 AND c.is_income = 0 AND strftime('%Y-%m', t.date) IN (${placeholders})
       GROUP BY c.id, month`
    )
    .all(...monthsInWindow);

  const existing = new Map(
    db
      .prepare('SELECT category_id, amount FROM budgets WHERE month = ?')
      .all(targetMonth)
      .map((b) => [b.category_id, b.amount])
  );

  const byCategory = new Map();
  for (const row of rows) {
    if (!byCategory.has(row.category_id)) {
      byCategory.set(row.category_id, {
        category_id: row.category_id,
        name: row.name,
        icon: row.icon,
        color: row.color,
        monthly: new Map(),
      });
    }
    byCategory.get(row.category_id).monthly.set(row.month, row.total);
  }

  const suggestions = [];
  for (const entry of byCategory.values()) {
    // Months with no spend still count as zero so occasional categories aren't
    // over-budgeted based only on the months they happened to appear in.
    const totals = monthsInWindow.map((m) => entry.monthly.get(m) || 0);
    const monthsWithSpend = totals.filter((t) => t > 0).length;
    if (monthsWithSpend === 0) continue;

    const typical = median(totals);
    const average = totals.reduce((sum, t) => sum + t, 0) / totals.length;
    const basis = Math.max(typical, average * 0.8);
    const suggested = Math.max(10, Math.ceil(basis / 10) * 10);

    suggestions.push({
      category_id: entry.category_id,
      category_name: entry.name,
      category_icon: entry.icon,
      category_color: entry.color,
      suggested_amount: suggested,
      median_monthly: round2(typical),
      average_monthly: round2(average),
      min_monthly: round2(Math.min(...totals)),
      max_monthly: round2(Math.max(...totals)),
      months_with_spend: monthsWithSpend,
      months_considered: monthsInWindow.length,
      existing_amount: existing.has(entry.category_id) ? existing.get(entry.category_id) : null,
      // Sporadic or non-spend categories are returned but not pre-selected.
      recommended:
        !NON_SPEND_CATEGORIES.has(entry.name) && monthsWithSpend >= Math.ceil(monthsInWindow.length / 2),
    });
  }

  suggestions.sort((a, b) => b.median_monthly - a.median_monthly);

  return {
    month: targetMonth,
    lookback: windowSize,
    monthsConsidered: monthsInWindow,
    totalSuggested: suggestions
      .filter((s) => s.recommended)
      .reduce((sum, s) => sum + s.suggested_amount, 0),
    suggestions,
  };
}
