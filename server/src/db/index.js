import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DATA_DIR, getSeedRules } from '../lib/seedRules.js';
import { normalizeForMatch } from '../lib/categorize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = DATA_DIR;
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Allow tests to point at an isolated database (e.g. ":memory:") instead of the real file.
const dbPath = process.env.BUDGET_DB_PATH || path.join(dataDir, 'budget.sqlite');
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
const hadSeenAccounts = Boolean(
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'akahu_seen_accounts'").get()
);
db.exec(schemaSql);

// Additive migration: older databases created before the "merchant" column
// existed need it backfilled (CREATE TABLE IF NOT EXISTS won't alter an
// already-existing table).
const txColumns = db.prepare("PRAGMA table_info(transactions)").all().map((c) => c.name);
if (!txColumns.includes('merchant')) {
  db.exec('ALTER TABLE transactions ADD COLUMN merchant TEXT');
}

// Bank connection details shown in the connections hub.
const accountColumns = new Set(db.prepare('PRAGMA table_info(accounts)').all().map((c) => c.name));
for (const column of ['akahu_connection_id', 'akahu_logo', 'akahu_status', 'akahu_refreshed_at', 'account_mask']) {
  if (!accountColumns.has(column)) db.exec(`ALTER TABLE accounts ADD COLUMN ${column} TEXT`);
}

// Accounts connected after the first import used to get only recent history.
// Existing rows start un-backfilled so the next sync fills in their history once.
const seenColumns = db.prepare('PRAGMA table_info(akahu_seen_accounts)').all().map((c) => c.name);
if (!seenColumns.includes('backfilled')) {
  db.exec('ALTER TABLE akahu_seen_accounts ADD COLUMN backfilled INTEGER NOT NULL DEFAULT 0');
}

// Databases that synced with Akahu before the connections hub existed: keep their
// bank accounts included and treat them as already synced, so upgrading skips the
// first-import wizard. Runs once, when the hub's table is first created.
if (!hadSeenAccounts) db.exec(`
  INSERT OR IGNORE INTO akahu_seen_accounts (akahu_account_id, included)
    SELECT akahu_account_id, 1 FROM accounts WHERE akahu_account_id IS NOT NULL;
  INSERT OR IGNORE INTO settings (key, value)
    SELECT 'akahu_last_sync_at', strftime('%Y-%m-%dT%H:%M:%SZ', COALESCE(
      (SELECT MAX(t.created_at) FROM transactions t JOIN accounts a ON a.id = t.account_id
        WHERE a.akahu_account_id IS NOT NULL AND t.source = 'akahu'),
      (SELECT MAX(created_at) FROM accounts WHERE akahu_account_id IS NOT NULL)))
    WHERE EXISTS (SELECT 1 FROM accounts WHERE akahu_account_id IS NOT NULL);
`);

// Categories: users can add their own and nest one level of sub-categories.
// `seed_key` remembers which built-in a row started as, so renaming a built-in
// doesn't make it reappear, and deleting one keeps it deleted.
const categoryColumns = new Set(db.prepare('PRAGMA table_info(categories)').all().map((c) => c.name));
if (!categoryColumns.has('parent_id')) db.exec('ALTER TABLE categories ADD COLUMN parent_id INTEGER REFERENCES categories(id)');
if (!categoryColumns.has('is_fixed')) db.exec('ALTER TABLE categories ADD COLUMN is_fixed INTEGER NOT NULL DEFAULT 0');
if (!categoryColumns.has('seed_key')) db.exec('ALTER TABLE categories ADD COLUMN seed_key TEXT');
db.exec('CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id)');

/** Built-in categories. `fixed` ones are bills and commitments rather than everyday spending. */
export const DEFAULT_CATEGORIES = [
  { name: 'Groceries', icon: 'cart', color: '#22c55e' },
  { name: 'Dining Out', icon: 'fork-knife', color: '#f97316' },
  { name: 'Transport', icon: 'car', color: '#3b82f6' },
  { name: 'Housing', icon: 'house', color: '#8b5cf6', fixed: true },
  { name: 'Utilities', icon: 'lightning', color: '#eab308', fixed: true },
  { name: 'Entertainment', icon: 'film', color: '#ec4899' },
  { name: 'Health', icon: 'heartbeat', color: '#14b8a6' },
  { name: 'Shopping', icon: 'bag', color: '#f43f5e' },
  { name: 'Subscriptions', icon: 'repeat', color: '#a855f7', fixed: true },
  { name: 'Travel', icon: 'airplane', color: '#06b6d4' },
  { name: 'Insurance', icon: 'shield', color: '#0ea5e9', fixed: true },
  { name: 'Loan Repayment', icon: 'bank', color: '#f59e0b', fixed: true },
  { name: 'Investments & Finances', icon: 'chart-up', color: '#6366f1', fixed: true },
  { name: 'Transfers & Fees', icon: 'arrows', color: '#94a3b8', fixed: true },
  { name: 'Income', icon: 'coins', color: '#10b981', is_income: 1 },
  { name: 'Other', icon: 'dots', color: '#64748b' },
];

// Icons used to be emoji; switch untouched built-ins over to the icon keys the app draws.
const LEGACY_EMOJI = {
  Groceries: '🛒', 'Dining Out': '🍔', Transport: '🚗', Housing: '🏠', Utilities: '💡', Entertainment: '🎬',
  Health: '🩺', Shopping: '🛍️', Subscriptions: '📺', Travel: '✈️', Insurance: '🛡️', 'Loan Repayment': '🏦',
  'Investments & Finances': '📈', 'Transfers & Fees': '🔁', Income: '💵', Other: '🔖',
};

db.transaction(() => {
  if (!categoryColumns.has('seed_key')) {
    const adopt = db.prepare('UPDATE categories SET seed_key = name WHERE name = ? AND seed_key IS NULL');
    for (const c of DEFAULT_CATEGORIES) adopt.run(c.name);
  }
  if (!categoryColumns.has('is_fixed')) {
    const markFixed = db.prepare('UPDATE categories SET is_fixed = 1 WHERE seed_key = ?');
    for (const c of DEFAULT_CATEGORIES) if (c.fixed) markFixed.run(c.name);
  }
  const iconUpdate = db.prepare('UPDATE categories SET icon = ? WHERE seed_key = ? AND icon = ?');
  for (const c of DEFAULT_CATEGORIES) iconUpdate.run(c.icon, c.name, LEGACY_EMOJI[c.name]);

  const hasSeed = db.prepare('SELECT 1 FROM categories WHERE seed_key = ?');
  const isCategoryDismissed = db.prepare('SELECT 1 FROM dismissed_seed_categories WHERE seed_key = ?');
  const insertCategory = db.prepare(
    `INSERT OR IGNORE INTO categories (name, icon, color, is_income, is_fixed, seed_key)
     VALUES (@name, @icon, @color, @is_income, @is_fixed, @name)`
  );
  const adoptByName = db.prepare('UPDATE categories SET seed_key = ? WHERE name = ? AND seed_key IS NULL');
  for (const c of DEFAULT_CATEGORIES) {
    if (hasSeed.get(c.name) || isCategoryDismissed.get(c.name)) continue;
    const info = insertCategory.run({ name: c.name, icon: c.icon, color: c.color, is_income: c.is_income ?? 0, is_fixed: c.fixed ? 1 : 0 });
    if (!info.changes) adoptByName.run(c.name, c.name);
  }
})();

// Seed rules name a built-in category; custom rules may name one of the user's own.
const insertRule = db.prepare(
  `INSERT OR IGNORE INTO merchant_rules (pattern, match_type, merchant_name, category_id)
   SELECT @pattern, 'contains', @merchant, id FROM categories
   WHERE seed_key = @category OR name = @category
   ORDER BY (seed_key = @category) DESC LIMIT 1`
);
const isDismissed = db.prepare('SELECT 1 FROM dismissed_seed_rules WHERE pattern = ?');

/** Inserts seed rules that don't exist yet. Deleted ones stay deleted unless `includeDismissed`. */
export const seedMerchantRules = db.transaction((rows, { includeDismissed = false } = {}) => {
  for (const row of rows) {
    if (!includeDismissed && isDismissed.get(row.pattern)) continue;
    insertRule.run({ pattern: row.pattern, merchant: row.merchant, category: row.category });
  }
});
seedMerchantRules(getSeedRules());

// Investments & Finances arrived after people had already filed things like
// Sharesies top-ups under "Other" (or left them uncategorized). Move those over
// once; anything the user files under Other afterwards is left alone.
if (!db.prepare("SELECT 1 FROM settings WHERE key = 'seeded_investments'").get()) {
  const investments = db.prepare("SELECT id FROM categories WHERE name = 'Investments & Finances'").get();
  const other = db.prepare("SELECT id FROM categories WHERE name = 'Other'").get();
  const patterns = getSeedRules().filter((r) => r.category === 'Investments & Finances');
  const matchOf = (text) => {
    const norm = normalizeForMatch(text);
    return patterns.find((p) => norm.includes(p.pattern));
  };
  db.transaction(() => {
    if (investments) {
      const moveTx = db.prepare('UPDATE transactions SET category_id = ?, merchant = ? WHERE id = ?');
      const candidates = db
        .prepare('SELECT id, description FROM transactions WHERE category_id IS NULL OR category_id = ?')
        .all(other?.id ?? -1);
      for (const tx of candidates) {
        const match = matchOf(tx.description);
        if (match) moveTx.run(investments.id, match.merchant, tx.id);
      }
      const moveRule = db.prepare('UPDATE merchant_rules SET category_id = ? WHERE id = ?');
      const learned = db
        .prepare("SELECT id, pattern FROM merchant_rules WHERE match_type = 'exact' AND category_id = ?")
        .all(other?.id ?? -1);
      for (const rule of learned) {
        if (matchOf(rule.pattern)) moveRule.run(investments.id, rule.id);
      }
    }
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('seeded_investments', '1')").run();
  })();
}
