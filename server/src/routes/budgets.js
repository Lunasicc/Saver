import { Router } from 'express';
import { db } from '../db/index.js';
import { suggestBudgets } from '../lib/insights.js';
import { isValidMonth } from '../lib/dates.js';

const router = Router();

// Suggests a monthly budget per category from the user's actual recent spending.
router.get('/suggestions', (req, res) => {
  const { month } = req.query;
  if (month && !isValidMonth(month)) {
    return res.status(400).json({ error: 'month must be in YYYY-MM format' });
  }
  const lookback = req.query.lookback === undefined ? 3 : Number(req.query.lookback);
  if (!Number.isFinite(lookback) || lookback < 1 || lookback > 24) {
    return res.status(400).json({ error: 'lookback must be between 1 and 24' });
  }
  res.json(suggestBudgets({ month, lookback }));
});

// Bulk-applies accepted budget suggestions for a month.
router.post('/suggestions/apply', (req, res) => {
  const { month, budgets } = req.body || {};
  if (!month || !isValidMonth(month)) {
    return res.status(400).json({ error: 'month must be in YYYY-MM format' });
  }
  if (!Array.isArray(budgets) || budgets.length === 0) {
    return res.status(400).json({ error: 'budgets must be a non-empty array' });
  }

  const upsert = db.prepare(
    `INSERT INTO budgets (category_id, month, amount) VALUES (?, ?, ?)
     ON CONFLICT(category_id, month) DO UPDATE SET amount = excluded.amount`
  );

  let applied = 0;
  let skipped = 0;
  const run = db.transaction((items) => {
    for (const item of items) {
      const categoryId = Number(item.category_id);
      const amount = Number(item.amount);
      if (!Number.isInteger(categoryId) || !Number.isFinite(amount) || amount <= 0) {
        skipped += 1;
        continue;
      }
      upsert.run(categoryId, month, amount);
      applied += 1;
    }
  });
  run(budgets);

  res.status(201).json({ month, applied, skipped });
});

// List budgets for a given month (YYYY-MM), joined with category and actual spend.
router.get('/', (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: 'month (YYYY-MM) query param is required' });
  if (!isValidMonth(month)) return res.status(400).json({ error: 'month must be in YYYY-MM format' });

  const budgets = db
    .prepare(
      `SELECT b.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
       FROM budgets b JOIN categories c ON c.id = b.category_id
       WHERE b.month = ?
       ORDER BY c.name ASC`
    )
    .all(month);

  const spendRows = db
    .prepare(
      `SELECT category_id, COALESCE(SUM(-amount), 0) AS spent
       FROM transactions
       WHERE strftime('%Y-%m', date) = ? AND amount < 0
       GROUP BY category_id`
    )
    .all(month);
  // Round to cents: amounts are stored as REAL, so a summed total can land a
  // fraction of a cent above the budget and falsely report "over budget".
  const spendByCategory = Object.fromEntries(
    spendRows.map((r) => [r.category_id, Math.round(r.spent * 100) / 100])
  );

  res.json(
    budgets.map((b) => ({
      ...b,
      spent: spendByCategory[b.category_id] || 0,
    }))
  );
});

router.post('/', (req, res) => {
  const { category_id, month, amount } = req.body || {};
  if (!category_id || !month || amount === undefined) {
    return res.status(400).json({ error: 'category_id, month and amount are required' });
  }
  if (!isValidMonth(month)) {
    return res.status(400).json({ error: 'month must be in YYYY-MM format' });
  }
  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ error: 'Budget amount must be a finite number greater than zero' });
  }
  if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(category_id)) {
    return res.status(400).json({ error: 'category_id does not match an existing category' });
  }
  const info = db
    .prepare(
      `INSERT INTO budgets (category_id, month, amount) VALUES (?, ?, ?)
       ON CONFLICT(category_id, month) DO UPDATE SET amount = excluded.amount`
    )
    .run(category_id, month, parsedAmount);
  const row = db
    .prepare('SELECT * FROM budgets WHERE category_id = ? AND month = ?')
    .get(category_id, month);
  res.status(info.changes ? 201 : 200).json(row);
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM budgets WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Budget not found' });
  res.status(204).end();
});

export default router;
