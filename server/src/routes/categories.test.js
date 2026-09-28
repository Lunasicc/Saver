// Custom categories, sub-categories, and the everyday-spending reports built on them.
process.env.BUDGET_DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

import test from 'node:test';
import assert from 'node:assert/strict';

const { createApp } = await import('../index.js');
const { db } = await import('../db/index.js');
const { currentMonthLocal, shiftMonth } = await import('../lib/dates.js');

const month = currentMonthLocal();
const lastMonth = shiftMonth(month, -1);
let server;
let base;
let account;
let byName;

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

const refresh = async () => {
  byName = new Map((await call('GET', '/categories')).body.map((c) => [c.name, c]));
};
const add = (description, amount, category, date = `${month}-03`) =>
  call('POST', '/transactions', {
    account_id: account.id,
    date,
    description,
    amount,
    category_id: category ? byName.get(category).id : null,
  });

test.before(async () => {
  server = await new Promise((resolve) => {
    const s = createApp().listen(0, () => resolve(s));
  });
  base = `http://localhost:${server.address().port}/api`;
  account = (await call('POST', '/accounts', { name: 'Everyday', starting_balance: 5000 })).body;
  await refresh();
});
test.after(() => server.close());

test('built-in categories carry icon keys, bill flags and seed keys', () => {
  const housing = byName.get('Housing');
  assert.equal(housing.icon, 'house');
  assert.equal(housing.is_fixed, 1);
  assert.equal(housing.seed_key, 'Housing');
  assert.equal(byName.get('Dining Out').is_fixed, 0);
  assert.equal(byName.get('Dining Out').parent_id, null);
});

test('custom categories and sub-categories are validated', async () => {
  const pets = await call('POST', '/categories', { name: '  Pets ', icon: 'paw', color: '#AA5500' });
  assert.equal(pets.status, 201);
  assert.equal(pets.body.name, 'Pets');
  assert.equal(pets.body.color, '#aa5500');

  assert.equal((await call('POST', '/categories', { name: 'pets' })).status, 409, 'names are unique ignoring case');
  assert.equal((await call('POST', '/categories', { name: '' })).status, 400);
  assert.equal((await call('POST', '/categories', { name: 'X', color: 'red' })).status, 400);
  assert.equal((await call('POST', '/categories', { name: 'X', icon: '<script>' })).status, 400);
  assert.equal((await call('POST', '/categories', { name: 'X', parent_id: 99999 })).status, 400);

  const dining = byName.get('Dining Out');
  const coffee = await call('POST', '/categories', { name: 'Coffee', icon: 'coffee', parent_id: dining.id, is_income: 1 });
  assert.equal(coffee.status, 201);
  assert.equal(coffee.body.parent_id, dining.id);
  assert.equal(coffee.body.is_income, 0, 'sub-categories follow their parent');

  const rent = await call('POST', '/categories', { name: 'Rent', parent_id: byName.get('Housing').id });
  assert.equal(rent.body.is_fixed, 1, 'a new sub-category starts with its parent’s bill setting');

  assert.equal((await call('POST', '/categories', { name: 'Flat whites', parent_id: coffee.body.id })).status, 400, 'one level deep');
  const makeChild = await call('PUT', `/categories/${dining.id}`, { parent_id: pets.body.id });
  assert.equal(makeChild.status, 409, 'a category with sub-categories stays top-level');
  assert.equal((await call('PUT', `/categories/${pets.body.id}`, { parent_id: pets.body.id })).status, 400);

  const renamed = await call('PUT', `/categories/${byName.get('Travel').id}`, { name: 'Holidays', is_fixed: true });
  assert.equal(renamed.body.name, 'Holidays');
  assert.equal(renamed.body.seed_key, 'Travel');
  assert.equal(renamed.body.is_fixed, 1);
  await refresh();
});

test('sub-category spending rolls up into the parent everywhere', async () => {
  await add('CARD 1234 Espresso Bar', -6, 'Coffee');
  await add('CARD 1234 Espresso Bar', -5, 'Coffee', `${month}-04`);
  await add('Burger Place', -30, 'Dining Out');
  await call('POST', '/budgets', { category_id: byName.get('Dining Out').id, month, amount: 100 });

  const snap = (await call('GET', `/reports/monthly-snapshot?month=${month}`)).body;
  const dining = snap.categories.find((c) => c.name === 'Dining Out');
  assert.equal(dining.total, 41);
  assert.equal(dining.count, 3);
  assert.deepEqual(
    dining.children.map((c) => [c.name, c.total, c.count]),
    [['Coffee', 11, 2]]
  );
  assert.ok(!snap.categories.some((c) => c.name === 'Coffee'), 'sub-categories are not listed at the top level');

  const tx = (await call('GET', `/transactions?category_id=${byName.get('Dining Out').id}`)).body;
  assert.equal(tx.length, 3, 'filtering by a parent includes its sub-categories');
  const onlyCoffee = (await call('GET', `/transactions?category_id=${byName.get('Coffee').id}`)).body;
  assert.equal(onlyCoffee.length, 2);

  const budget = (await call('GET', `/budgets?month=${month}`)).body.find((b) => b.category_name === 'Dining Out');
  assert.equal(budget.spent, 41);

  const spend = (await call('GET', `/reports/spending-by-category?month=${month}`)).body;
  assert.equal(spend.find((c) => c.name === 'Dining Out').total, 41);
});

test('top spending leaves out bills and commitments', async () => {
  await add('MB TRANSFER TO LANDLORD', -800, 'Rent');
  await add('Power Co', -150, 'Utilities');
  await add('ACME GYM 123', -90, null);
  await call('POST', '/recurring-bills', { name: 'Acme Gym', amount: 90 });
  await add('CARD 9 Big TV Store', -400, 'Shopping', `${month}-05`);

  const top = (await call('GET', `/reports/top-spending?month=${month}`)).body;
  const names = top.places.map((p) => p.merchant);
  assert.deepEqual(names, ['Big TV Store', 'Burger Place', 'Espresso Bar']);
  const espresso = top.places.find((p) => p.merchant === 'Espresso Bar');
  assert.equal(espresso.count, 2);
  assert.equal(espresso.total, 11);
  assert.equal(espresso.category_name, 'Coffee');
  assert.equal(top.everydayTotal, 441);
  assert.equal(top.spends[0].amount, 400);
  assert.equal(top.spends[0].merchant, 'Big TV Store');
  assert.equal(top.excluded.total, 1040);
  assert.deepEqual(top.excluded.categories.map((c) => c.name), ['Housing', 'Utilities', 'Tracked bills']);

  const snap = (await call('GET', `/reports/monthly-snapshot?month=${month}`)).body;
  assert.deepEqual(snap.split, { fixed: 1040, everyday: 441 });
});

test('daily spending covers every day of this month and last', async () => {
  await add('Burger Place', -20, 'Dining Out', `${lastMonth}-10`);
  const daily = (await call('GET', `/reports/daily?month=${month}`)).body;
  assert.equal(daily.days[0].date, `${month}-01`);
  const third = daily.days[2];
  assert.equal(third.total, 30 + 6 + 800 + 150 + 90);
  assert.equal(third.everyday, 36);
  assert.equal(third.fixed, 1040);
  assert.deepEqual(third.top, { merchant: 'Burger Place', amount: 30 });
  assert.equal(daily.previous[9].total, 20);
  assert.equal((await call('GET', '/reports/daily?month=2026-13')).status, 400);
});

test('category history compares this month with the usual', async () => {
  const history = (await call('GET', `/reports/category-history?month=${month}&months=3`)).body;
  assert.equal(history.months.length, 3);
  const dining = history.categories.find((c) => c.name === 'Dining Out');
  assert.equal(dining.current, 41);
  assert.equal(dining.totals[1], 20);
  assert.equal(history.monthsOfHistory, 1, 'months before the first transaction are ignored');
  assert.equal(dining.usual, 20);
  assert.equal((await call('GET', '/reports/category-history?months=1')).status, 400);
});

test('deleting a sub-category hands its transactions to the parent', async () => {
  const coffee = byName.get('Coffee');
  const res = await call('DELETE', `/categories/${coffee.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.moved, 2);
  const dining = byName.get('Dining Out');
  const rows = db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE category_id = ?').get(dining.id);
  assert.equal(rows.n, 4);
  assert.ok(db.prepare("SELECT 1 FROM merchant_rules WHERE pattern = 'card1234espressobar' AND category_id = ?").get(dining.id));
});

test('deleting a top-level category removes its sub-categories and remembers built-ins', async () => {
  const housing = byName.get('Housing');
  const res = await call('DELETE', `/categories/${housing.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.removedSubcategories, 1);
  assert.equal(res.body.uncategorized, 1);
  await refresh();
  assert.ok(!byName.has('Rent'));
  assert.ok(!byName.has('Housing'));
  assert.ok(db.prepare("SELECT 1 FROM dismissed_seed_categories WHERE seed_key = 'Housing'").get());
  assert.equal((await call('DELETE', `/categories/${housing.id}`)).status, 404);
});

test('place names are tidied for top spending', async () => {
  const { tidyPlaceName } = await import('../lib/categorize.js');
  const cases = {
    'CARD 1234 ACME FUELSCHRISTCHURCH': 'Acme Fuels',
    'CARD 1234 Bright Dental CentreNewmarket': 'Bright Dental Centre',
    'ASB Insurance ASBInsurance990000000001TEST00000001': 'ASB Insurance',
    'CARD 1234 NOEL LEEMING3J INVERCAHAMILTON': 'Noel Leeming',
    'CARD 1234 THE WAREHOUSE ALBANY': 'The Warehouse',
    'BP CONNECT RICCARTON': 'BP Connect',
    'DEBITSUCCESS HARBOUR FITNESS REF00A1B2C3D4E5F6G7788990': 'Harbour Fitness',
    "Pak'nSave": "Pak'nSave",
    'Dairy Queen': 'Dairy Queen',
    'CARD 1 TACO POPCHRISTCHURCH': 'Taco Pop',
    'KFC HORNBY': 'KFC',
    'Acme.co.nzchristchurch': 'Acme.co.nz',
  };
  for (const [raw, expected] of Object.entries(cases)) assert.equal(tidyPlaceName(raw), expected, raw);
});
