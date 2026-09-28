import { db } from '../db/index.js';
import { accountClause } from './accountFilter.js';
import { findRuleMatch, normalizeForMatch, tidyPlaceName } from './categorize.js';

/**
 * Readable business name for grouping: the name from a matching keyword rule
 * (those are curated), else the saved merchant or description, tidied up.
 * Pass `rules` as keyword ("contains") rules only; learned exact rules just
 * echo the raw description.
 */
export function placeName(tx, rules = null) {
  const rule = rules ? findRuleMatch(rules, tx.description) : null;
  if (rule?.merchant_name?.trim()) return rule.merchant_name.trim();
  return tidyPlaceName(tx.merchant?.trim() || tx.description);
}

/** Normalized names of active tracked bills, used to spot bill payments outside bill categories. */
function activeBillKeys() {
  return db
    .prepare('SELECT name FROM recurring_bills WHERE active = 1')
    .all()
    .map((b) => normalizeForMatch(b.name))
    .filter((k) => k.length >= 3);
}

/**
 * Outgoing transactions from `from` to `to` (inclusive, YYYY-MM-DD), each tagged
 * `fixed` when it's a bill or commitment: its category is marked as one, or it
 * matches a tracked bill. Everything else is everyday spending.
 */
export function spendingBetween({ from, to, account = null }) {
  const rows = db
    .prepare(
      `SELECT t.id, t.date, t.description, t.merchant, -t.amount AS amount, t.account_id, t.category_id,
              c.name AS category_name, c.color AS category_color, c.icon AS category_icon,
              COALESCE(c.is_fixed, 0) AS is_fixed,
              COALESCE(p.id, c.id) AS top_id, COALESCE(p.name, c.name) AS top_name,
              COALESCE(p.color, c.color) AS top_color, COALESCE(p.icon, c.icon) AS top_icon
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN categories p ON p.id = c.parent_id
       WHERE t.amount < 0 AND t.date >= @from AND t.date <= @to AND ${accountClause('t.account_id')}
       ORDER BY t.date ASC, t.id ASC`
    )
    .all({ from, to, account });

  const bills = activeBillKeys();
  const rules = db
    .prepare("SELECT pattern, match_type, merchant_name FROM merchant_rules WHERE match_type = 'contains'")
    .all();
  return rows.map((r) => {
    const place = placeName(r, rules);
    const key = normalizeForMatch(place);
    const description = normalizeForMatch(r.description);
    const isBill = bills.some((k) => k === key || description.includes(k));
    return { ...r, place, fixed: Boolean(r.is_fixed) || isBill };
  });
}

/** First and last day of a YYYY-MM month. */
export function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(days).padStart(2, '0')}`, days };
}

export const round2 = (n) => Math.round(n * 100) / 100;
