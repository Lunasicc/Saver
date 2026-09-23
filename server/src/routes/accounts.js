import { Router } from 'express';
import { db } from '../db/index.js';
import { recalcAccountBalance } from '../db/helpers.js';

const router = Router();

const ACCOUNT_TYPES = new Set(['checking', 'savings', 'credit', 'loan', 'investment', 'cash', 'other']);

function validateAccountFields({ name, type, starting_balance, currency }) {
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    return 'name must be a non-empty string';
  }
  if (type !== undefined && !ACCOUNT_TYPES.has(type)) {
    return `type must be one of: ${[...ACCOUNT_TYPES].join(', ')}`;
  }
  if (starting_balance !== undefined && !Number.isFinite(Number(starting_balance))) {
    return 'starting_balance must be a finite number';
  }
  if (currency !== undefined && !/^[A-Z]{3}$/.test(String(currency))) {
    return 'currency must be a 3-letter code (e.g. NZD)';
  }
  return null;
}

router.get('/', (_req, res) => {
  const accounts = db.prepare('SELECT * FROM accounts ORDER BY created_at ASC').all();
  res.json(accounts);
});

router.post('/', (req, res) => {
  const { name, type = 'checking', institution = null, currency = 'NZD', starting_balance = 0, is_liability = 0 } =
    req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const error = validateAccountFields({ name, type, starting_balance, currency });
  if (error) return res.status(400).json({ error });
  const balance = Number(starting_balance);
  const info = db
    .prepare(
      'INSERT INTO accounts (name, type, institution, currency, starting_balance, current_balance, is_liability) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(name.trim(), type, institution, currency, balance, balance, is_liability ? 1 : 0);
  res.status(201).json(db.prepare('SELECT * FROM accounts WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Account not found' });
  const { name, type, institution, currency, starting_balance, is_liability } = req.body || {};
  const error = validateAccountFields({ name, type, starting_balance, currency });
  if (error) return res.status(400).json({ error });
  db.prepare(
    'UPDATE accounts SET name = ?, type = ?, institution = ?, currency = ?, starting_balance = ?, is_liability = ? WHERE id = ?'
  ).run(
    name !== undefined ? name.trim() : existing.name,
    type ?? existing.type,
    institution !== undefined ? institution : existing.institution,
    currency ?? existing.currency,
    starting_balance !== undefined ? Number(starting_balance) : existing.starting_balance,
    is_liability !== undefined ? (is_liability ? 1 : 0) : existing.is_liability,
    id
  );
  recalcAccountBalance(id);
  res.json(db.prepare('SELECT * FROM accounts WHERE id = ?').get(id));
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Account not found' });

  // Deleting an account cascades to every transaction on it. For an account holding
  // real synced bank history that is unrecoverable, so it requires explicit confirmation.
  const { n: transactionCount } = db
    .prepare('SELECT COUNT(*) AS n FROM transactions WHERE account_id = ?')
    .get(req.params.id);
  const confirmed = req.query.confirm === 'true';
  if (transactionCount > 0 && !confirmed) {
    return res.status(409).json({
      error: `"${existing.name}" has ${transactionCount} transactions that would be permanently deleted. Re-send with ?confirm=true to proceed.`,
      transactionCount,
      requiresConfirmation: true,
    });
  }

  db.prepare('DELETE FROM accounts WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

export default router;
