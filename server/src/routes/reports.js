import { Router } from 'express';
import { db } from '../db/index.js';
import { todayLocal, currentMonthLocal, shiftMonth, isValidMonth } from '../lib/dates.js';

const router = Router();

function currentNetWorth() {
  const rows = db.prepare('SELECT current_balance, is_liability FROM accounts').all();
  let assets = 0;
  let liabilities = 0;
  for (const r of rows) {
    if (r.is_liability) liabilities += Math.abs(r.current_balance);
    else assets += r.current_balance;
  }
  return { assets, liabilities, netWorth: assets - liabilities };
}

router.get('/summary', (_req, res) => {
  const { assets, liabilities, netWorth } = currentNetWorth();
  const month = currentMonthLocal();
  const { income = 0, spend = 0 } =
    db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS income,
                COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) AS spend
         FROM transactions WHERE strftime('%Y-%m', date) = ?`
      )
      .get(month) || {};
  res.json({ assets, liabilities, netWorth, month, income, spend });
});

router.get('/spending-by-category', (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: 'month (YYYY-MM) query param is required' });
  const rows = db
    .prepare(
      `SELECT c.id AS category_id, c.name, c.color, c.icon, COALESCE(SUM(-t.amount), 0) AS total
       FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE strftime('%Y-%m', t.date) = ? AND t.amount < 0
       GROUP BY c.id ORDER BY total DESC`
    )
    .all(month);
  res.json(rows);
});

router.get('/trends', (req, res) => {
  const months = Number(req.query.months) || 6;
  const rows = db
    .prepare(
      `SELECT strftime('%Y-%m', date) AS month,
              COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS income,
              COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) AS spend
       FROM transactions
       GROUP BY month
       ORDER BY month DESC
       LIMIT ?`
    )
    .all(months);
  res.json(rows.reverse());
});

function prevMonth(month) {
  return shiftMonth(month, -1);
}

function monthTotals(month) {
  return (
    db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS income,
                COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) AS spend
         FROM transactions WHERE strftime('%Y-%m', date) = ?`
      )
      .get(month) || { income: 0, spend: 0 }
  );
}

// Grouped spending summary for a given month: by category and by merchant/business,
// plus totals and a comparison against the previous month.
router.get('/monthly-snapshot', (req, res) => {
  const month = req.query.month || currentMonthLocal();
  if (!isValidMonth(month)) return res.status(400).json({ error: 'month must be in YYYY-MM format' });

  const categories = db
    .prepare(
      `SELECT c.id AS category_id, c.name, c.color, c.icon,
              COALESCE(SUM(-t.amount), 0) AS total, COUNT(*) AS count
       FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE strftime('%Y-%m', t.date) = ? AND t.amount < 0
       GROUP BY c.id ORDER BY total DESC`
    )
    .all(month);

  const uncategorizedSpend =
    db
      .prepare(
        `SELECT COALESCE(SUM(-amount), 0) AS total, COUNT(*) AS count
         FROM transactions WHERE strftime('%Y-%m', date) = ? AND amount < 0 AND category_id IS NULL`
      )
      .get(month) || { total: 0, count: 0 };

  // NOTE: group by the full expression, not the `merchant` alias. SQLite resolves a
  // bare `merchant` in GROUP BY to the underlying (nullable) column, which collapses
  // every transaction without a merchant into a single bogus group.
  const merchants = db
    .prepare(
      `SELECT COALESCE(NULLIF(merchant, ''), description) AS merchant,
              COALESCE(SUM(-amount), 0) AS total, COUNT(*) AS count
       FROM transactions
       WHERE strftime('%Y-%m', date) = ? AND amount < 0
       GROUP BY COALESCE(NULLIF(merchant, ''), description)
       ORDER BY total DESC LIMIT 25`
    )
    .all(month);

  const totals = monthTotals(month);
  const totalSpend = categories.reduce((sum, c) => sum + c.total, 0) + uncategorizedSpend.total;
  const withPct = categories.map((c) => ({ ...c, pct: totalSpend > 0 ? c.total / totalSpend : 0 }));

  const previousMonth = prevMonth(month);
  const prevTotals = monthTotals(previousMonth);

  res.json({
    month,
    previousMonth,
    income: totals.income,
    spend: totals.spend,
    net: totals.income - totals.spend,
    previous: {
      income: prevTotals.income,
      spend: prevTotals.spend,
      net: prevTotals.income - prevTotals.spend,
    },
    delta: {
      income: totals.income - prevTotals.income,
      spend: totals.spend - prevTotals.spend,
      net: totals.income - totals.spend - (prevTotals.income - prevTotals.spend),
    },
    categories: withPct,
    uncategorized: uncategorizedSpend,
    merchants,
  });
});

// Lists recurring subscription-like spending: groups transactions in the
// "Subscriptions" category (plus any streaming/entertainment merchants that
// look like recurring monthly charges) by merchant, so the user can spot
// duplicate or forgotten subscriptions.
router.get('/subscriptions', (req, res) => {
  const months = req.query.months === undefined ? 6 : Number(req.query.months);
  if (!Number.isInteger(months) || months < 1 || months > 60) {
    return res.status(400).json({ error: 'months must be an integer between 1 and 60' });
  }

  // Build the window from the first day of the month `months - 1` back, so the
  // report always covers whole calendar months. Using Date.setMonth() here would
  // overflow on the 29th-31st and silently skip part of the intended period.
  const sinceStr = `${shiftMonth(currentMonthLocal(), -(months - 1))}-01`;

  const rows = db
    .prepare(
      `SELECT COALESCE(NULLIF(t.merchant, ''), t.description) AS merchant,
              c.id AS category_id, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
              COUNT(*) AS charge_count,
              COALESCE(SUM(-t.amount), 0) AS total_spent,
              COALESCE(AVG(-t.amount), 0) AS avg_amount,
              MAX(t.date) AS last_charged,
              MIN(t.date) AS first_charged
       FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE c.name = 'Subscriptions' AND t.amount < 0 AND t.date >= ?
       GROUP BY COALESCE(NULLIF(t.merchant, ''), t.description), c.id
       ORDER BY total_spent DESC`
    )
    .all(sinceStr);

  const monthly = rows.map((r) => ({
    ...r,
    estimated_monthly_cost: r.charge_count > 0 ? r.total_spent / months : 0,
  }));

  res.json({
    months,
    totalMonthlyCost: monthly.reduce((sum, r) => sum + r.estimated_monthly_cost, 0),
    subscriptions: monthly,
  });
});

router.get('/net-worth', (_req, res) => {
  const history = db.prepare('SELECT * FROM net_worth_snapshots ORDER BY date ASC').all();
  res.json(history);
});

router.post('/net-worth/snapshot', (_req, res) => {
  const { assets, liabilities, netWorth } = currentNetWorth();
  const today = todayLocal();
  db.prepare(
    `INSERT INTO net_worth_snapshots (date, total_assets, total_liabilities, net_worth) VALUES (?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET total_assets = excluded.total_assets,
       total_liabilities = excluded.total_liabilities, net_worth = excluded.net_worth`
  ).run(today, assets, liabilities, netWorth);
  res.status(201).json(db.prepare('SELECT * FROM net_worth_snapshots WHERE date = ?').get(today));
});

export default router;
