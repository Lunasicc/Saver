import { Router } from 'express';
import { db } from '../db/index.js';
import { todayLocal, currentMonthLocal, shiftMonth, isValidMonth } from '../lib/dates.js';
import { accountClause, parseAccountFilter } from '../lib/accountFilter.js';
import { monthBounds, round2, spendingBetween } from '../lib/spending.js';
import { normalizeForMatch } from '../lib/categorize.js';

const router = Router();

// Reports group spending by top-level category; these join a transaction's
// category to its parent (when it's a sub-category).
const TOP_JOIN = 'JOIN categories c ON c.id = t.category_id LEFT JOIN categories p ON p.id = c.parent_id';
const TOP_COLUMNS = `COALESCE(p.id, c.id) AS category_id, COALESCE(p.name, c.name) AS name,
  COALESCE(p.color, c.color) AS color, COALESCE(p.icon, c.icon) AS icon, COALESCE(p.is_fixed, c.is_fixed) AS is_fixed`;

// Every report here accepts ?account_id= to focus on a single account.
router.use((req, res, next) => {
  const { account, error } = parseAccountFilter(req.query);
  if (error) return res.status(400).json({ error });
  res.locals.account = account;
  next();
});

function currentNetWorth(account = null) {
  const rows = db
    .prepare(`SELECT current_balance, is_liability FROM accounts WHERE ${accountClause('id')}`)
    .all({ account });
  let assets = 0;
  let liabilities = 0;
  for (const r of rows) {
    if (r.is_liability) liabilities += Math.abs(r.current_balance);
    else assets += r.current_balance;
  }
  return { assets, liabilities, netWorth: assets - liabilities };
}

router.get('/summary', (_req, res) => {
  const { account } = res.locals;
  const { assets, liabilities, netWorth } = currentNetWorth(account);
  const month = currentMonthLocal();
  const { income, spend } = monthTotals(month, account);
  res.json({ assets, liabilities, netWorth, month, income, spend });
});

router.get('/spending-by-category', (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: 'month (YYYY-MM) query param is required' });
  // Sub-category spending rolls up into its top-level category.
  const rows = db
    .prepare(
      `SELECT ${TOP_COLUMNS}, COALESCE(SUM(-t.amount), 0) AS total
       FROM transactions t ${TOP_JOIN}
       WHERE strftime('%Y-%m', t.date) = @month AND t.amount < 0 AND ${accountClause('t.account_id')}
       GROUP BY COALESCE(p.id, c.id) ORDER BY total DESC`
    )
    .all({ month, account: res.locals.account });
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
       WHERE ${accountClause()}
       GROUP BY month
       ORDER BY month DESC
       LIMIT @months`
    )
    .all({ months, account: res.locals.account });
  res.json(rows.reverse());
});

function prevMonth(month) {
  return shiftMonth(month, -1);
}

function monthTotals(month, account = null) {
  return (
    db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS income,
                COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) AS spend
         FROM transactions WHERE strftime('%Y-%m', date) = @month AND ${accountClause()}`
      )
      .get({ month, account }) || { income: 0, spend: 0 }
  );
}

// Grouped spending summary for a given month: by category and by merchant/business,
// plus totals and a comparison against the previous month.
router.get('/monthly-snapshot', (req, res) => {
  const month = req.query.month || currentMonthLocal();
  if (!isValidMonth(month)) return res.status(400).json({ error: 'month must be in YYYY-MM format' });
  const { account } = res.locals;

  const categories = db
    .prepare(
      `SELECT ${TOP_COLUMNS}, COALESCE(SUM(-t.amount), 0) AS total, COUNT(*) AS count
       FROM transactions t ${TOP_JOIN}
       WHERE strftime('%Y-%m', t.date) = @month AND t.amount < 0 AND ${accountClause('t.account_id')}
       GROUP BY COALESCE(p.id, c.id) ORDER BY total DESC`
    )
    .all({ month, account });

  const subcategories = db
    .prepare(
      `SELECT c.parent_id, c.id AS category_id, c.name, c.color, c.icon,
              COALESCE(SUM(-t.amount), 0) AS total, COUNT(*) AS count
       FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE c.parent_id IS NOT NULL AND strftime('%Y-%m', t.date) = @month AND t.amount < 0
         AND ${accountClause('t.account_id')}
       GROUP BY c.id ORDER BY total DESC`
    )
    .all({ month, account });
  const childrenOf = new Map();
  for (const { parent_id: parentId, ...child } of subcategories) {
    if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
    childrenOf.get(parentId).push(child);
  }

  const uncategorizedSpend =
    db
      .prepare(
        `SELECT COALESCE(SUM(-amount), 0) AS total, COUNT(*) AS count
         FROM transactions
         WHERE strftime('%Y-%m', date) = @month AND amount < 0 AND category_id IS NULL AND ${accountClause()}`
      )
      .get({ month, account }) || { total: 0, count: 0 };

  // NOTE: group by the full expression, not the `merchant` alias. SQLite resolves a
  // bare `merchant` in GROUP BY to the underlying (nullable) column, which collapses
  // every transaction without a merchant into a single bogus group.
  const merchants = db
    .prepare(
      `SELECT COALESCE(NULLIF(merchant, ''), description) AS merchant,
              COALESCE(SUM(-amount), 0) AS total, COUNT(*) AS count
       FROM transactions
       WHERE strftime('%Y-%m', date) = @month AND amount < 0 AND ${accountClause()}
       GROUP BY COALESCE(NULLIF(merchant, ''), description)
       ORDER BY total DESC LIMIT 25`
    )
    .all({ month, account });

  const totals = monthTotals(month, account);
  const totalSpend = categories.reduce((sum, c) => sum + c.total, 0) + uncategorizedSpend.total;
  const withPct = categories.map((c) => ({
    ...c,
    pct: totalSpend > 0 ? c.total / totalSpend : 0,
    children: childrenOf.get(c.category_id) ?? [],
  }));

  let fixedSpend = 0;
  for (const tx of spendingBetween({ ...monthBounds(month), account })) if (tx.fixed) fixedSpend += tx.amount;

  const previousMonth = prevMonth(month);
  const prevTotals = monthTotals(previousMonth, account);

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
    split: { fixed: round2(fixedSpend), everyday: round2(totals.spend - fixedSpend) },
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
       FROM transactions t ${TOP_JOIN}
       WHERE (c.seed_key = 'Subscriptions' OR p.seed_key = 'Subscriptions') AND t.amount < 0 AND t.date >= @since
         AND ${accountClause('t.account_id')}
       GROUP BY COALESCE(NULLIF(t.merchant, ''), t.description), c.id
       ORDER BY total_spent DESC`
    )
    .all({ since: sinceStr, account: res.locals.account });

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

function monthParam(req, res) {
  const month = req.query.month || currentMonthLocal();
  if (!isValidMonth(month)) {
    res.status(400).json({ error: 'month must be in YYYY-MM format' });
    return null;
  }
  return month;
}

const categoryOf = (tx) =>
  tx.category_id
    ? { category_id: tx.category_id, category_name: tx.category_name, category_color: tx.category_color, category_icon: tx.category_icon }
    : { category_id: null, category_name: null, category_color: null, category_icon: null };

// Everyday spending for a month: the businesses it went to and the biggest
// single spends. Bills and commitments (categories marked as bills, plus
// tracked recurring bills) are left out so day-to-day spending stands out.
router.get('/top-spending', (req, res) => {
  const month = monthParam(req, res);
  if (!month) return;
  const rows = spendingBetween({ ...monthBounds(month), account: res.locals.account });

  const everyday = rows.filter((r) => !r.fixed);
  const places = new Map();
  for (const tx of everyday) {
    const key = normalizeForMatch(tx.place) || tx.place;
    let place = places.get(key);
    if (!place) {
      place = { merchant: tx.place, total: 0, count: 0, last_date: tx.date, byCategory: new Map() };
      places.set(key, place);
    }
    place.total += tx.amount;
    place.count += 1;
    if (tx.date > place.last_date) place.last_date = tx.date;
    const cat = categoryOf(tx);
    const seen = place.byCategory.get(cat.category_id) ?? { ...cat, n: 0 };
    seen.n += 1;
    place.byCategory.set(cat.category_id, seen);
  }
  const everydayTotal = everyday.reduce((s, r) => s + r.amount, 0);
  const placeList = [...places.values()]
    .map(({ byCategory, ...p }) => {
      const { n: _n, ...category } = [...byCategory.values()].sort((a, b) => b.n - a.n)[0];
      return { ...p, ...category, total: round2(p.total), average: round2(p.total / p.count), share: everydayTotal > 0 ? p.total / everydayTotal : 0 };
    })
    .sort((a, b) => b.total - a.total);

  const spends = [...everyday]
    .sort((a, b) => b.amount - a.amount || b.date.localeCompare(a.date))
    .slice(0, 10)
    .map((tx) => ({ id: tx.id, date: tx.date, merchant: tx.place, description: tx.description, amount: tx.amount, ...categoryOf(tx) }));

  const fixed = rows.filter((r) => r.fixed);
  const excludedByCategory = new Map();
  for (const tx of fixed) {
    const name = tx.top_name ?? 'Tracked bills';
    excludedByCategory.set(name, (excludedByCategory.get(name) ?? 0) + tx.amount);
  }

  res.json({
    month,
    everydayTotal: round2(everydayTotal),
    everydayCount: everyday.length,
    places: placeList.slice(0, 20),
    placeCount: placeList.length,
    spends,
    excluded: {
      total: round2(fixed.reduce((s, r) => s + r.amount, 0)),
      count: fixed.length,
      categories: [...excludedByCategory.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, total]) => ({ name, total: round2(total) })),
    },
  });
});

// Day-by-day spending for a month and the month before, for pace and calendar views.
router.get('/daily', (req, res) => {
  const month = monthParam(req, res);
  if (!month) return;
  const previousMonth = shiftMonth(month, -1);
  const current = monthBounds(month);
  const previous = monthBounds(previousMonth);
  const rows = spendingBetween({ from: previous.from, to: current.to, account: res.locals.account });

  const blank = (bounds) =>
    Array.from({ length: bounds.days }, (_, i) => ({
      date: `${bounds.from.slice(0, 8)}${String(i + 1).padStart(2, '0')}`,
      total: 0,
      everyday: 0,
      fixed: 0,
      count: 0,
      top: null,
    }));
  const days = blank(current);
  const before = blank(previous);
  for (const tx of rows) {
    const list = tx.date.startsWith(month) ? days : before;
    const day = list[Number(tx.date.slice(8, 10)) - 1];
    if (!day) continue;
    day.total += tx.amount;
    day.count += 1;
    if (tx.fixed) day.fixed += tx.amount;
    else {
      day.everyday += tx.amount;
      if (!day.top || tx.amount > day.top.amount) day.top = { merchant: tx.place, amount: tx.amount };
    }
  }
  const tidy = (d) => ({ ...d, total: round2(d.total), everyday: round2(d.everyday), fixed: round2(d.fixed) });
  res.json({ month, previousMonth, days: days.map(tidy), previous: before.map(tidy) });
});

// Monthly spend per top-level category over a window ending at `month`, to
// compare this month with what's usual.
router.get('/category-history', (req, res) => {
  const month = monthParam(req, res);
  if (!month) return;
  const count = req.query.months === undefined ? 6 : Number(req.query.months);
  if (!Number.isInteger(count) || count < 2 || count > 24) {
    return res.status(400).json({ error: 'months must be an integer between 2 and 24' });
  }
  const months = Array.from({ length: count }, (_, i) => shiftMonth(month, i - (count - 1)));
  const rows = db
    .prepare(
      `SELECT ${TOP_COLUMNS}, strftime('%Y-%m', t.date) AS month, COALESCE(SUM(-t.amount), 0) AS total
       FROM transactions t ${TOP_JOIN}
       WHERE t.amount < 0 AND COALESCE(p.is_income, c.is_income) = 0
         AND t.date >= @from AND t.date <= @to AND ${accountClause('t.account_id')}
       GROUP BY COALESCE(p.id, c.id), strftime('%Y-%m', t.date)`
    )
    .all({ from: `${months[0]}-01`, to: monthBounds(month).to, account: res.locals.account });

  // Months before the first transaction don't count towards "usual".
  const firstDate = db
    .prepare(`SELECT MIN(date) AS d FROM transactions WHERE ${accountClause()}`)
    .get({ account: res.locals.account })?.d;
  const firstMonth = firstDate ? firstDate.slice(0, 7) : month;

  const byCategory = new Map();
  for (const r of rows) {
    if (!byCategory.has(r.category_id)) {
      const { month: _m, total: _t, ...meta } = r;
      byCategory.set(r.category_id, { ...meta, totals: months.map(() => 0) });
    }
    byCategory.get(r.category_id).totals[months.indexOf(r.month)] = round2(r.total);
  }
  const history = months.slice(0, -1).map((m, i) => ({ m, i })).filter(({ m }) => m >= firstMonth);
  const categories = [...byCategory.values()]
    .map((c) => {
      const usual = history.length ? history.reduce((s, { i }) => s + c.totals[i], 0) / history.length : null;
      return { ...c, current: c.totals[c.totals.length - 1], usual: usual === null ? null : round2(usual) };
    })
    .sort((a, b) => Math.max(b.current, b.usual ?? 0) - Math.max(a.current, a.usual ?? 0));

  res.json({ month, months, monthsOfHistory: history.length, categories });
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
