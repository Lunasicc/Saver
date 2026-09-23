import { Router } from 'express';
import crypto from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { db } from '../db/index.js';
import { recalcAccountBalance } from '../db/helpers.js';
import { autoCategorizeTransaction, bulkAutoCategorize, learnFromCorrection } from '../lib/autoCategorize.js';
import { normalizeForMatch } from '../lib/categorize.js';
import { isValidDate } from '../lib/dates.js';

const router = Router();

/** Amounts are compared and hashed in integer cents to avoid float drift. */
function toCents(amount) {
  return Math.round(Number(amount) * 100);
}

// Canonicalises the row before hashing so that trivially different CSV exports of the
// same transaction (-42.5 vs -42.50, extra whitespace, different casing) collapse to
// the same fingerprint instead of importing twice.
function hashRow(accountId, date, description, amount) {
  const canonical = `${Number(accountId)}|${date}|${normalizeForMatch(description)}|${toCents(amount)}`;
  return crypto.createHash('sha1').update(canonical).digest('hex');
}

// Guards against importing a CSV row that already arrived via Akahu (or vice versa),
// where the external_id differs but the transaction is plainly the same.
const findEquivalent = db.prepare(
  `SELECT id FROM transactions
   WHERE account_id = ? AND date = ? AND CAST(ROUND(amount * 100) AS INTEGER) = ?
   LIMIT 1`
);

function isDuplicateOfExisting(accountId, date, description, amount) {
  const match = findEquivalent.get(Number(accountId), date, toCents(amount));
  if (!match) return false;
  const row = db.prepare('SELECT description FROM transactions WHERE id = ?').get(match.id);
  return normalizeForMatch(row.description) === normalizeForMatch(description);
}

/** Validates a transaction amount, returning a number or null when unusable. */
function parseAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function accountExists(id) {
  return Boolean(db.prepare('SELECT 1 FROM accounts WHERE id = ?').get(id));
}

function categoryExists(id) {
  return Boolean(db.prepare('SELECT 1 FROM categories WHERE id = ?').get(id));
}

router.get('/', (req, res) => {
  const { account_id, category_id, from, to, q, limit = 500 } = req.query;
  const clauses = [];
  const params = {};
  if (account_id) {
    clauses.push('account_id = @account_id');
    params.account_id = account_id;
  }
  if (category_id) {
    if (category_id === 'uncategorized') {
      clauses.push('category_id IS NULL');
    } else {
      clauses.push('category_id = @category_id');
      params.category_id = category_id;
    }
  }
  if (from) {
    clauses.push('date >= @from');
    params.from = from;
  }
  if (to) {
    clauses.push('date <= @to');
    params.to = to;
  }
  if (q) {
    clauses.push('(description LIKE @q OR merchant LIKE @q)');
    params.q = `%${q}%`;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const parsedLimit = Number(limit);
  const safeLimit = Number.isFinite(parsedLimit) ? Math.min(5000, Math.max(1, Math.trunc(parsedLimit))) : 500;
  const rows = db
    .prepare(`SELECT * FROM transactions ${where} ORDER BY date DESC, id DESC LIMIT @limit`)
    .all({ ...params, limit: safeLimit });
  res.json(rows);
});

router.post('/', (req, res) => {
  const { account_id, date, description, amount, category_id = null, note = null } = req.body || {};
  if (!account_id || !date || !description || amount === undefined) {
    return res.status(400).json({ error: 'account_id, date, description and amount are required' });
  }
  if (!isValidDate(date)) {
    return res.status(400).json({ error: 'date must be a valid calendar date in YYYY-MM-DD format' });
  }
  const parsedAmount = parseAmount(amount);
  if (parsedAmount === null) {
    return res.status(400).json({ error: 'amount must be a finite number' });
  }
  if (typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({ error: 'description must be a non-empty string' });
  }
  if (!accountExists(account_id)) {
    return res.status(400).json({ error: 'account_id does not match an existing account' });
  }
  if (category_id !== null && category_id !== undefined && !categoryExists(category_id)) {
    return res.status(400).json({ error: 'category_id does not match an existing category' });
  }
  const info = db
    .prepare(
      'INSERT INTO transactions (account_id, date, description, amount, category_id, note, source) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(account_id, date, description.trim(), parsedAmount, category_id, note, 'manual');
  recalcAccountBalance(account_id);
  const created = db.prepare('SELECT * FROM transactions WHERE id = ?').get(info.lastInsertRowid);
  if (category_id) {
    learnFromCorrection(description, category_id);
  } else {
    autoCategorizeTransaction(created);
  }
  res.status(201).json(db.prepare('SELECT * FROM transactions WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Transaction not found' });
  const { date, description, amount, category_id, note } = req.body || {};
  if (date !== undefined && !isValidDate(date)) {
    return res.status(400).json({ error: 'date must be a valid calendar date in YYYY-MM-DD format' });
  }
  if (amount !== undefined && parseAmount(amount) === null) {
    return res.status(400).json({ error: 'amount must be a finite number' });
  }
  if (description !== undefined && (typeof description !== 'string' || !description.trim())) {
    return res.status(400).json({ error: 'description must be a non-empty string' });
  }
  if (category_id !== undefined && category_id !== null && !categoryExists(category_id)) {
    return res.status(400).json({ error: 'category_id does not match an existing category' });
  }
  db.prepare(
    'UPDATE transactions SET date = ?, description = ?, amount = ?, category_id = ?, note = ? WHERE id = ?'
  ).run(
    date ?? existing.date,
    description !== undefined ? description.trim() : existing.description,
    amount !== undefined ? parseAmount(amount) : existing.amount,
    category_id !== undefined ? category_id : existing.category_id,
    note !== undefined ? note : existing.note,
    req.params.id
  );
  recalcAccountBalance(existing.account_id);
  // Learn a rule whenever the user sets/changes the category, so future
  // transactions from the same recurring merchant auto-categorize.
  if (category_id !== undefined && category_id && category_id !== existing.category_id) {
    learnFromCorrection(description ?? existing.description, category_id);
  }
  res.json(db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Transaction not found' });
  db.prepare('DELETE FROM transactions WHERE id = ?').run(req.params.id);
  recalcAccountBalance(existing.account_id);
  res.status(204).end();
});

// Step 1: parse a raw CSV string into headers + preview rows for column mapping in the UI.
router.post('/parse-csv', (req, res) => {
  const { csvText } = req.body;
  if (!csvText || !csvText.trim()) return res.status(400).json({ error: 'csvText is required' });
  let records;
  try {
    records = parse(csvText, { columns: false, skip_empty_lines: true, trim: true });
  } catch (err) {
    return res.status(400).json({ error: `Could not parse CSV: ${err.message}` });
  }
  if (records.length === 0) return res.status(400).json({ error: 'CSV file is empty' });
  const [headers, ...rows] = records;
  res.json({ headers, rows, rowCount: rows.length });
});

// Step 2: import mapped rows for a given account, deduping against existing imports.
router.post('/import', (req, res) => {
  const { account_id, transactions } = req.body || {};
  if (!account_id || !Array.isArray(transactions)) {
    return res.status(400).json({ error: 'account_id and transactions[] are required' });
  }
  if (!accountExists(account_id)) {
    return res.status(400).json({ error: 'account_id does not match an existing account' });
  }
  const insert = db.prepare(
    'INSERT OR IGNORE INTO transactions (account_id, date, description, amount, source, external_id) VALUES (?, ?, ?, ?, ?, ?)'
  );
  let imported = 0;
  let skipped = 0;
  let duplicates = 0;
  let invalid = 0;
  const tx = db.transaction((rows) => {
    for (const row of rows) {
      const { date, description } = row;
      const amount = parseAmount(row.amount);
      if (!isValidDate(date) || typeof description !== 'string' || !description.trim() || amount === null) {
        invalid++;
        skipped++;
        continue;
      }
      // Catches the same transaction already present from another source (e.g. Akahu),
      // which the external_id hash alone would miss.
      if (isDuplicateOfExisting(account_id, date, description, amount)) {
        duplicates++;
        skipped++;
        continue;
      }
      const externalId = hashRow(account_id, date, description, amount);
      const info = insert.run(account_id, date, description.trim(), amount, 'csv', externalId);
      if (info.changes > 0) imported++;
      else {
        duplicates++;
        skipped++;
      }
    }
  });
  tx(transactions);
  recalcAccountBalance(account_id);
  const result = bulkAutoCategorize({ onlyUncategorized: true });
  res.json({ imported, skipped, duplicates, invalid, total: transactions.length, categorized: result.updated });
});

// Retroactively categorizes any uncategorized transactions using merchant rules.
router.post('/auto-categorize', (req, res) => {
  const result = bulkAutoCategorize({ onlyUncategorized: true });
  res.json(result);
});

export default router;
