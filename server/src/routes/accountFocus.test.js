// Reports, budgets and bills can be focused on one account with ?account_id=.
process.env.BUDGET_DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

import test from 'node:test';
import assert from 'node:assert/strict';

const { createApp } = await import('../index.js');
const { currentMonthLocal, shiftMonth } = await import('../lib/dates.js');

const month = currentMonthLocal();
let server;
let base;
let everyday;
let credit;

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

test.before(async () => {
  server = await new Promise((resolve) => {
    const s = createApp().listen(0, () => resolve(s));
  });
  base = `http://localhost:${server.address().port}/api`;
  everyday = (await call('POST', '/accounts', { name: 'Everyday', starting_balance: 1000 })).body;
  credit = (await call('POST', '/accounts', { name: 'Visa', type: 'credit', is_liability: true })).body;

  const categories = (await call('GET', '/categories')).body;
  const groceries = categories.find((c) => c.name === 'Groceries').id;
  const add = (account, description, amount, date = `${month}-02`, category_id = groceries) =>
    call('POST', '/transactions', { account_id: account.id, date, description, amount, category_id });

  await add(everyday, 'Countdown', -100);
  await add(everyday, 'Salary', 2000, `${month}-01`, null);
  await add(credit, 'New World', -40);
  // Three monthly charges on the card so bill detection has something to find.
  for (const offset of [-3, -2, -1]) await add(credit, 'Netflix', -20, `${shiftMonth(month, offset)}-05`);
  await call('POST', '/recurring-bills', { name: 'Rent', amount: 500, account_id: everyday.id });
  await call('POST', '/recurring-bills', { name: 'Gym', amount: 30 });
  await call('POST', '/budgets', { category_id: groceries, month, amount: 300 });
});

test.after(() => server.close());

test('monthly snapshot totals follow the focused account', async () => {
  const all = (await call('GET', `/reports/monthly-snapshot?month=${month}`)).body;
  const card = (await call('GET', `/reports/monthly-snapshot?month=${month}&account_id=${credit.id}`)).body;
  const bank = (await call('GET', `/reports/monthly-snapshot?month=${month}&account_id=${everyday.id}`)).body;
  assert.equal(all.spend, 140);
  assert.equal(card.spend, 40);
  assert.equal(bank.spend, 100);
  assert.equal(bank.income, 2000);
  assert.deepEqual(card.merchants.map((m) => m.merchant), ['New World']);
});

test('summary and trends are scoped to the account', async () => {
  const summary = (await call('GET', `/reports/summary?account_id=${everyday.id}`)).body;
  assert.equal(summary.assets, 2900);
  assert.equal(summary.liabilities, 0);
  assert.equal(summary.spend, 100);

  const trends = (await call('GET', `/reports/trends?months=12&account_id=${credit.id}`)).body;
  assert.equal(trends.length, 4);
  assert.ok(trends.every((t) => t.income === 0));
});

test('budgets keep their amount but count only the focused spend', async () => {
  const [budget] = (await call('GET', `/budgets?month=${month}&account_id=${credit.id}`)).body;
  assert.equal(budget.amount, 300);
  assert.equal(budget.spent, 40);
  const [overall] = (await call('GET', `/budgets?month=${month}`)).body;
  assert.equal(overall.spent, 140);
});

test('bills and bill detection follow the focused account', async () => {
  const bills = (await call('GET', `/recurring-bills?account_id=${everyday.id}`)).body;
  assert.deepEqual(bills.map((b) => b.name), ['Rent']);
  assert.equal((await call('GET', '/recurring-bills')).body.length, 2);

  const onCard = (await call('GET', `/recurring-bills/detect?account_id=${credit.id}`)).body;
  assert.ok(onCard.candidates.some((c) => c.name.toLowerCase().includes('netflix')));
  const onBank = (await call('GET', `/recurring-bills/detect?account_id=${everyday.id}`)).body;
  assert.equal(onBank.candidates.length, 0);
});

test('an invalid account_id is rejected', async () => {
  for (const path of ['/reports/summary', `/budgets?month=${month}&`, '/recurring-bills', '/recurring-bills/detect']) {
    const sep = path.includes('?') ? '' : '?';
    const { status } = await call('GET', `${path}${sep}account_id=abc`);
    assert.equal(status, 400, path);
  }
});
