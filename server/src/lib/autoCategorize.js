import { db } from '../db/index.js';
import { findRuleMatch, normalizeForMatch, deriveMerchantName } from './categorize.js';

function loadRules() {
  return db.prepare('SELECT * FROM merchant_rules').all();
}

// Applies auto-categorization to a single transaction row (plain object with
// id/description). Returns the matched rule, or null if nothing matched.
// Only overwrites category/merchant when they are currently unset, unless
// `force` is true.
export function autoCategorizeTransaction(tx, { force = false } = {}) {
  if (!force && tx.category_id) return null;
  const rules = loadRules();
  const match = findRuleMatch(rules, tx.description);
  if (!match) return null;
  db.prepare('UPDATE transactions SET category_id = ?, merchant = ? WHERE id = ?').run(
    match.category_id,
    match.merchant_name,
    tx.id
  );
  return match;
}

// Re-scans transactions (by default only uncategorized ones) and applies
// matching rules. Returns how many were updated.
export function bulkAutoCategorize({ onlyUncategorized = true } = {}) {
  const rules = loadRules();
  const rows = db
    .prepare(`SELECT id, description FROM transactions ${onlyUncategorized ? 'WHERE category_id IS NULL' : ''}`)
    .all();
  const update = db.prepare('UPDATE transactions SET category_id = ?, merchant = ? WHERE id = ?');
  let updated = 0;
  const tx = db.transaction((transactions) => {
    for (const row of transactions) {
      const match = findRuleMatch(rules, row.description);
      if (match) {
        update.run(match.category_id, match.merchant_name, row.id);
        updated++;
      }
    }
  });
  tx(rows);
  return { scanned: rows.length, updated };
}

// Called whenever a user manually sets a transaction's category. Remembers an
// exact-match rule keyed on the normalized description so future imports of
// the same recurring transaction are categorized automatically.
export function learnFromCorrection(description, categoryId) {
  if (!categoryId) return;
  const pattern = normalizeForMatch(description);
  if (!pattern) return;
  db.prepare(
    `INSERT INTO merchant_rules (pattern, match_type, merchant_name, category_id)
     VALUES (?, 'exact', ?, ?)
     ON CONFLICT(pattern) DO UPDATE SET category_id = excluded.category_id, merchant_name = excluded.merchant_name`
  ).run(pattern, deriveMerchantName(description), categoryId);
}
