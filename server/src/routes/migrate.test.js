// Opens a database created by an older version of Saver and checks the
// additive migrations bring it up to date without losing data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import test from 'node:test';
import assert from 'node:assert/strict';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saver-migrate-'));
const dbFile = path.join(dir, 'old.sqlite');
const old = new Database(dbFile);
old.exec(`
  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'checking',
    institution TEXT,
    currency TEXT NOT NULL DEFAULT 'NZD',
    starting_balance REAL NOT NULL DEFAULT 0,
    current_balance REAL NOT NULL DEFAULT 0,
    is_liability INTEGER NOT NULL DEFAULT 0,
    akahu_account_id TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO accounts (name, akahu_account_id, current_balance) VALUES ('Everyday', 'acc_old', 42);
  CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    category_id INTEGER,
    note TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    external_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(account_id, external_id)
  );
  INSERT INTO transactions (account_id, date, description, amount, source, external_id, created_at)
    VALUES (1, '2025-03-01', 'Coffee', -5, 'akahu', 'trans_1', '2025-03-02 08:30:00');
  CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    icon TEXT NOT NULL DEFAULT '💰',
    color TEXT NOT NULL DEFAULT '#6366f1',
    is_income INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO categories (id, name) VALUES (1, 'Other'), (2, 'Transfers & Fees');
  INSERT INTO transactions (account_id, date, description, amount, category_id, external_id) VALUES
    (1, '2025-03-03', 'TFR TO Sharesies Nom SA1', -100, 1, 'inv_other'),
    (1, '2025-03-04', 'KIWISAVER CONTRIBUTION', -50, NULL, 'inv_uncat'),
    (1, '2025-03-05', 'TFR TO Sharesies Nom SA1', -100, 2, 'inv_kept'),
    (1, '2025-03-06', 'Random shop', -20, 1, 'other_kept');
  CREATE TABLE merchant_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern TEXT NOT NULL UNIQUE,
    match_type TEXT NOT NULL DEFAULT 'contains',
    merchant_name TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO merchant_rules (pattern, match_type, merchant_name, category_id)
    VALUES ('tfrtosharesiesnomsa1', 'exact', 'TFR TO Sharesies', 1);
`);
old.close();

process.env.BUDGET_DB_PATH = dbFile;
process.env.NODE_ENV = 'test';
const { db } = await import('../db/index.js');

test.after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('old databases gain the connection columns and keep their rows', () => {
  const columns = db.prepare('PRAGMA table_info(accounts)').all().map((c) => c.name);
  for (const c of ['akahu_connection_id', 'akahu_logo', 'akahu_status', 'akahu_refreshed_at', 'account_mask']) {
    assert.ok(columns.includes(c), `missing ${c}`);
  }
  const row = db.prepare('SELECT name, current_balance FROM accounts WHERE akahu_account_id = ?').get('acc_old');
  assert.deepEqual(row, { name: 'Everyday', current_balance: 42 });
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'akahu_seen_accounts'").get());
  const seenColumns = db.prepare('PRAGMA table_info(akahu_seen_accounts)').all().map((c) => c.name);
  assert.ok(seenColumns.includes('backfilled'));
});

test('accounts synced before the hub existed count as seen and already synced', () => {
  assert.deepEqual(db.prepare('SELECT akahu_account_id, included FROM akahu_seen_accounts').all(), [
    { akahu_account_id: 'acc_old', included: 1 },
  ]);
  const lastSync = db.prepare("SELECT value FROM settings WHERE key = 'akahu_last_sync_at'").get();
  assert.equal(lastSync?.value, '2025-03-02T08:30:00Z');
});

test('investment transactions filed under Other or uncategorized move to Investments & Finances', () => {
  const investments = db.prepare("SELECT id FROM categories WHERE name = 'Investments & Finances'").get();
  assert.ok(investments, 'category seeded');
  const categoryOf = (externalId) =>
    db.prepare('SELECT category_id AS c, merchant AS m FROM transactions WHERE external_id = ?').get(externalId);
  assert.deepEqual(categoryOf('inv_other'), { c: investments.id, m: 'Sharesies' });
  assert.deepEqual(categoryOf('inv_uncat'), { c: investments.id, m: 'KiwiSaver' });
  assert.equal(categoryOf('inv_kept').c, 2, 'deliberate choices elsewhere are kept');
  assert.equal(categoryOf('other_kept').c, 1);
  const learned = db.prepare("SELECT category_id FROM merchant_rules WHERE pattern = 'tfrtosharesiesnomsa1'").get();
  assert.equal(learned.category_id, investments.id);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'seeded_investments'").get()?.value, '1');
});
