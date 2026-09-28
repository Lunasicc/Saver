import type { Category } from './types';

export type CategoryNode = Category & { children: Category[] };

const byName = (a: Category, b: Category) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** Top-level categories (alphabetical) with their sub-categories nested beneath. */
export function categoryTree(categories: Category[]): CategoryNode[] {
  const ids = new Set(categories.map((c) => c.id));
  const children = new Map<number, Category[]>();
  for (const c of categories) {
    if (c.parent_id !== null && ids.has(c.parent_id)) {
      if (!children.has(c.parent_id)) children.set(c.parent_id, []);
      children.get(c.parent_id)!.push(c);
    }
  }
  return categories
    .filter((c) => c.parent_id === null || !ids.has(c.parent_id))
    .sort(byName)
    .map((c) => ({ ...c, children: (children.get(c.id) ?? []).sort(byName) }));
}

/** "Dining Out › Coffee" for sub-categories, the plain name otherwise. */
export function categoryLabel(category: Category | undefined, byId: Map<number, Category>) {
  if (!category) return '';
  const parent = category.parent_id !== null ? byId.get(category.parent_id) : undefined;
  return parent ? `${parent.name} › ${category.name}` : category.name;
}
