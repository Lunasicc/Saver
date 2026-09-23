import { Router } from 'express';
import { db } from '../db/index.js';
import { detectRecurringBills } from '../lib/insights.js';

const router = Router();

// Scans transaction history for merchants charging on a regular cadence and
// returns them as candidate bills the user can accept in one click.
router.get('/detect', (req, res) => {
  const months = Number(req.query.months) || 12;
  const minOccurrences = Number(req.query.min_occurrences) || 3;
  if (!Number.isFinite(months) || months < 1 || months > 60) {
    return res.status(400).json({ error: 'months must be between 1 and 60' });
  }
  if (!Number.isFinite(minOccurrences) || minOccurrences < 2) {
    return res.status(400).json({ error: 'min_occurrences must be at least 2' });
  }
  const candidates = detectRecurringBills({ months, minOccurrences });
  res.json({
    months,
    minOccurrences,
    detected: candidates.length,
    candidates,
  });
});

// Bulk-creates recurring bills from accepted detection candidates.
router.post('/detect/apply', (req, res) => {
  const { bills } = req.body || {};
  if (!Array.isArray(bills) || bills.length === 0) {
    return res.status(400).json({ error: 'bills must be a non-empty array' });
  }

  const insert = db.prepare(
    `INSERT INTO recurring_bills (name, amount, category_id, account_id, due_day, frequency)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const findByName = db.prepare('SELECT id FROM recurring_bills WHERE LOWER(TRIM(name)) = ?');

  let created = 0;
  let skipped = 0;
  const apply = db.transaction((items) => {
    for (const bill of items) {
      const name = typeof bill.name === 'string' ? bill.name.trim() : '';
      const amount = Number(bill.amount);
      if (!name || !Number.isFinite(amount) || amount <= 0) {
        skipped += 1;
        continue;
      }
      if (findByName.get(name.toLowerCase())) {
        skipped += 1;
        continue;
      }
      const dueDay = Math.min(28, Math.max(1, Number(bill.due_day) || 1));
      insert.run(
        name,
        amount,
        bill.category_id ?? null,
        bill.account_id ?? null,
        dueDay,
        bill.frequency || 'monthly'
      );
      created += 1;
    }
  });
  apply(bills);

  res.status(201).json({ created, skipped });
});

router.get('/', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT rb.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color, a.name AS account_name
       FROM recurring_bills rb
       LEFT JOIN categories c ON c.id = rb.category_id
       LEFT JOIN accounts a ON a.id = rb.account_id
       ORDER BY rb.due_day ASC`
    )
    .all();
  res.json(rows);
});

const VALID_FREQUENCIES = new Set(['weekly', 'fortnightly', 'monthly', 'yearly']);

function validateBill({ name, amount, due_day, frequency }) {
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    return 'name must be a non-empty string';
  }
  if (amount !== undefined) {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) return 'amount must be a finite number greater than zero';
  }
  if (due_day !== undefined) {
    const day = Number(due_day);
    if (!Number.isInteger(day) || day < 1 || day > 28) return 'due_day must be an integer between 1 and 28';
  }
  if (frequency !== undefined && !VALID_FREQUENCIES.has(frequency)) {
    return `frequency must be one of: ${[...VALID_FREQUENCIES].join(', ')}`;
  }
  return null;
}

router.post('/', (req, res) => {
  const { name, amount, category_id = null, account_id = null, due_day = 1, frequency = 'monthly' } = req.body || {};
  if (!name || amount === undefined) return res.status(400).json({ error: 'name and amount are required' });
  const error = validateBill({ name, amount, due_day, frequency });
  if (error) return res.status(400).json({ error });
  const info = db
    .prepare(
      'INSERT INTO recurring_bills (name, amount, category_id, account_id, due_day, frequency) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(name.trim(), Number(amount), category_id, account_id, Number(due_day), frequency);
  res.status(201).json(db.prepare('SELECT * FROM recurring_bills WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM recurring_bills WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Recurring bill not found' });
  const { name, amount, category_id, account_id, due_day, frequency, active } = req.body || {};
  const error = validateBill({ name, amount, due_day, frequency });
  if (error) return res.status(400).json({ error });
  db.prepare(
    `UPDATE recurring_bills SET name = ?, amount = ?, category_id = ?, account_id = ?, due_day = ?, frequency = ?, active = ?
     WHERE id = ?`
  ).run(
    name !== undefined ? name.trim() : existing.name,
    amount !== undefined ? Number(amount) : existing.amount,
    category_id !== undefined ? category_id : existing.category_id,
    account_id !== undefined ? account_id : existing.account_id,
    due_day !== undefined ? Number(due_day) : existing.due_day,
    frequency ?? existing.frequency,
    active !== undefined ? (active ? 1 : 0) : existing.active,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM recurring_bills WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM recurring_bills WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Recurring bill not found' });
  res.status(204).end();
});

export default router;
