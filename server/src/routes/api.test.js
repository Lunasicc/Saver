// Uses an isolated in-memory SQLite DB (set before importing app/db modules) so
// tests never touch the real budget.sqlite file.
process.env.BUDGET_DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

import test from 'node:test';
import assert from 'node:assert/strict';
// Dynamic import so BUDGET_DB_PATH/NODE_ENV (set above) are in place before
// index.js and its dependent modules are evaluated — static imports would
// otherwise be hoisted above these env var assignments.
const { createApp } = await import('../index.js');

const app = createApp();

async function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function withServer(fn) {
  const server = await listen();
  const port = server.address().port;
  const base = `http://localhost:${port}/api`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

test('account creation and balance recalculation after transactions', async () => {
  await withServer(async (base) => {
    const account = await fetch(`${base}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Account', starting_balance: 100 }),
    }).then((r) => r.json());
    assert.equal(account.current_balance, 100);

    await fetch(`${base}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_id: account.id, date: '2026-01-01', description: 'Coffee', amount: -5 }),
    });

    const updated = await fetch(`${base}/accounts`).then((r) => r.json());
    assert.equal(updated.find((a) => a.id === account.id).current_balance, 95);
  });
});

test('CSV import dedupes identical rows and skips invalid rows', async () => {
  await withServer(async (base) => {
    const account = await fetch(`${base}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'CSV Account', starting_balance: 0 }),
    }).then((r) => r.json());

    const transactions = [
      { date: '2026-01-05', description: 'Countdown', amount: -42.5 },
      { date: '2026-01-05', description: 'Countdown', amount: -42.5 }, // duplicate
      { date: '', description: 'Invalid row', amount: -1 }, // missing date -> skipped
    ];

    const result = await fetch(`${base}/transactions/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_id: account.id, transactions }),
    }).then((r) => r.json());

    assert.equal(result.imported, 1);
    assert.equal(result.skipped, 2);
    assert.equal(result.total, 3);
  });
});

test('parse-csv rejects empty input and parses headers/rows', async () => {
  await withServer(async (base) => {
    const emptyRes = await fetch(`${base}/transactions/parse-csv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csvText: '' }),
    });
    assert.equal(emptyRes.status, 400);

    const csvText = 'Date,Description,Amount\n2026-01-01,Salary,2000\n2026-01-02,Rent,-500';
    const parsed = await fetch(`${base}/transactions/parse-csv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csvText }),
    }).then((r) => r.json());

    assert.deepEqual(parsed.headers, ['Date', 'Description', 'Amount']);
    assert.equal(parsed.rowCount, 2);
  });
});

test('akahu status reflects whether tokens are configured', async () => {
  await withServer(async (base) => {
    const before = process.env.AKAHU_APP_TOKEN;
    delete process.env.AKAHU_APP_TOKEN;
    const status = await fetch(`${base}/akahu/status`).then((r) => r.json());
    assert.equal(status.configured, false);
    if (before) process.env.AKAHU_APP_TOKEN = before;
  });
});

test('akahu sync is rejected with a clear error when not configured', async () => {
  await withServer(async (base) => {
    const before = { app: process.env.AKAHU_APP_TOKEN, user: process.env.AKAHU_USER_TOKEN };
    delete process.env.AKAHU_APP_TOKEN;
    delete process.env.AKAHU_USER_TOKEN;
    const res = await fetch(`${base}/akahu/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /not connected/i);
    if (before.app) process.env.AKAHU_APP_TOKEN = before.app;
    if (before.user) process.env.AKAHU_USER_TOKEN = before.user;
  });
});
test('budgets endpoint requires a month and returns spend totals', async () => {
  await withServer(async (base) => {
    const noMonth = await fetch(`${base}/budgets`);
    assert.equal(noMonth.status, 400);

    const account = await fetch(`${base}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Budget Account', starting_balance: 0 }),
    }).then((r) => r.json());
    const categories = await fetch(`${base}/categories`).then((r) => r.json());
    const groceries = categories.find((c) => c.name === 'Groceries');

    await fetch(`${base}/budgets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category_id: groceries.id, month: '2026-02', amount: 300 }),
    });
    await fetch(`${base}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_id: account.id,
        date: '2026-02-10',
        description: 'Groceries run',
        amount: -60,
        category_id: groceries.id,
      }),
    });

    const budgets = await fetch(`${base}/budgets?month=2026-02`).then((r) => r.json());
    const g = budgets.find((b) => b.category_id === groceries.id);
    assert.equal(g.amount, 300);
    assert.equal(g.spent, 60);
  });
});

test('CSV import auto-categorizes known merchants and derives merchant name', async () => {
  await withServer(async (base) => {
    const account = await fetch(`${base}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Auto Categorize Account', starting_balance: 0 }),
    }).then((r) => r.json());

    const transactions = [
      { date: '2026-03-01', description: 'CARD 1234 FRESH CHOICEPAPANUI', amount: -55.2 },
      { date: '2026-03-02', description: 'NETFLIX.COM', amount: -22.99 },
    ];

    const result = await fetch(`${base}/transactions/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_id: account.id, transactions }),
    }).then((r) => r.json());
    assert.equal(result.imported, 2);
    assert.equal(result.categorized, 2);

    const rows = await fetch(`${base}/transactions?account_id=${account.id}`).then((r) => r.json());
    const categories = await fetch(`${base}/categories`).then((r) => r.json());
    const groceries = categories.find((c) => c.name === 'Groceries');
    const subs = categories.find((c) => c.name === 'Subscriptions');

    const fresh = rows.find((r) => r.description.includes('FRESH CHOICE'));
    assert.equal(fresh.category_id, groceries.id);
    assert.equal(fresh.merchant, 'Fresh Choice');

    const netflix = rows.find((r) => r.description.includes('NETFLIX'));
    assert.equal(netflix.category_id, subs.id);
  });
});

test('manually correcting a category is learned and applied to future identical transactions', async () => {
  await withServer(async (base) => {
    const account = await fetch(`${base}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Learning Account', starting_balance: 0 }),
    }).then((r) => r.json());
    const categories = await fetch(`${base}/categories`).then((r) => r.json());
    const health = categories.find((c) => c.name === 'Health');

    const description = 'WWWSNAPFITN WWWSNAPFITN';
    const first = await fetch(`${base}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_id: account.id, date: '2026-04-01', description, amount: -19.9 }),
    }).then((r) => r.json());
    // Snap Fitness already has a seeded default rule, so this should auto-categorize.
    assert.equal(first.category_id, health.id);

    // Now simulate the user re-categorizing a differently-worded transaction; this
    // should create a *learned* exact rule so the same description auto-matches next time.
    const other = categories.find((c) => c.name === 'Other');
    const custom = await fetch(`${base}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_id: account.id,
        date: '2026-04-02',
        description: 'MY LOCAL GYM STUDIO XYZ',
        amount: -30,
      }),
    }).then((r) => r.json());
    assert.equal(custom.category_id, null);

    await fetch(`${base}/transactions/${custom.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category_id: other.id }),
    });

    const second = await fetch(`${base}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_id: account.id,
        date: '2026-04-15',
        description: 'MY LOCAL GYM STUDIO XYZ',
        amount: -30,
      }),
    }).then((r) => r.json());
    assert.equal(second.category_id, other.id);
  });
});

test('monthly snapshot groups spend by category and merchant with prior-month comparison', async () => {
  await withServer(async (base) => {
    const account = await fetch(`${base}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Snapshot Account', starting_balance: 0 }),
    }).then((r) => r.json());

    const rowsToInsert = [
      { date: '2026-08-01', description: 'COUNTDOWN NEWTOWN', amount: -100 },
      { date: '2026-08-05', description: 'COUNTDOWN NEWTOWN', amount: -50 },
      { date: '2026-08-10', description: 'NETFLIX.COM', amount: -22.99 },
      { date: '2026-08-20', description: 'SALARY PAYMENT', amount: 3000 },
      { date: '2026-07-01', description: 'COUNTDOWN NEWTOWN', amount: -80 },
    ];
    await fetch(`${base}/transactions/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_id: account.id, transactions: rowsToInsert }),
    });

    const snapshot = await fetch(`${base}/reports/monthly-snapshot?month=2026-08`).then((r) => r.json());
    assert.equal(snapshot.month, '2026-08');
    assert.equal(snapshot.previousMonth, '2026-07');
    assert.equal(snapshot.income, 3000);
    assert.equal(Math.round(snapshot.spend * 100) / 100, 172.99);
    assert.equal(Math.round(snapshot.previous.spend * 100) / 100, 80);

    const groceries = snapshot.categories.find((c) => c.name === 'Groceries');
    assert.equal(groceries.total, 150);
    assert.equal(groceries.count, 2);

    const countdownMerchant = snapshot.merchants.find((m) => m.merchant === 'Countdown');
    assert.equal(countdownMerchant.total, 150);
    assert.equal(countdownMerchant.count, 2);
  });
});

test('merchant rules can be listed, edited and deleted', async () => {
  await withServer(async (base) => {
    const rules = await fetch(`${base}/merchant-rules`).then((r) => r.json());
    assert.ok(rules.length > 0, 'expected seeded default rules to exist');
    // Use an unrelated rule (not netflix/spotify) since this shared in-memory
    // DB persists across tests and other tests rely on those staying seeded.
    const kmartRule = rules.find((r) => r.pattern === 'kmart');
    assert.ok(kmartRule, 'expected seeded Kmart rule');
    assert.equal(kmartRule.match_type, 'contains');

    const categories = await fetch(`${base}/categories`).then((r) => r.json());
    const groceries = categories.find((c) => c.name === 'Groceries');

    const updated = await fetch(`${base}/merchant-rules/${kmartRule.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category_id: groceries.id }),
    }).then((r) => r.json());
    assert.equal(updated.category_id, groceries.id);

    const del = await fetch(`${base}/merchant-rules/${kmartRule.id}`, { method: 'DELETE' });
    assert.equal(del.status, 204);

    const afterDelete = await fetch(`${base}/merchant-rules`).then((r) => r.json());
    assert.ok(!afterDelete.some((r) => r.id === kmartRule.id));
  });
});

test('subscriptions report groups recurring subscription charges by merchant', async () => {
  await withServer(async (base) => {
    const account = await fetch(`${base}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Subs Account', starting_balance: 0 }),
    }).then((r) => r.json());

    const transactions = [
      { date: '2026-06-01', description: 'ICLOUD.COM BILL', amount: -3.99 },
      { date: '2026-07-01', description: 'ICLOUD.COM BILL', amount: -3.99 },
      { date: '2026-08-01', description: 'ICLOUD.COM BILL', amount: -3.99 },
      { date: '2026-08-05', description: 'AMAZON PRIME NZ', amount: -8.99 },
    ];
    await fetch(`${base}/transactions/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_id: account.id, transactions }),
    });

    const report = await fetch(`${base}/reports/subscriptions?months=6`).then((r) => r.json());
    const icloud = report.subscriptions.find((s) => s.merchant === 'iCloud');
    assert.ok(icloud, 'expected iCloud to show up in subscriptions report');
    assert.equal(icloud.charge_count, 3);
    assert.equal(Math.round(icloud.total_spent * 100) / 100, 11.97);

    const prime = report.subscriptions.find((s) => s.merchant === 'Amazon Prime');
    assert.ok(prime);
    assert.equal(prime.charge_count, 1);
  });
});
