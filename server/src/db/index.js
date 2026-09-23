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
  { name: 'Investments & Finances', icon: '📈', color: '#6366f1' },
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
