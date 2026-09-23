import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DATA_DIR, getSeedRules } from '../lib/seedRules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = DATA_DIR;
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Allow tests to point at an isolated database (e.g. ":memory:") instead of the real file.
const dbPath = process.env.BUDGET_DB_PATH || path.join(dataDir, 'budget.sqlite');
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schemaSql);

// Additive migration: older databases created before the "merchant" column
// existed need it backfilled (CREATE TABLE IF NOT EXISTS won't alter an
// already-existing table).
const txColumns = db.prepare("PRAGMA table_info(transactions)").all().map((c) => c.name);
if (!txColumns.includes('merchant')) {
  db.exec('ALTER TABLE transactions ADD COLUMN merchant TEXT');
}

const DEFAULT_CATEGORIES = [
  { name: 'Groceries', icon: '🛒', color: '#22c55e' },
  { name: 'Dining Out', icon: '🍔', color: '#f97316' },
  { name: 'Transport', icon: '🚗', color: '#3b82f6' },
  { name: 'Housing', icon: '🏠', color: '#8b5cf6' },
  { name: 'Utilities', icon: '💡', color: '#eab308' },
  { name: 'Entertainment', icon: '🎬', color: '#ec4899' },
  { name: 'Health', icon: '🩺', color: '#14b8a6' },
  { name: 'Shopping', icon: '🛍️', color: '#f43f5e' },
  { name: 'Subscriptions', icon: '📺', color: '#a855f7' },
  { name: 'Travel', icon: '✈️', color: '#06b6d4' },
  { name: 'Insurance', icon: '🛡️', color: '#0ea5e9' },
  { name: 'Loan Repayment', icon: '🏦', color: '#f59e0b' },
  { name: 'Transfers & Fees', icon: '🔁', color: '#94a3b8' },
  { name: 'Income', icon: '💵', color: '#10b981', is_income: 1 },
  { name: 'Other', icon: '🔖', color: '#64748b' },
];

const insertCategory = db.prepare(
  'INSERT OR IGNORE INTO categories (name, icon, color, is_income) VALUES (@name, @icon, @color, @is_income)'
);
const seedCategories = db.transaction((rows) => {
  for (const row of rows) insertCategory.run({ is_income: 0, ...row });
});
seedCategories(DEFAULT_CATEGORIES);

const insertRule = db.prepare(
  `INSERT OR IGNORE INTO merchant_rules (pattern, match_type, merchant_name, category_id)
   SELECT @pattern, 'contains', @merchant, id FROM categories WHERE name = @category`
);
const isDismissed = db.prepare('SELECT 1 FROM dismissed_seed_rules WHERE pattern = ?');
const seedRules = db.transaction((rows) => {
  for (const row of rows) {
    // Respect rules the user deleted in the UI instead of resurrecting them.
    if (isDismissed.get(row.pattern)) continue;
    insertRule.run(row);
  }
});
seedRules(getSeedRules());
