import { Router } from 'express';
import { db } from '../db/index.js';

const router = Router();

const NAME_MAX = 40;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const ICON_RE = /^[a-z0-9-]{1,32}$/;

const getCategory = db.prepare('SELECT * FROM categories WHERE id = ?');
const childCount = db.prepare('SELECT COUNT(*) AS n FROM categories WHERE parent_id = ?');

router.get('/', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id) AS transaction_count
       FROM categories c ORDER BY c.is_income DESC, c.name COLLATE NOCASE ASC`
    )
    .all();
  res.json(rows);
});

/** Validates a create/update body against the current row (if any). Returns { values } or { error, status }. */
function validate(body, existing = null) {
  const input = body || {};
  const values = {
    name: existing?.name,
    icon: existing?.icon ?? 'tag',
    color: existing?.color ?? '#6366f1',
    is_income: existing?.is_income ?? 0,
    is_fixed: existing?.is_fixed ?? 0,
    parent_id: existing?.parent_id ?? null,
  };

  if (input.name !== undefined || !existing) {
    if (typeof input.name !== 'string' || !input.name.trim()) return { error: 'name is required' };
    const name = input.name.trim().replace(/\s+/g, ' ');
    if (name.length > NAME_MAX) return { error: `name must be ${NAME_MAX} characters or fewer` };
    const clash = db
      .prepare('SELECT id FROM categories WHERE lower(name) = lower(?) AND id != ?')
      .get(name, existing?.id ?? -1);
    if (clash) return { error: 'A category with that name already exists', status: 409 };
    values.name = name;
  }
  if (input.icon !== undefined) {
    if (typeof input.icon !== 'string' || !ICON_RE.test(input.icon)) return { error: 'icon must be an icon key' };
    values.icon = input.icon;
  }
  if (input.color !== undefined) {
    if (typeof input.color !== 'string' || !COLOR_RE.test(input.color)) return { error: 'color must be a hex colour like #22c55e' };
    values.color = input.color.toLowerCase();
  }
  if (input.is_fixed !== undefined) values.is_fixed = input.is_fixed ? 1 : 0;
  if (input.is_income !== undefined) values.is_income = input.is_income ? 1 : 0;

  if (input.parent_id !== undefined) {
    if (input.parent_id === null || input.parent_id === '') {
      values.parent_id = null;
    } else {
      const parentId = Number(input.parent_id);
      const parent = Number.isInteger(parentId) ? getCategory.get(parentId) : null;
      if (!parent) return { error: 'parent_id does not match an existing category' };
      if (parent.parent_id !== null) return { error: 'Sub-categories can only sit under a top-level category' };
      if (existing && parent.id === existing.id) return { error: 'A category cannot be its own parent' };
      if (existing && childCount.get(existing.id).n > 0) {
        return { error: 'This category has sub-categories of its own, so it has to stay top-level', status: 409 };
      }
      values.parent_id = parent.id;
    }
  }

  // Sub-categories always share their parent's money-in/money-out side.
  if (values.parent_id !== null) values.is_income = getCategory.get(values.parent_id).is_income;
  return { values };
}

router.post('/', (req, res) => {
  const { values, error, status } = validate(req.body);
  if (error) return res.status(status || 400).json({ error });
  if (req.body?.is_fixed === undefined && values.parent_id !== null) {
    values.is_fixed = getCategory.get(values.parent_id).is_fixed;
  }
  const info = db
    .prepare(
      `INSERT INTO categories (name, icon, color, is_income, is_fixed, parent_id)
       VALUES (@name, @icon, @color, @is_income, @is_fixed, @parent_id)`
    )
    .run(values);
  res.status(201).json(getCategory.get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const existing = getCategory.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Category not found' });
  const { values, error, status } = validate(req.body, existing);
  if (error) return res.status(status || 400).json({ error });
  db.transaction(() => {
    db.prepare(
      `UPDATE categories SET name = @name, icon = @icon, color = @color, is_income = @is_income,
         is_fixed = @is_fixed, parent_id = @parent_id WHERE id = @id`
    ).run({ ...values, id: existing.id });
    if (values.parent_id === null) {
      db.prepare('UPDATE categories SET is_income = ? WHERE parent_id = ?').run(values.is_income, existing.id);
    }
  })();
  res.json(getCategory.get(existing.id));
});

// Deleting a sub-category hands its transactions, rules and bills to the parent.
// Deleting a top-level category removes its sub-categories too, and their
// transactions become uncategorized.
router.delete('/:id', (req, res) => {
  const existing = getCategory.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Category not found' });

  const result = db.transaction(() => {
    const dismiss = db.prepare('INSERT OR IGNORE INTO dismissed_seed_categories (seed_key) VALUES (?)');
    const countTx = db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE category_id = ?');
    const remove = (cat) => {
      if (cat.seed_key) dismiss.run(cat.seed_key);
      db.prepare('DELETE FROM categories WHERE id = ?').run(cat.id);
    };

    if (existing.parent_id !== null) {
      const moved = db
        .prepare('UPDATE transactions SET category_id = ? WHERE category_id = ?')
        .run(existing.parent_id, existing.id).changes;
      db.prepare('UPDATE OR IGNORE merchant_rules SET category_id = ? WHERE category_id = ?').run(existing.parent_id, existing.id);
      db.prepare('UPDATE recurring_bills SET category_id = ? WHERE category_id = ?').run(existing.parent_id, existing.id);
      remove(existing);
      return { moved, uncategorized: 0 };
    }

    const children = db.prepare('SELECT * FROM categories WHERE parent_id = ?').all(existing.id);
    let uncategorized = countTx.get(existing.id).n;
    for (const child of children) {
      uncategorized += countTx.get(child.id).n;
      remove(child);
    }
    remove(existing);
    return { moved: 0, uncategorized, removedSubcategories: children.length };
  })();

  res.json(result);
});

export default router;
