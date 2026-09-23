import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { CopyIcon, PencilSimpleIcon, PlusIcon, SparkleIcon, TargetIcon, TrashIcon, XIcon } from '@phosphor-icons/react';
import { api } from '../lib/api';
import type { Budget, BudgetSuggestion, BudgetSuggestionsReport, Category, CategorySpend } from '../lib/types';
import { currentMonth, daysInMonth, formatMoney, formatMoneyWhole, monthLabel, monthLong, shiftMonth, today } from '../lib/format';
import { celebrate } from '../lib/celebrate';
import { onDataChanged } from '../lib/events';
import { CategoryIcon } from '../components/CategoryIcon';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { MonthStepper } from '../components/MonthStepper';
import { Panel } from '../components/Panel';
import { SkeletonList } from '../components/Skeleton';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Compares in whole cents so float drift can't report a budget as over by 0.001. */
function isOverBudget(spent: number, amount: number) {
  return Math.round(spent * 100) > Math.round(amount * 100);
}

export function Budgets() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('month') ?? '';
  const month = MONTH_RE.test(requested) ? requested : currentMonth();
  const isCurrent = month === currentMonth();

  const [budgets, setBudgets] = useState<Budget[] | null>(null);
  const [previousBudgets, setPreviousBudgets] = useState<Budget[]>([]);
  const [spending, setSpending] = useState<CategorySpend[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ category_id: '', amount: '' });
  const [editing, setEditing] = useState<{ id: number; value: string } | null>(null);

  const [suggestions, setSuggestions] = useState<BudgetSuggestionsReport | null>(null);
  const [lookback, setLookback] = useState(3);
  const [selected, setSelected] = useState<Record<number, number>>({});
  const [suggesting, setSuggesting] = useState(false);
  const [applying, setApplying] = useState(false);

  function setMonth(next: string) {
    const p = new URLSearchParams(params);
    if (next === currentMonth()) p.delete('month');
    else p.set('month', next);
    setParams(p, { replace: true });
    setSuggestions(null);
  }

  const load = useCallback(async () => {
    setError(null);
    try {
      const [current, previous, spend] = await Promise.all([
        api.get<Budget[]>(`/budgets?month=${month}`),
        api.get<Budget[]>(`/budgets?month=${shiftMonth(month, -1)}`),
        api.get<CategorySpend[]>(`/reports/spending-by-category?month=${month}`),
      ]);
      setBudgets(current);
      setPreviousBudgets(previous);
      setSpending(spend);
    } catch (err) {
      setBudgets([]);
      setError((err as Error).message);
    }
  }, [month]);

  useEffect(() => {
    api
      .get<Category[]>('/categories')
      .then((cats) => setCategories(cats.filter((c) => !c.is_income).sort((a, b) => a.name.localeCompare(b.name))))
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => onDataChanged(load), [load]);

  async function saveBudget(category_id: number, amount: number) {
    if (!(amount > 0)) return;
    try {
      await api.post('/budgets', { category_id, month, amount });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function addBudget(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.category_id || !draft.amount) return;
    await saveBudget(Number(draft.category_id), Number(draft.amount));
    setDraft({ category_id: '', amount: '' });
  }

  async function commitEdit(b: Budget) {
    if (!editing) return;
    const value = Number(editing.value);
    setEditing(null);
    if (value > 0 && value !== b.amount) await saveBudget(b.category_id, value);
  }

  async function removeBudget(id: number) {
    try {
      await api.del(`/budgets/${id}`);
      setBudgets((list) => list?.filter((b) => b.id !== id) ?? null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function copyPrevious() {
    setApplying(true);
    try {
      await api.post('/budgets/suggestions/apply', {
        month,
        budgets: previousBudgets.map((b) => ({ category_id: b.category_id, amount: b.amount })),
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApplying(false);
    }
  }

  async function loadSuggestions(nextLookback = lookback) {
    setSuggesting(true);
    setError(null);
    try {
      const report = await api.get<BudgetSuggestionsReport>(`/budgets/suggestions?month=${month}&lookback=${nextLookback}`);
      setSuggestions(report);
      // Pre-select the categories worth budgeting, at the suggested amount.
      setSelected(
        Object.fromEntries(report.suggestions.filter((s) => s.recommended).map((s) => [s.category_id, s.suggested_amount]))
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSuggesting(false);
    }
  }

  function toggle(s: BudgetSuggestion) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[s.category_id] !== undefined) delete next[s.category_id];
      else next[s.category_id] = s.suggested_amount;
      return next;
    });
  }

  async function applySuggestions() {
    const payload = Object.entries(selected)
      .map(([category_id, amount]) => ({ category_id: Number(category_id), amount }))
      .filter((b) => b.amount > 0);
    if (payload.length === 0) return;
    setApplying(true);
    try {
      await api.post('/budgets/suggestions/apply', { month, budgets: payload });
      setSuggestions(null);
      setSelected({});
      await load();
      celebrate();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApplying(false);
    }
  }

  // Most-used budgets first, so the ones needing attention sit at the top.
  const sorted = useMemo(
    () => [...(budgets ?? [])].sort((a, b) => b.spent / (b.amount || 1) - a.spent / (a.amount || 1)),
    [budgets]
  );

  const totalBudget = sorted.reduce((s, b) => s + b.amount, 0);
  const totalSpent = sorted.reduce((s, b) => s + b.spent, 0);
  const days = daysInMonth(month);
  const dayOfMonth = isCurrent ? Number(today().slice(8, 10)) : days;
  const timePct = dayOfMonth / days;
  const budgetedIds = new Set(sorted.map((b) => b.category_id));
  const unbudgetedSpend = spending.filter((s) => !budgetedIds.has(s.category_id) && s.total > 0);
  const unbudgetedCategories = categories.filter((c) => !budgetedIds.has(c.id));
  const selectedTotal = Object.values(selected).reduce((s, v) => s + v, 0);
  const selectedCount = Object.keys(selected).length;

  return (
    <div className="stack">
      <div className="section-head" style={{ marginBottom: 0, alignItems: 'center' }}>
        <MonthStepper month={month} onChange={setMonth} />
        <div className="row">
          {previousBudgets.length > 0 && sorted.length === 0 && budgets !== null && (
            <button className="btn btn-secondary" onClick={copyPrevious} disabled={applying}>
              <CopyIcon size={15} />
              Copy {monthLabel(shiftMonth(month, -1))}
            </button>
          )}
          <button
            className={`btn ${suggestions ? 'btn-ghost' : 'btn-secondary'}`}
            onClick={() => (suggestions ? setSuggestions(null) : loadSuggestions())}
            disabled={suggesting}
          >
            {suggestions ? <XIcon size={15} /> : <SparkleIcon size={15} weight="fill" style={{ color: 'var(--accent)' }} />}
            {suggesting ? 'Crunching…' : suggestions ? 'Hide suggestions' : 'Suggest from my spending'}
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}

      <AnimatePresence initial={false}>
        {suggestions && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={{ overflow: 'hidden' }}
          >
            <Panel
              className="panel--accent"
              title={
                <div>
                  <h2 className="panel-title">Suggested budgets for {monthLong(month)}</h2>
                  <p className="small muted" style={{ marginTop: 4, maxWidth: '64ch' }}>
                    Your typical (median) month across {suggestions.monthsConsidered.map(monthLabel).join(', ')}, rounded
                    up to the nearest $10. Adjust anything before applying.
                  </p>
                </div>
              }
              action={
                <select
                  aria-label="Look back"
                  value={lookback}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setLookback(next);
                    loadSuggestions(next);
                  }}
                >
                  <option value={3}>Last 3 months</option>
                  <option value={6}>Last 6 months</option>
                  <option value={12}>Last 12 months</option>
                </select>
              }
            >
              {suggestions.suggestions.length === 0 ? (
                <EmptyState icon={SparkleIcon} title="Not enough history yet">
                  Once a few months of spending are in, suggestions will appear here.
                </EmptyState>
              ) : (
                <>
                  <div className="list">
                    {suggestions.suggestions.map((s) => {
                      const on = selected[s.category_id] !== undefined;
                      return (
                        <div key={s.category_id} className="list-row" style={{ opacity: on ? 1 : 0.5 }}>
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggle(s)}
                            aria-label={`Include ${s.category_name} budget`}
                          />
                          <CategoryIcon name={s.category_name} color={s.category_color} size={30} />
                          <div className="list-main">
                            <div className="list-title">{s.category_name}</div>
                            <div className="list-meta">
                              Typical {formatMoneyWhole(s.median_monthly)} · range {formatMoneyWhole(s.min_monthly)}–
                              {formatMoneyWhole(s.max_monthly)} · in {s.months_with_spend}/{s.months_considered} months
                              {s.existing_amount !== null && ` · currently ${formatMoneyWhole(s.existing_amount)}`}
                            </div>
                          </div>
                          <label className="money-input">
                            <span className="sr-only">{s.category_name} budget amount</span>
                            <span aria-hidden="true">$</span>
                            <input
                              type="number"
                              min={1}
                              step={10}
                              value={selected[s.category_id] ?? s.suggested_amount}
                              disabled={!on}
                              onChange={(e) => setSelected((prev) => ({ ...prev, [s.category_id]: Number(e.target.value) }))}
                            />
                          </label>
                        </div>
                      );
                    })}
                  </div>
                  <div className="row" style={{ justifyContent: 'space-between', marginTop: 18 }}>
                    <span className="muted">
                      {selectedCount} categor{selectedCount === 1 ? 'y' : 'ies'} ·{' '}
                      <strong className="num" style={{ color: 'var(--text)' }}>
                        {formatMoneyWhole(selectedTotal)}
                      </strong>{' '}
                      a month
                    </span>
                    <button className="btn btn-primary" onClick={applySuggestions} disabled={applying || selectedCount === 0}>
                      {applying ? 'Applying…' : `Apply to ${monthLabel(month)}`}
                    </button>
                  </div>
                </>
              )}
            </Panel>
          </motion.div>
        )}
      </AnimatePresence>

      {budgets === null ? (
        <Panel>
          <SkeletonList rows={5} />
        </Panel>
      ) : sorted.length === 0 ? (
        !suggestions && (
          <Panel>
            <EmptyState
              icon={TargetIcon}
              title={`No budgets for ${monthLong(month)}`}
              action={
                <button className="btn btn-primary" onClick={() => loadSuggestions()} disabled={suggesting}>
                  <SparkleIcon size={15} weight="fill" />
                  Suggest budgets from my spending
                </button>
              }
            >
              Start from what you actually spend. It takes about ten seconds.
            </EmptyState>
          </Panel>
        )
      ) : (
        <Panel>
          <div className="budget-summary">
            <div>
              <div className="stat-label">Spent</div>
              <div className="stat-value">{formatMoneyWhole(totalSpent)}</div>
            </div>
            <div>
              <div className="stat-label">Budgeted</div>
              <div className="stat-value">{formatMoneyWhole(totalBudget)}</div>
            </div>
            <div>
              <div className="stat-label">{isOverBudget(totalSpent, totalBudget) ? 'Over' : 'Left'}</div>
              <div className={`stat-value ${isOverBudget(totalSpent, totalBudget) ? 'amount--bad' : 'amount--in'}`}>
                {formatMoneyWhole(Math.abs(totalBudget - totalSpent))}
              </div>
            </div>
            {isCurrent && (
              <div>
                <div className="stat-label">Month elapsed</div>
                <div className="stat-value">{Math.round(timePct * 100)}%</div>
              </div>
            )}
          </div>

          <div className="list" style={{ marginTop: 22 }}>
            {sorted.map((b) => {
              const pct = b.amount > 0 ? b.spent / b.amount : 0;
              const over = isOverBudget(b.spent, b.amount);
              const ahead = !over && isCurrent && pct > timePct + 0.1;
              const isEditing = editing?.id === b.id;
              return (
                <div key={b.id} className="list-row budget-row">
                  <CategoryIcon name={b.category_name} color={b.category_color} />
                  <div className="list-main">
                    <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                      <span className="list-title">{b.category_name}</span>
                      <span className="small num" style={{ whiteSpace: 'nowrap' }}>
                        <span style={{ color: 'var(--text)', fontWeight: 500 }}>{formatMoney(b.spent)}</span>
                        <span className="faint"> of </span>
                        {isEditing ? (
                          <input
                            autoFocus
                            type="number"
                            min={1}
                            step={10}
                            aria-label={`${b.category_name} budget`}
                            value={editing.value}
                            onChange={(e) => setEditing({ id: b.id, value: e.target.value })}
                            onBlur={() => commitEdit(b)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitEdit(b);
                              if (e.key === 'Escape') setEditing(null);
                            }}
                            style={{ width: 90, height: 26 }}
                          />
                        ) : (
                          <button
                            className="link-button"
                            title="Edit budget"
                            onClick={() => setEditing({ id: b.id, value: String(b.amount) })}
                          >
                            {formatMoneyWhole(b.amount)}
                            <PencilSimpleIcon size={12} />
                          </button>
                        )}
                      </span>
                    </div>
                    <div className="bar" style={{ margin: '8px 0 6px', overflow: 'visible' }}>
                      <div
                        className="bar-fill"
                        style={{
                          width: `${Math.min(pct, 1) * 100}%`,
                          background: over ? 'var(--danger)' : ahead ? 'var(--warning)' : 'var(--accent)',
                        }}
                      />
                      {isCurrent && <div className="bar-marker" style={{ left: `${timePct * 100}%` }} />}
                    </div>
                    <div className={`list-meta${over ? ' amount--bad' : ''}`}>
                      {over
                        ? `${formatMoney(b.spent - b.amount)} over`
                        : `${formatMoney(b.amount - b.spent)} left${ahead ? ' · ahead of pace' : ''}`}
                    </div>
                  </div>
                  <button
                    className="btn btn-icon danger"
                    aria-label={`Remove ${b.category_name} budget`}
                    title="Remove budget"
                    onClick={() => removeBudget(b.id)}
                  >
                    <TrashIcon size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      <div className={unbudgetedSpend.length > 0 ? 'split-even' : undefined}>
        {unbudgetedSpend.length > 0 && (
          <Panel title="Spending without a budget" action={<span className="small faint">{monthLabel(month)}</span>}>
            <div className="list">
              {unbudgetedSpend.map((s) => (
                <div key={s.category_id} className="list-row">
                  <CategoryIcon name={s.name} color={s.color} size={30} />
                  <div className="list-main">
                    <div className="list-title">{s.name}</div>
                  </div>
                  <span className="amount num">{formatMoney(s.total)}</span>
                  <button
                    className="btn btn-ghost btn-sm"
                    aria-label={`Add a budget for ${s.name}`}
                    onClick={() => setDraft({ category_id: String(s.category_id), amount: String(Math.ceil(s.total / 10) * 10) })}
                  >
                    <PlusIcon size={13} weight="bold" />
                    Budget
                  </button>
                </div>
              ))}
            </div>
          </Panel>
        )}
        <Panel title="Add a budget">
          <form onSubmit={addBudget} className="form-grid">
            <label>
              Category
              <select value={draft.category_id} onChange={(e) => setDraft({ ...draft, category_id: e.target.value })}>
                <option value="">Select…</option>
                {unbudgetedCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Monthly amount
              <input
                type="number"
                step="1"
                min="1"
                inputMode="decimal"
                placeholder="200"
                value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
              />
            </label>
            <button className="btn btn-primary" type="submit" disabled={!draft.category_id || !draft.amount}>
              Set budget for {monthLabel(month)}
            </button>
          </form>
        </Panel>
      </div>
    </div>
  );
}
