import { Router } from 'express';
import { db } from '../db/index.js';

const router = Router();

router.get('/', (_req, res) => {
  res.json(db.prepare('SELECT * FROM categories ORDER BY is_income DESC, name ASC').all());
});

router.post('/', (req, res) => {
  const { name, icon = '💰', color = '#6366f1', is_income = 0 } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const info = db
      .prepare('INSERT INTO categories (name, icon, color, is_income) VALUES (?, ?, ?, ?)')
      .run(name, icon, color, is_income ? 1 : 0);
    res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'A category with that name already exists' });
    }
    throw err;
  }
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Category not found' });
  const { name, icon, color, is_income } = req.body;
  db.prepare('UPDATE categories SET name = ?, icon = ?, color = ?, is_income = ? WHERE id = ?').run(
    name ?? existing.name,
    icon ?? existing.icon,
    color ?? existing.color,
    is_income !== undefined ? (is_income ? 1 : 0) : existing.is_income,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Category not found' });
  res.status(204).end();
});

export default router;
