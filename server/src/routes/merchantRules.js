import { Router } from 'express';
import { db } from '../db/index.js';
import { getSeedRules } from '../lib/seedRules.js';

const router = Router();

// Lists merchant rules (both seeded "contains" defaults and "exact" rules
// learned from user corrections), newest-learned first.
router.get('/', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT r.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
       FROM merchant_rules r JOIN categories c ON c.id = r.category_id
       ORDER BY r.match_type ASC, r.created_at DESC`
    )
    .all();
  res.json(rows);
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM merchant_rules WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Rule not found' });
  const { merchant_name, category_id } = req.body || {};
  if (merchant_name !== undefined && (typeof merchant_name !== 'string' || !merchant_name.trim())) {
    return res.status(400).json({ error: 'merchant_name must be a non-empty string' });
  }
  if (category_id !== undefined && !db.prepare('SELECT 1 FROM categories WHERE id = ?').get(category_id)) {
    return res.status(400).json({ error: 'category_id does not match an existing category' });
  }
  db.prepare('UPDATE merchant_rules SET merchant_name = ?, category_id = ? WHERE id = ?').run(
    merchant_name !== undefined ? merchant_name.trim() : existing.merchant_name,
    category_id ?? existing.category_id,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM merchant_rules WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM merchant_rules WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Rule not found' });
  const remove = db.transaction(() => {
    db.prepare('DELETE FROM merchant_rules WHERE id = ?').run(req.params.id);
    // Remember deletions of seeded rules so startup seeding doesn't bring them back.
    if (getSeedRules().some((r) => r.pattern === existing.pattern)) {
      db.prepare('INSERT OR IGNORE INTO dismissed_seed_rules (pattern) VALUES (?)').run(existing.pattern);
    }
  });
  remove();
  res.status(204).end();
});

// Restores a previously deleted default rule.
router.post('/restore-defaults', (_req, res) => {
  const restored = db.prepare('SELECT COUNT(*) AS n FROM dismissed_seed_rules').get().n;
  db.prepare('DELETE FROM dismissed_seed_rules').run();
  const insertRule = db.prepare(
    `INSERT OR IGNORE INTO merchant_rules (pattern, match_type, merchant_name, category_id)
     SELECT @pattern, 'contains', @merchant, id FROM categories WHERE name = @category`
  );
  const seed = db.transaction((rows) => {
    for (const row of rows) insertRule.run(row);
  });
  seed(getSeedRules());
  res.json({ restored });
});

export default router;
