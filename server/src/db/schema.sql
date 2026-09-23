CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'checking', -- checking | savings | credit | loan | investment
  institution TEXT,
  currency TEXT NOT NULL DEFAULT 'NZD',
  starting_balance REAL NOT NULL DEFAULT 0,
  current_balance REAL NOT NULL DEFAULT 0,
  is_liability INTEGER NOT NULL DEFAULT 0,
  akahu_account_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  icon TEXT NOT NULL DEFAULT '💰',
  color TEXT NOT NULL DEFAULT '#6366f1',
  is_income INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL, -- ISO date YYYY-MM-DD
  description TEXT NOT NULL,
  amount REAL NOT NULL, -- negative = spend, positive = income
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  merchant TEXT, -- cleaned-up business/merchant name, used for grouping in reports
  note TEXT,
  source TEXT NOT NULL DEFAULT 'manual', -- manual | csv | akahu
  external_id TEXT, -- dedupe key for csv/akahu imports
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);

-- Auto-categorization rules. 'exact' rules match a fully-normalized description
-- (learned automatically whenever a user manually categorizes a transaction —
-- most bank descriptions repeat verbatim for the same recurring merchant).
-- 'contains' rules are seeded defaults for well-known NZ merchants and match
-- as a substring of the normalized description.
CREATE TABLE IF NOT EXISTS merchant_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL UNIQUE, -- normalized: lowercase, non-alphanumeric stripped
  match_type TEXT NOT NULL DEFAULT 'contains', -- 'exact' | 'contains'
  merchant_name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  month TEXT NOT NULL, -- YYYY-MM
  amount REAL NOT NULL,
  UNIQUE(category_id, month)
);

CREATE TABLE IF NOT EXISTS recurring_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  amount REAL NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  due_day INTEGER NOT NULL DEFAULT 1, -- day of month 1-28
  frequency TEXT NOT NULL DEFAULT 'monthly', -- monthly | weekly | fortnightly | yearly
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS net_worth_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE, -- YYYY-MM-DD
  total_assets REAL NOT NULL,
  total_liabilities REAL NOT NULL,
  net_worth REAL NOT NULL
);

-- Seeded merchant rules the user has deliberately deleted. Without this the
-- startup seeder would simply re-insert them on the next restart, making
-- deletions in the Auto-categorize Rules page appear to undo themselves.
CREATE TABLE IF NOT EXISTS dismissed_seed_rules (
  pattern TEXT PRIMARY KEY,
  dismissed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Small key/value store for app settings entered in the UI (e.g. Akahu tokens).
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every Akahu account the user has seen in the connections hub, and whether
-- they want it synced. Lets us spot newly connected accounts and remember
-- exclusions for accounts that were never imported.
CREATE TABLE IF NOT EXISTS akahu_seen_accounts (
  akahu_account_id TEXT PRIMARY KEY,
  included INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);
