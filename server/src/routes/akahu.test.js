// Isolated in-memory DB with app-saved tokens and a mocked Akahu API.
process.env.BUDGET_DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.AKAHU_APP_TOKEN = '';
process.env.AKAHU_USER_TOKEN = '';

import test from 'node:test';
import assert from 'node:assert/strict';

const { createApp } = await import('../index.js');
const { db } = await import('../db/index.js');
const { saveCredentials } = await import('../akahu/client.js');
const { syncStartDate, AUTO_SYNC_INTERVAL_MS, autoSync } = await import('../akahu/sync.js');
const { setSetting } = await import('../lib/settings.js');
const app = createApp();

const realFetch = globalThis.fetch;
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// A tiny fake Akahu: two logins (ANZ with two accounts, Kiwibank with one).
const fake = {
  accounts: [
    {
      _id: 'acc_anz1',
      _authorisation: 'auth_anz',
      connection: { _id: 'conn_anz', name: 'ANZ', logo: 'https://cdn.example/anz.png' },
      name: 'Everyday',
      formatted_account: '01-0123-0456789-00',
      status: 'ACTIVE',
      type: 'CHECKING',
      balance: { current: 1200.5, currency: 'NZD' },
      refreshed: { transactions: '2026-09-20T10:00:00.000Z' },
    },
    {
      _id: 'acc_anz2',
      _authorisation: 'auth_anz',
      connection: { _id: 'conn_anz', name: 'ANZ', logo: 'https://cdn.example/anz.png' },
      name: 'Visa',
      formatted_account: '4321-****-****-9876',
      status: 'ACTIVE',
      type: 'CREDITCARD',
      balance: { current: -300, currency: 'NZD' },
      refreshed: { transactions: '2026-09-19T10:00:00.000Z' },
    },
    {
      _id: 'acc_kiwi1',
      _authorisation: 'auth_kiwi',
      connection: { _id: 'conn_kiwi', name: 'Kiwibank', logo: null },
      name: 'Savings',
      formatted_account: '38-9000-0123456-01',
      status: 'INACTIVE',
      type: 'SAVINGS',
      balance: { current: 5000, currency: 'NZD' },
      refreshed: { transactions: '2026-08-01T10:00:00.000Z' },
    },
  ],
  transactions: [
    { _id: 'trans_1', _account: 'acc_anz1', date: '2026-09-18T00:00:00Z', description: 'COUNTDOWN', amount: -50 },
    { _id: 'trans_2', _account: 'acc_anz2', date: '2026-09-17T00:00:00Z', description: 'NETFLIX', amount: -20 },
    { _id: 'trans_3', _account: 'acc_kiwi1', date: '2026-09-16T00:00:00Z', description: 'INTEREST', amount: 3 },
  ],
  calls: [],
};

globalThis.fetch = async (url, init) => {
  const href = String(url);
  if (!href.startsWith('https://api.akahu.io/')) return realFetch(url, init);
  const u = new URL(href);
  fake.calls.push({ method: init?.method ?? 'GET', path: u.pathname, start: u.searchParams.get('start') });
  if (u.pathname === '/v1/accounts') return json({ success: true, items: fake.accounts });
  if (u.pathname === '/v1/transactions') return json({ success: true, items: fake.transactions, cursor: {} });
  if (u.pathname === '/v1/refresh' && init?.method === 'POST') return json({ success: true });
  return json({ success: false }, 404);
};
test.after(() => {
  globalThis.fetch = realFetch;
});

let base;
let server;
test.before(async () => {
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://localhost:${server.address().port}/api`;
});
test.after(() => server.close());

const call = (method, pathname, body) =>
  realFetch(`${base}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test('connection routes require Akahu to be connected', async () => {
  assert.equal((await call('GET', '/akahu/connections')).status, 400);
  assert.equal((await call('POST', '/akahu/refresh')).status, 400);
  const auto = await call('POST', '/akahu/auto-sync').then((r) => r.json());
  assert.deepEqual(auto, { ran: false, reason: 'not-connected' });
});

test('connections are grouped per bank login with masked numbers and health', async () => {
  saveCredentials({ appToken: 'app_token_x', userToken: 'user_token_y' });
  const auto = await call('POST', '/akahu/auto-sync').then((r) => r.json());
  assert.deepEqual(auto, { ran: false, reason: 'never-synced' }, 'first import is never automatic');
  const body = await call('GET', '/akahu/connections').then((r) => r.json());
  assert.equal(body.configured, true);
  assert.equal(body.connections.length, 2);

  const [anz, kiwi] = body.connections;
  assert.equal(anz.name, 'ANZ');
  assert.equal(anz.status, 'ACTIVE');
  assert.equal(anz.refreshedAt, '2026-09-19T10:00:00.000Z', 'oldest refresh wins');
  assert.deepEqual(
    anz.accounts.map((a) => [a.akahuId, a.mask, a.isNew, a.included, a.isLiability]),
    [
      ['acc_anz1', '6789-00', true, true, false],
      ['acc_anz2', '9876', true, true, true],
    ]
  );
  assert.equal(kiwi.status, 'INACTIVE');
  assert.ok(!JSON.stringify(body).includes('0456789'), 'full account numbers must not leave the server');
});

test('excluded accounts are not imported and choices are remembered', async () => {
  const bad = await call('PATCH', '/akahu/accounts', { changes: [{ akahuId: 'nope', included: false }] });
  assert.equal(bad.status, 400);

  const ok = await call('PATCH', '/akahu/accounts', {
    changes: [
      { akahuId: 'acc_anz1', included: true },
      { akahuId: 'acc_anz2', included: true },
      { akahuId: 'acc_kiwi1', included: false },
    ],
  });
  assert.equal(ok.status, 200);

  const sync = await call('POST', '/akahu/sync', {}).then((r) => r.json());
  assert.equal(sync.mode, 'initial');
  assert.equal(sync.accountsSynced, 2);
  assert.equal(sync.accountsExcluded, 1);
  assert.equal(sync.transactionsImported, 2);

  const accounts = db.prepare('SELECT * FROM accounts ORDER BY akahu_account_id').all();
  assert.deepEqual(
    accounts.map((a) => a.akahu_account_id),
    ['acc_anz1', 'acc_anz2']
  );
  assert.equal(accounts[0].account_mask, '6789-00');
  assert.equal(accounts[0].akahu_logo, 'https://cdn.example/anz.png');
  assert.equal(accounts[0].akahu_status, 'ACTIVE');

  const conns = await call('GET', '/akahu/connections').then((r) => r.json());
  const all = conns.connections.flatMap((c) => c.accounts);
  assert.ok(all.every((a) => !a.isNew));
  assert.equal(all.find((a) => a.akahuId === 'acc_kiwi1').included, false);
  assert.ok(all.find((a) => a.akahuId === 'acc_anz1').localAccountId);
  assert.ok(conns.lastSyncAt);
});

test('later syncs are incremental from the last sync', async () => {
  fake.calls.length = 0;
  const sync = await call('POST', '/akahu/sync', {}).then((r) => r.json());
  assert.equal(sync.mode, 'incremental');
  assert.equal(sync.transactionsImported, 0);
  assert.equal(sync.transactionsUpdated, 2);
  const txCall = fake.calls.find((c) => c.path === '/v1/transactions');
  assert.equal(txCall.start, sync.since);

  assert.deepEqual(syncStartDate({ lastSyncAt: '2026-09-20T05:00:00.000Z' }), {
    start: '2026-09-06',
    mode: 'incremental',
  });
  assert.equal(syncStartDate({ months: 3 }).mode, 'range');

  const badMonths = await call('POST', '/akahu/sync', { months: 99 });
  assert.equal(badMonths.status, 400);
});

test('auto-sync only runs when enabled and the last sync is stale', async () => {
  const skipped = await call('POST', '/akahu/auto-sync').then((r) => r.json());
  assert.equal(skipped.ran, false);
  assert.equal(skipped.reason, 'recent');

  setSetting('akahu_last_sync_at', new Date(Date.now() - AUTO_SYNC_INTERVAL_MS - 1000).toISOString());
  const ran = await call('POST', '/akahu/auto-sync').then((r) => r.json());
  assert.equal(ran.ran, true);
  assert.equal(ran.mode, 'incremental');

  const off = await call('PATCH', '/akahu/settings', { autoSync: false }).then((r) => r.json());
  assert.equal(off.autoSync, false);
  assert.deepEqual(await autoSync({ now: Date.now() + AUTO_SYNC_INTERVAL_MS * 2 }), { ran: false, reason: 'disabled' });
  assert.equal((await call('PATCH', '/akahu/settings', { autoSync: 'yes' })).status, 400);
  await call('PATCH', '/akahu/settings', { autoSync: true });
});

test('refresh asks Akahu to pull fresh bank data', async () => {
  fake.calls.length = 0;
  const res = await call('POST', '/akahu/refresh').then((r) => r.json());
  assert.deepEqual(res, { requested: true });
  assert.deepEqual(fake.calls.map((c) => [c.method, c.path]), [['POST', '/v1/refresh']]);
});

test('disconnecting resets sync history so a new login starts fresh', async () => {
  const cleared = await call('DELETE', '/akahu/credentials').then((r) => r.json());
  assert.equal(cleared.configured, false);
  assert.equal(cleared.lastSyncAt, null);
});
