import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { PencilSimpleIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { api } from '../lib/api';
import type { Category } from '../lib/types';
import { categoryTree, type CategoryNode } from '../lib/categories';
import { CATEGORY_COLORS, CATEGORY_ICONS } from '../lib/categoryIcons';
import { notifyDataChanged, onDataChanged } from '../lib/events';
import { CategoryIcon } from '../components/CategoryIcon';
import { Dialog } from '../components/Dialog';
import { ErrorBanner, SuccessNotice } from '../components/ErrorBanner';
import { Panel } from '../components/Panel';
import { SkeletonList } from '../components/Skeleton';
import { Switch } from '../components/bank/parts';

type Draft = {
  id: number | null;
  name: string;
  parent_id: string;
  icon: string;
  color: string;
  is_income: boolean;
  is_fixed: boolean;
};

type DeleteResult = { moved: number; uncategorized: number; removedSubcategories?: number };

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

function blankDraft(parent?: Category): Draft {
  return {
    id: null,
    name: '',
    parent_id: parent ? String(parent.id) : '',
    icon: parent?.icon ?? 'tag',
    color: parent?.color ?? CATEGORY_COLORS[0],
    is_income: parent ? Boolean(parent.is_income) : false,
    is_fixed: parent ? Boolean(parent.is_fixed) : false,
  };
}

export function Categories() {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirm, setConfirm] = useState<CategoryNode | Category | null>(null);

  const load = useCallback(() => {
    api
      .get<Category[]>('/categories')
      .then(setCategories)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    return onDataChanged(load);
  }, [load]);

  const tree = useMemo(() => categoryTree(categories ?? []), [categories]);
  const spending = tree.filter((c) => !c.is_income);
  const income = tree.filter((c) => c.is_income);

  const edit = (c: Category) =>
    setDraft({
      id: c.id,
      name: c.name,
      parent_id: c.parent_id === null ? '' : String(c.parent_id),
      icon: c.icon,
      color: c.color,
      is_income: Boolean(c.is_income),
      is_fixed: Boolean(c.is_fixed),
    });

  const remove = async (c: Category) => {
    setConfirm(null);
    try {
      const r = await api.del<DeleteResult>(`/categories/${c.id}`);
      const parts = [`Deleted ${c.name}.`];
      if (r.moved) parts.push(`${plural(r.moved, 'transaction')} moved to its parent category.`);
      if (r.removedSubcategories) parts.push(`${plural(r.removedSubcategories, 'sub-category', 'sub-categories')} removed.`);
      if (r.uncategorized) parts.push(`${plural(r.uncategorized, 'transaction')} now uncategorized.`);
      setNotice(parts.join(' '));
      notifyDataChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const renderGroup = (title: string, nodes: CategoryNode[], hint: string) => (
    <Panel
      title={title}
      action={
        <span className="small muted">
          {plural(nodes.reduce((n, c) => n + 1 + c.children.length, 0), 'category', 'categories')}
        </span>
      }
    >
      <p className="small muted cat-hint">{hint}</p>
      <ul className="cat-tree">
        {nodes.map((c) => (
          <li key={c.id} className="cat-node">
            <CategoryRow category={c} onEdit={edit} onDelete={setConfirm} onAddChild={(p) => setDraft(blankDraft(p))} />
            {c.children.length > 0 && (
              <ul className="cat-children">
                {c.children.map((child) => (
                  <li key={child.id}>
                    <CategoryRow category={child} child onEdit={edit} onDelete={setConfirm} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );

  return (
    <div className="stack">
      {error && <ErrorBanner message={error} onRetry={() => { setError(null); load(); }} />}
      {notice && <SuccessNotice onDismiss={() => setNotice(null)}>{notice}</SuccessNotice>}
      <div className="cat-toolbar">
        <p className="small muted" style={{ margin: 0 }}>
          Make categories your own. Sub-categories roll up into their parent on the Overview and in budgets.
        </p>
        <button className="btn btn-primary" onClick={() => setDraft(blankDraft())}>
          <PlusIcon size={14} weight="bold" /> New category
        </button>
      </div>
      {categories === null ? (
        <Panel>
          <SkeletonList rows={8} />
        </Panel>
      ) : (
        <div className="split cat-split">
          {renderGroup(
            'Spending',
            spending,
            'Categories marked "Bill" are commitments like rent and insurance. They are left out of Top spending so everyday spending stands out.'
          )}
          {renderGroup('Money in', income, 'Pay, refunds and anything else coming in.')}
        </div>
      )}

      <CategoryDialog
        key={draft ? `${draft.id ?? 'new'}-${draft.parent_id}` : 'closed'}
        draft={draft}
        categories={categories ?? []}
        onClose={() => setDraft(null)}
        onSaved={(name, created) => {
          setDraft(null);
          setNotice(created ? `Added ${name}.` : `Saved ${name}.`);
          notifyDataChanged();
        }}
      />

      <Dialog open={confirm !== null} onClose={() => setConfirm(null)} title={`Delete ${confirm?.name ?? ''}?`}>
        {confirm && <DeleteExplainer category={confirm} tree={tree} />}
        <div className="wizard-actions" style={{ marginTop: 18 }}>
          <span style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={() => setConfirm(null)}>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={() => confirm && remove(confirm)}>
            <TrashIcon size={14} /> Delete
          </button>
        </div>
      </Dialog>
    </div>
  );
}

function DeleteExplainer({ category, tree }: { category: Category; tree: CategoryNode[] }) {
  const count = category.transaction_count ?? 0;
  if (category.parent_id !== null) {
    const parent = tree.find((c) => c.id === category.parent_id);
    return (
      <p className="small" style={{ margin: 0, color: 'var(--text-2)' }}>
        {count > 0 ? `Its ${plural(count, 'transaction')}` : 'Anything in it'}, plus its rules and bills, will move to{' '}
        <strong>{parent?.name ?? 'its parent'}</strong>.
      </p>
    );
  }
  const node = tree.find((c) => c.id === category.id);
  const kids = node?.children ?? [];
  const total = count + kids.reduce((n, c) => n + (c.transaction_count ?? 0), 0);
  return (
    <p className="small" style={{ margin: 0, color: 'var(--text-2)' }}>
      {total > 0 ? `${plural(total, 'transaction')} will become uncategorized` : 'No transactions use it'}
      {kids.length > 0 ? ` and its ${plural(kids.length, 'sub-category', 'sub-categories')} will be removed` : ''}. Its rules and budget are
      removed too.
    </p>
  );
}

function CategoryRow({
  category: c,
  child = false,
  onEdit,
  onDelete,
  onAddChild,
}: {
  category: Category;
  child?: boolean;
  onEdit: (c: Category) => void;
  onDelete: (c: Category) => void;
  onAddChild?: (c: Category) => void;
}) {
  const count = c.transaction_count ?? 0;
  return (
    <div className={`list-row cat-row${child ? ' cat-row--child' : ''}`}>
      <CategoryIcon name={c.name} color={c.color} icon={c.icon} size={child ? 28 : 34} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="list-title">
          {c.name}
          {c.is_fixed ? <span className="chip chip--xs cat-bill">Bill</span> : null}
        </div>
        <div className="list-meta">{count === 0 ? 'No transactions yet' : plural(count, 'transaction')}</div>
      </div>
      <div className="cat-actions">
        {onAddChild && (
          <button className="btn btn-ghost btn-sm" onClick={() => onAddChild(c)} title={`Add a sub-category under ${c.name}`}>
            <PlusIcon size={13} /> <span className="cat-action-label">Sub-category</span>
          </button>
        )}
        <button className="btn btn-icon" aria-label={`Edit ${c.name}`} onClick={() => onEdit(c)}>
          <PencilSimpleIcon size={15} />
        </button>
        <button className="btn btn-icon" aria-label={`Delete ${c.name}`} onClick={() => onDelete(c)}>
          <TrashIcon size={15} />
        </button>
      </div>
    </div>
  );
}

function CategoryDialog({
  draft,
  categories,
  onClose,
  onSaved,
}: {
  draft: Draft | null;
  categories: Category[];
  onClose: () => void;
  onSaved: (name: string, created: boolean) => void;
}) {
  const [form, setForm] = useState<Draft | null>(draft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasChildren = form?.id != null && categories.some((c) => c.parent_id === form.id);
  const parents = categories
    .filter((c) => c.parent_id === null && c.id !== form?.id)
    .sort((a, b) => Number(a.is_income) - Number(b.is_income) || a.name.localeCompare(b.name));
  const parent = form?.parent_id ? categories.find((c) => String(c.id) === form.parent_id) : undefined;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);
    const body = {
      name: form.name,
      parent_id: form.parent_id ? Number(form.parent_id) : null,
      icon: form.icon,
      color: form.color,
      is_income: form.is_income,
      is_fixed: form.is_fixed,
    };
    try {
      const saved = form.id
        ? await api.put<Category>(`/categories/${form.id}`, body)
        : await api.post<Category>('/categories', body);
      onSaved(saved.name, !form.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={draft !== null}
      onClose={onClose}
      wide
      title={form?.id ? 'Edit category' : parent ? `New sub-category in ${parent.name}` : 'New category'}
    >
      {form && (
        <form onSubmit={submit} className="stack" style={{ gap: 16 }}>
          <div className="cat-preview">
            <CategoryIcon name={form.name || 'Category'} color={form.color} icon={form.icon} size={44} />
            <div style={{ minWidth: 0 }}>
              <div className="list-title">{form.name || 'Untitled category'}</div>
              <div className="list-meta">
                {parent ? `Inside ${parent.name}` : 'Top-level'}
                {form.is_fixed ? ' · Bill or commitment' : ''}
              </div>
            </div>
          </div>
          <div className="form-grid form-grid--2">
            <label>
              Name
              <input
                required
                autoFocus
                maxLength={40}
                placeholder="e.g. Coffee"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              Sits under
              <select
                value={form.parent_id}
                disabled={hasChildren}
                title={hasChildren ? 'This category has sub-categories, so it stays top-level' : undefined}
                onChange={(e) => {
                  const next = categories.find((c) => String(c.id) === e.target.value);
                  setForm({ ...form, parent_id: e.target.value, is_income: next ? Boolean(next.is_income) : form.is_income });
                }}
              >
                <option value="">Nothing (top-level)</option>
                {parents.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <fieldset className="cat-fieldset">
            <legend>Icon</legend>
            <div className="icon-grid" role="radiogroup" aria-label="Icon">
              {CATEGORY_ICONS.map(({ key, label, icon: Glyph }) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={form.icon === key}
                  aria-label={label}
                  title={label}
                  className={`icon-pick${form.icon === key ? ' icon-pick--on' : ''}`}
                  style={form.icon === key ? { color: form.color, borderColor: form.color } : undefined}
                  onClick={() => setForm({ ...form, icon: key })}
                >
                  <Glyph size={18} weight={form.icon === key ? 'fill' : 'regular'} />
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="cat-fieldset">
            <legend>Colour</legend>
            <div className="swatch-row" role="radiogroup" aria-label="Colour">
              {CATEGORY_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  role="radio"
                  aria-checked={form.color === color}
                  aria-label={color}
                  className={`swatch${form.color === color ? ' swatch--on' : ''}`}
                  style={{ background: color }}
                  onClick={() => setForm({ ...form, color })}
                />
              ))}
            </div>
          </fieldset>

          <div className="cat-switches">
            {!parent && (
              <div className="cat-switch">
                <div>
                  <div className="list-title">Money in</div>
                  <div className="list-meta">For pay, refunds and other income.</div>
                </div>
                <Switch checked={form.is_income} label="Money in" onChange={(v) => setForm({ ...form, is_income: v, is_fixed: v ? false : form.is_fixed })} />
              </div>
            )}
            {!form.is_income && (
              <div className="cat-switch">
                <div>
                  <div className="list-title">Counts as a bill or commitment</div>
                  <div className="list-meta">Left out of Top spending so everyday spending stands out.</div>
                </div>
                <Switch checked={form.is_fixed} label="Counts as a bill or commitment" onChange={(v) => setForm({ ...form, is_fixed: v })} />
              </div>
            )}
          </div>

          {error && (
            <p role="alert" className="small amount--bad" style={{ margin: 0 }}>
              {error}
            </p>
          )}
          <div className="wizard-actions">
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? 'Saving…' : form.id ? 'Save changes' : 'Add category'}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
