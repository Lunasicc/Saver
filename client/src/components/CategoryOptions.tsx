import { categoryTree } from '../lib/categories';
import type { Category } from '../lib/types';

type Props = {
  categories: Category[];
  /** Label for a parent's own option inside its group, e.g. "All Dining Out" for filters. */
  parentLabel?: (name: string) => string;
};

/**
 * <option>s for a category <select>. Categories with sub-categories become a
 * group holding the parent and its children, so the closed select still shows
 * just the chosen name.
 */
export function CategoryOptions({ categories, parentLabel = (n) => n }: Props) {
  return (
    <>
      {categoryTree(categories).map((c) =>
        c.children.length === 0 ? (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ) : (
          <optgroup key={c.id} label={c.name}>
            <option value={c.id}>{parentLabel(c.name)}</option>
            {c.children.map((child) => (
              <option key={child.id} value={child.id}>
                {child.name}
              </option>
            ))}
          </optgroup>
        )
      )}
    </>
  );
}
