// Isolated in-memory DB (set before importing app/db modules), separate process
// from api.test.js so seeded state can't leak between the two suites.
process.env.BUDGET_DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

import test from 'node:test';
import assert from 'node:assert/strict';

const { createApp } = await import('../index.js');
const { todayLocal, currentMonthLocal, shiftMonth, isValidDate, isValidMonth } = await import('../lib/dates.js');
const { classifyFrequency } = await import('../lib/insights.js');

const app = createApp();

async function withServer(fn) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://localhost:${server.address().port}/api`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

const json = (r) => r.json();
function post(base, path, body) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function makeAccount(base, name) {
  return post(base, '/accounts', { name, starting_balance: 0 }).then(json);
}

/** YYYY-MM-DD `days` before today, in the local calendar. */
function daysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return todayLocal(d);
}

test('local date helpers stay in the local calendar and validate real dates', () => {
  // A NZ morning (UTC+12/13) is still "yesterday" in UTC — todayLocal must not drift.
  const nzMorning = new Date(2026, 2, 1, 8, 30); // 1 Mar 2026, 08:30 local
  assert.equal(todayLocal(nzMorning), '2026-03-01');
  assert.equal(currentMonthLocal(nzMorning), '2026-03');

  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-03', -14), '2025-01');

  assert.equal(isValidDate('2026-02-29'), false); // 2026 is not a leap year
  assert.equal(isValidDate('2024-02-29'), true);
  assert.equal(isValidDate('2026-13-01'), false);
  assert.equal(isValidDate('not-a-date'), false);
  assert.equal(isValidMonth('2026-13'), false);
  assert.equal(isValidMonth('2026-07'), true);
});

test('frequency classification maps real cadences and rejects irregular gaps', () => {
  assert.equal(classifyFrequency(7), 'weekly');
  assert.equal(classifyFrequency(14), 'fortnightly');
  assert.equal(classifyFrequency(30), 'monthly');
  assert.equal(classifyFrequency(365), 'yearly');
  assert.equal(classifyFrequency(3), null);
  assert.equal(classifyFrequency(60), null); // quarterly isn't a supported bill frequency
});

test('monthly snapshot groups merchants by expression, not the nullable column', async () => {
  await withServer(async (base) => {
    const account = await makeAccount(base, 'Merchant Grouping');
    const month = currentMonthLocal();
    // Three distinct descriptions that no seeded rule matches, so merchant stays NULL.
    // Grouping on the bare `merchant` column would collapse all of these into one row.
    const transactions = [
      { date: `${month}-05`, description: 'ZZQ UNKNOWN ALPHA', amount: -10 },
      { date: `${month}-06`, description: 'ZZQ UNKNOWN BETA', amount: -20 },
      { date: `${month}-07`, description: 'ZZQ UNKNOWN GAMMA', amount: -30 },
    ];
    await post(base, '/transactions/import', { account_id: account.id, transactions }).then(json);

    const snapshot = await fetch(`${base}/reports/monthly-snapshot?month=${month}`).then(json);
    const unknown = snapshot.merchants.filter((m) => m.merchant.startsWith('ZZQ UNKNOWN'));
    assert.equal(unknown.length, 3, 'each null-merchant transaction should be its own group');
    assert.deepEqual(
      unknown.map((m) => m.total).sort((a, b) => a - b),
      [10, 20, 30]
    );
    for (const row of unknown) assert.equal(row.count, 1);
  });
});

test('budget suggestions derive targets from prior complete months and can be applied', async () => {
  await withServer(async (base) => {
    const account = await makeAccount(base, 'Budget Suggestions');
    const month = currentMonthLocal();
    // Consistent $100/month of groceries across the three prior months.
    const transactions = [1, 2, 3].map((back) => ({
      date: `${shiftMonth(month, -back)}-10`,
      description: 'COUNTDOWN',
      amount: -100,
    }));
    // Current (partial) month must be excluded from the basis.
    transactions.push({ date: `${month}-02`, description: 'COUNTDOWN', amount: -5 });
    await post(base, '/transactions/import', { account_id: account.id, transactions }).then(json);

    const report = await fetch(`${base}/budgets/suggestions?month=${month}&lookback=3`).then(json);
    assert.deepEqual(report.monthsConsidered, [shiftMonth(month, -3), shiftMonth(month, -2), shiftMonth(month, -1)]);

    const groceries = report.suggestions.find((s) => s.category_name === 'Groceries');
    assert.ok(groceries, 'groceries should be suggested');
    assert.equal(groceries.median_monthly, 100);
    assert.equal(groceries.suggested_amount, 100, 'rounds up to nearest $10 from a $100 median');
    assert.equal(groceries.months_with_spend, 3);
    assert.equal(groceries.existing_amount, null);
    assert.equal(groceries.recommended, true);

    const applied = await post(base, '/budgets/suggestions/apply', {
      month,
      budgets: [{ category_id: groceries.category_id, amount: groceries.suggested_amount }],
    }).then(json);
    assert.equal(applied.applied, 1);

    const budgets = await fetch(`${base}/budgets?month=${month}`).then(json);
    const saved = budgets.find((b) => b.category_id === groceries.category_id);
    assert.equal(saved.amount, 100);
    assert.equal(saved.spent, 5, 'spend reflects the current month only');

    // Re-running the suggestion now reports the existing budget.
    const rerun = await fetch(`${base}/budgets/suggestions?month=${month}&lookback=3`).then(json);
    assert.equal(rerun.suggestions.find((s) => s.category_id === groceries.category_id).existing_amount, 100);
  });
});

test('budget suggestions reject an out-of-range lookback', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/budgets/suggestions?lookback=99`);
    assert.equal(res.status, 400);
  });
});

test('recurring detection finds regular charges and ignores irregular ones', async () => {
  await withServer(async (base) => {
    const account = await makeAccount(base, 'Recurring Detection');
    const transactions = [];
    // Fortnightly gym membership, identical amount, 8 occurrences.
    for (let i = 0; i < 8; i += 1) {
      transactions.push({ date: daysAgo(i * 14), description: 'SNAP FITNESS', amount: -39.9 });
    }
    // Random one-off purchases from the same shop at irregular intervals.
    for (const days of [3, 5, 40, 44, 100]) {
      transactions.push({ date: daysAgo(days), description: 'ZZQ RANDOM SHOP', amount: -12.5 });
    }
    await post(base, '/transactions/import', { account_id: account.id, transactions }).then(json);

    const report = await fetch(`${base}/recurring-bills/detect?months=12`).then(json);
    const gym = report.candidates.find((c) => c.name === 'Snap Fitness');
    assert.ok(gym, 'the fortnightly charge should be detected');
    assert.equal(gym.frequency, 'fortnightly');
    assert.equal(gym.amount, 39.9);
    assert.equal(gym.occurrences, 8);
    assert.equal(gym.median_gap_days, 14);
    assert.equal(gym.amount_varies, false);
    assert.equal(gym.already_tracked, false);
    assert.ok(gym.confidence > 0.9, `expected high confidence, got ${gym.confidence}`);

    assert.ok(
      !report.candidates.some((c) => c.name.includes('RANDOM SHOP')),
      'irregular spending must not be reported as a recurring bill'
    );

    // Accepting a candidate creates a real bill, and re-detecting flags it as tracked.
    const applied = await post(base, '/recurring-bills/detect/apply', {
      bills: [
        {
          name: gym.name,
          amount: gym.amount,
          frequency: gym.frequency,
          due_day: gym.due_day,
          category_id: gym.category_id,
          account_id: gym.account_id,
        },
      ],
    }).then(json);
    assert.equal(applied.created, 1);

    const bills = await fetch(`${base}/recurring-bills`).then(json);
    assert.equal(bills.length, 1);
    assert.equal(bills[0].name, 'Snap Fitness');
    assert.equal(bills[0].frequency, 'fortnightly');

    const rerun = await fetch(`${base}/recurring-bills/detect?months=12`).then(json);
    assert.equal(rerun.candidates.find((c) => c.name === 'Snap Fitness').already_tracked, true);

    // Applying the same candidate again must not create a duplicate bill.
    const again = await post(base, '/recurring-bills/detect/apply', {
      bills: [{ name: 'Snap Fitness', amount: 39.9, frequency: 'fortnightly', due_day: 1 }],
    }).then(json);
    assert.equal(again.created, 0);
    assert.equal(again.skipped, 1);
  });
});

test('CSV import dedupes equivalent amounts and rows already present from another source', async () => {
  await withServer(async (base) => {
    const account = await makeAccount(base, 'Dedupe');

    const first = await post(base, '/transactions/import', {
      account_id: account.id,
      transactions: [{ date: '2026-04-01', description: 'ZZQ CANONICAL TEST', amount: -42.5 }],
    }).then(json);
    assert.equal(first.imported, 1);

    // Same transaction, formatted differently: -42.50, padded description, different case.
    const second = await post(base, '/transactions/import', {
      account_id: account.id,
      transactions: [{ date: '2026-04-01', description: '  zzq canonical test  ', amount: -42.5 }],
    }).then(json);
    assert.equal(second.imported, 0, 'a re-formatted duplicate must not import twice');
    assert.equal(second.duplicates, 1);

    // A row created outside CSV import (so it has no matching hash) is still caught.
    await post(base, '/transactions', {
      account_id: account.id,
      date: '2026-04-02',
      description: 'ZZQ MANUAL ENTRY',
      amount: -19.99,
    }).then(json);
    const third = await post(base, '/transactions/import', {
      account_id: account.id,
      transactions: [{ date: '2026-04-02', description: 'ZZQ MANUAL ENTRY', amount: -19.99 }],
    }).then(json);
    assert.equal(third.imported, 0, 'cross-source duplicates must be skipped');
    assert.equal(third.duplicates, 1);

    // Invalid rows are counted separately rather than silently stored.
    const fourth = await post(base, '/transactions/import', {
      account_id: account.id,
      transactions: [
        { date: '2026-02-31', description: 'ZZQ BAD DATE', amount: -1 },
        { date: '2026-04-03', description: 'ZZQ BAD AMOUNT', amount: 'abc' },
      ],
    }).then(json);
    assert.equal(fourth.imported, 0);
    assert.equal(fourth.invalid, 2);

    const all = await fetch(`${base}/transactions?account_id=${account.id}`).then(json);
    assert.equal(all.length, 2, 'only the two genuine transactions should exist');
  });
});

test('financial endpoints reject malformed input instead of storing it', async () => {
  await withServer(async (base) => {
    const account = await makeAccount(base, 'Validation');

    const cases = [
      ['/transactions', { account_id: account.id, date: '2026-02-31', description: 'x', amount: -1 }],
      ['/transactions', { account_id: account.id, date: '2026-02-01', description: 'x', amount: 'abc' }],
      ['/transactions', { account_id: account.id, date: '2026-02-01', description: '   ', amount: -1 }],
      ['/transactions', { account_id: 999999, date: '2026-02-01', description: 'x', amount: -1 }],
      ['/budgets', { category_id: 1, month: '2026-09', amount: 'abc' }],
      ['/budgets', { category_id: 1, month: '2026-09', amount: -5 }],
      ['/budgets', { category_id: 1, month: '2026-13', amount: 5 }],
      ['/recurring-bills', { name: 'x', amount: -5 }],
      ['/recurring-bills', { name: 'x', amount: 5, frequency: 'daily' }],
      ['/recurring-bills', { name: 'x', amount: 5, due_day: 31 }],
      ['/accounts', { name: 'x', type: 'crypto' }],
      ['/accounts', { name: 'x', starting_balance: 'lots' }],
    ];
    for (const [path, body] of cases) {
      const res = await post(base, path, body);
      assert.equal(res.status, 400, `${path} ${JSON.stringify(body)} should be rejected`);
    }

    const res = await fetch(`${base}/reports/subscriptions?months=-3`);
    assert.equal(res.status, 400);

    const stored = await fetch(`${base}/transactions?account_id=${account.id}`).then(json);
    assert.equal(stored.length, 0, 'no invalid transaction should have been stored');
  });
});

test('deleting an account with transactions requires explicit confirmation', async () => {
  await withServer(async (base) => {
    const account = await makeAccount(base, 'Delete Guard');
    await post(base, '/transactions', {
      account_id: account.id,
      date: todayLocal(),
      description: 'ZZQ IMPORTANT HISTORY',
      amount: -25,
    }).then(json);

    const blocked = await fetch(`${base}/accounts/${account.id}`, { method: 'DELETE' });
    assert.equal(blocked.status, 409);
    const body = await blocked.json();
    assert.equal(body.transactionCount, 1);
    assert.equal(body.requiresConfirmation, true);

    const stillThere = await fetch(`${base}/accounts`).then(json);
    assert.ok(stillThere.some((a) => a.id === account.id), 'account must survive an unconfirmed delete');

    const confirmed = await fetch(`${base}/accounts/${account.id}?confirm=true`, { method: 'DELETE' });
    assert.equal(confirmed.status, 204);
  });
});

test('deleting a seeded merchant rule keeps it deleted and can be restored', async () => {
  await withServer(async (base) => {
    const rules = await fetch(`${base}/merchant-rules`).then(json);
    const seeded = rules.find((r) => r.pattern === 'briscoes');
    assert.ok(seeded, 'expected a seeded briscoes rule');

    assert.equal((await fetch(`${base}/merchant-rules/${seeded.id}`, { method: 'DELETE' })).status, 204);

    // Re-running the seeder (as happens on every server start) must not resurrect it.
    const { db } = await import('../db/index.js');
    const { DEFAULT_MERCHANT_RULES } = await import('../lib/categorize.js');
    const insert = db.prepare(
      `INSERT OR IGNORE INTO merchant_rules (pattern, match_type, merchant_name, category_id)
       SELECT @pattern, 'contains', @merchant, id FROM categories WHERE name = @category`
    );
    const dismissed = db.prepare('SELECT 1 FROM dismissed_seed_rules WHERE pattern = ?');
    for (const row of DEFAULT_MERCHANT_RULES) {
      if (!dismissed.get(row.pattern)) insert.run(row);
    }

    const afterReseed = await fetch(`${base}/merchant-rules`).then(json);
    assert.ok(!afterReseed.some((r) => r.pattern === 'briscoes'), 'deleted seed rule must stay deleted');

    await post(base, '/merchant-rules/restore-defaults', {});
    const restored = await fetch(`${base}/merchant-rules`).then(json);
    assert.ok(restored.some((r) => r.pattern === 'briscoes'), 'restore should bring the default back');
  });
});
