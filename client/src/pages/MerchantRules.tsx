import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowCounterClockwiseIcon, BrainIcon, MagnifyingGlassIcon, RobotIcon, TrashIcon } from '@phosphor-icons/react';
import { api } from '../lib/api';
import type { Category, MerchantRule } from '../lib/types';
import { CategoryIcon } from '../components/CategoryIcon';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner, SuccessNotice } from '../components/ErrorBanner';
import { Panel } from '../components/Panel';
import { SkeletonList } from '../components/Skeleton';

type Filter = 'all' | 'exact' | 'contains';

export function MerchantRules() {
  const [rules, setRules] = useState<MerchantRule[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api
      .get<MerchantRule[]>('/merchant-rules')
      .then(setRules)
      .catch((err: Error) => {
        setRules([]);
        setError(err.message);
      });
  }, []);

  useEffect(() => {
    load();
    api
      .get<Category[]>('/categories')
      .then((c) => setCategories([...c].sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => setCategories([]));
  }, [load]);

  async function changeCategory(rule: MerchantRule, categoryId: string) {
    const cat = categories.find((c) => c.id === Number(categoryId));
    setRules(
      (list) =>
        list?.map((r) =>
          r.id === rule.id && cat
            ? { ...r, category_id: cat.id, category_name: cat.name, category_color: cat.color, category_icon: cat.icon }
            : r
        ) ?? null
    );
    try {
      await api.put(`/merchant-rules/${rule.id}`, { category_id: Number(categoryId) });
    } catch (err) {
      setError((err as Error).message);
      load();
    }
  }

  async function remove(rule: MerchantRule) {
    try {
      await api.del(`/merchant-rules/${rule.id}`);
      setRules((list) => list?.filter((r) => r.id !== rule.id) ?? null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function restoreDefaults() {
    setRestoring(true);
    setNotice(null);
    try {
      const before = rules?.length ?? 0;
      await api.post('/merchant-rules/restore-defaults', {});
      const fresh = await api.get<MerchantRule[]>('/merchant-rules');
      setRules(fresh);
      const added = fresh.length - before;
      setNotice(added > 0 ? `Restored ${added} built-in rule${added === 1 ? '' : 's'}.` : 'All built-in rules are already in place.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRestoring(false);
    }
  }

  const counts = useMemo(
    () => ({
      all: rules?.length ?? 0,
      exact: rules?.filter((r) => r.match_type === 'exact').length ?? 0,
      contains: rules?.filter((r) => r.match_type === 'contains').length ?? 0,
    }),
    [rules]
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (rules ?? []).filter(
      (r) =>
        (filter === 'all' || r.match_type === filter) &&
        (!needle ||
          r.pattern.toLowerCase().includes(needle) ||
          r.merchant_name.toLowerCase().includes(needle) ||
          r.category_name.toLowerCase().includes(needle))
    );
  }, [rules, filter, search]);

  return (
    <div className="stack">
      <div className="section-head" style={{ marginBottom: 0 }}>
        <div>
          <h2 className="section-title">Categorization rules</h2>
          <p className="section-sub">
            Keyword rules sort new transactions automatically. Whenever you change a category, a rule is learned so the
            same business is sorted next time.
          </p>
        </div>
        <button className="btn btn-secondary" onClick={restoreDefaults} disabled={restoring}>
          <ArrowCounterClockwiseIcon size={15} />
          {restoring ? 'Restoring…' : 'Restore defaults'}
        </button>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {notice && <SuccessNotice onDismiss={() => setNotice(null)}>{notice}</SuccessNotice>}

      <div className="toolbar">
        <label className="search" style={{ gap: 0 }}>
          <span className="sr-only">Search rules</span>
          <MagnifyingGlassIcon size={15} />
          <input
            type="search"
            placeholder="Search keywords, businesses or categories"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select aria-label="Rule type" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="all">All rules ({counts.all})</option>
          <option value="exact">Learned from you ({counts.exact})</option>
          <option value="contains">Keyword defaults ({counts.contains})</option>
        </select>
      </div>

      <Panel flush>
        {rules === null ? (
          <div style={{ padding: 22 }}>
            <SkeletonList rows={8} />
          </div>
        ) : visible.length === 0 ? (
          <EmptyState icon={RobotIcon} title="No rules match">
            {search ? 'Try a different search.' : 'Change a transaction’s category and a rule will appear here.'}
          </EmptyState>
        ) : (
          <div style={{ padding: '6px 0' }}>
            {visible.map((r) => (
              <div key={r.id} className="tx-row rule-row">
                <CategoryIcon name={r.category_name} color={r.category_color} size={30} />
                <div className="list-main">
                  <div className="list-title">{r.merchant_name}</div>
                  <div className="list-meta">
                    <span className="mono">{r.pattern}</span>
                  </div>
                </div>
                <span className={`chip${r.match_type === 'exact' ? ' chip--accent' : ''}`}>
                  {r.match_type === 'exact' ? <BrainIcon size={12} weight="bold" /> : null}
                  {r.match_type === 'exact' ? 'Learned' : 'Keyword'}
                </span>
                <select
                  aria-label={`Category for ${r.merchant_name}`}
                  className="chip-select"
                  value={r.category_id}
                  onChange={(e) => changeCategory(r, e.target.value)}
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button className="btn btn-icon danger" aria-label={`Delete rule ${r.pattern}`} title="Delete rule" onClick={() => remove(r)}>
                  <TrashIcon size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Panel>
      <p className="small faint">
        Deleting a rule doesn’t change transactions that are already categorized. Built-in keyword rules can be brought
        back with Restore defaults.
      </p>
    </div>
  );
}
