import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  CheckIcon,
  MagicWandIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ReceiptIcon,
  TrashIcon,
  XIcon,
} from '@phosphor-icons/react';
import { api } from '../lib/api';
import type { Account, Category, Transaction, TrendPoint } from '../lib/types';
import { dayLabel, formatMoney, formatSigned, monthLong, monthRange, today } from '../lib/format';
import { onDataChanged } from '../lib/events';
import { useAccountFocus } from '../lib/accountFocus';
import { CategoryIcon } from '../components/CategoryIcon';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner, SuccessNotice } from '../components/ErrorBanner';
import { Panel } from '../components/Panel';
import { SkeletonList } from '../components/Skeleton';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const RECENT_LIMIT = 500;

export function TransactionsFeed() {
  const [params, setParams] = useSearchParams();
  const month = MONTH_RE.test(params.get('month') ?? '') ? params.get('month')! : '';
  const category = params.get('category') ?? '';
  const legacyAccount = params.get('account');
  const { focusId, setFocus } = useAccountFocus();
  const account = focusId === null ? '' : String(focusId);
  const q = params.get('q') ?? '';

  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchText, setSearchText] = useState(q);
  const [showForm, setShowForm] = useState(false);
  const [categorizing, setCategorizing] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const requestId = useRef(0);

  const setParam = useCallback(
    (key: string, value: string) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set(key, value);
          else next.delete(key);
          return next;
        },
        { replace: true }
      );
    },
    [setParams]
  );

  // Old links used ?account=; fold them into the app-wide focus.
  useEffect(() => {
    if (!legacyAccount) return;
    const id = Number(legacyAccount);
    if (Number.isInteger(id) && id > 0) setFocus(id);
    setParam('account', '');
  }, [legacyAccount, setFocus, setParam]);

  // Debounce typing into the URL so every keystroke doesn't hit the API.
  useEffect(() => {
    if (searchText === q) return;
    const timer = setTimeout(() => setParam('q', searchText.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchText, q, setParam]);

  const load = useCallback(() => {
    const query = new URLSearchParams();
    if (account) query.set('account_id', account);
    if (category) query.set('category_id', category);
    if (q) query.set('q', q);
    if (month) {
      const { from, to } = monthRange(month);
      query.set('from', from);
      query.set('to', to);
      query.set('limit', '5000');
    } else {
      query.set('limit', String(RECENT_LIMIT));
    }
    // Guard against a slower earlier request overwriting a newer filter's results.
    const id = ++requestId.current;
    setError(null);
    api
      .get<Transaction[]>(`/transactions?${query}`)
      .then((data) => {
        if (id === requestId.current) setTransactions(data);
      })
      .catch((err: Error) => {
        if (id === requestId.current) {
          setTransactions([]);
          setError(err.message);
        }
      });
  }, [account, category, q, month]);

  useEffect(() => {
    api.get<Account[]>('/accounts').then(setAccounts).catch(() => setAccounts([]));
    api.get<Category[]>('/categories').then(setCategories).catch(() => setCategories([]));
    api
      .get<TrendPoint[]>('/reports/trends?months=60')
      .then((t) => setMonths(t.map((p) => p.month).reverse()))
      .catch(() => setMonths([]));
  }, []);

  useEffect(load, [load]);
  useEffect(() => onDataChanged(load), [load]);

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.name.localeCompare(b.name)),
    [categories]
  );

  const groups = useMemo(() => {
    const out: { date: string; items: Transaction[]; net: number }[] = [];
    for (const t of transactions ?? []) {
      const last = out[out.length - 1];
      if (last && last.date === t.date) {
        last.items.push(t);
        last.net += t.amount;
      } else {
        out.push({ date: t.date, items: [t], net: t.amount });
      }
    }
    return out;
  }, [transactions]);

  const totals = useMemo(() => {
    let moneyIn = 0;
    let moneyOut = 0;
    for (const t of transactions ?? []) {
      if (t.amount > 0) moneyIn += t.amount;
      else moneyOut -= t.amount;
    }
    return { moneyIn, moneyOut };
  }, [transactions]);

  async function changeCategory(tx: Transaction, value: string) {
    const category_id = value ? Number(value) : null;
    // Optimistic: update in place so the row doesn't vanish mid-sort when filtered.
    setTransactions((list) => list?.map((t) => (t.id === tx.id ? { ...t, category_id } : t)) ?? null);
    try {
      await api.put(`/transactions/${tx.id}`, { category_id });
    } catch (err) {
      setError((err as Error).message);
      load();
    }
  }

  async function confirmDelete(id: number) {
    setPendingDelete(null);
    try {
      await api.del(`/transactions/${id}`);
      setTransactions((list) => list?.filter((t) => t.id !== id) ?? null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function autoCategorize() {
    setCategorizing(true);
    setNotice(null);
    setError(null);
    try {
      const r = await api.post<{ scanned: number; updated: number }>('/transactions/auto-categorize', {});
      setNotice(
        r.scanned === 0
          ? 'Everything is already categorized.'
          : `Categorized ${r.updated} of ${r.scanned} uncategorized transaction${r.scanned === 1 ? '' : 's'}.`
      );
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCategorizing(false);
    }
  }

  const filtered = Boolean(month || category || account || q);
  const hitLimit = !month && (transactions?.length ?? 0) >= RECENT_LIMIT;

  return (
    <div className="stack">
      <div className="toolbar">
        <label className="search" style={{ gap: 0 }}>
          <span className="sr-only">Search transactions</span>
          <MagnifyingGlassIcon size={15} />
          <input
            type="search"
            placeholder="Search businesses or descriptions"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </label>
        <select aria-label="Month" value={month} onChange={(e) => setParam('month', e.target.value)}>
          <option value="">Most recent</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLong(m)}
            </option>
          ))}
        </select>
        <select aria-label="Category" value={category} onChange={(e) => setParam('category', e.target.value)}>
          <option value="">All categories</option>
          <option value="uncategorized">Uncategorized</option>
          {sortedCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {accounts.length > 1 && (
          <select aria-label="Account" value={account} onChange={(e) => setFocus(e.target.value ? Number(e.target.value) : null)}>
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
        <button className="btn btn-secondary" onClick={autoCategorize} disabled={categorizing}>
          <MagicWandIcon size={15} />
          {categorizing ? 'Categorizing…' : 'Auto-categorize'}
        </button>
        <button className="btn btn-primary" onClick={() => setShowForm((s) => !s)} aria-expanded={showForm}>
          {showForm ? <XIcon size={15} weight="bold" /> : <PlusIcon size={15} weight="bold" />}
          {showForm ? 'Close' : 'Add'}
        </button>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {notice && <SuccessNotice onDismiss={() => setNotice(null)}>{notice}</SuccessNotice>}

      <AnimatePresence initial={false}>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={{ overflow: 'hidden' }}
          >
            <AddTransactionForm
              accounts={accounts}
              categories={sortedCategories}
              onSaved={() => {
                setShowForm(false);
                load();
              }}
              onError={setError}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <Panel flush>
        {transactions === null ? (
          <div style={{ padding: 22 }}>
            <SkeletonList rows={8} />
          </div>
        ) : transactions.length === 0 ? (
          <EmptyState
            icon={ReceiptIcon}
            title={filtered ? 'Nothing matches these filters' : 'No transactions yet'}
            action={
              filtered && (
                <button className="btn btn-secondary btn-sm" onClick={() => { setSearchText(''); setParams({}, { replace: true }); }}>
                  Clear filters
                </button>
              )
            }
          >
            {filtered ? 'Try a different month or category.' : 'Sync your bank, import a CSV, or add one by hand.'}
          </EmptyState>
        ) : (
          <>
            <div className="summary-line">
              <span>
                <strong className="num" style={{ color: 'var(--text)' }}>
                  {transactions.length}
                </strong>{' '}
                transaction{transactions.length === 1 ? '' : 's'}
                {month ? ` in ${monthLong(month)}` : hitLimit ? ' (latest)' : ''}
              </span>
              {totals.moneyIn > 0 && (
                <span>
                  In <span className="amount amount--in">{formatMoney(totals.moneyIn)}</span>
                </span>
              )}
              <span>
                Out <span className="amount" style={{ color: 'var(--text)' }}>{formatMoney(totals.moneyOut)}</span>
              </span>
            </div>
            {groups.map((g) => (
              <div key={g.date} className="day-group">
                <div className="day-head">
                  <span>{dayLabel(g.date)}</span>
                  <span className="num">{formatSigned(g.net)}</span>
                </div>
                {g.items.map((t) => {
                  const cat = t.category_id ? categoryById.get(t.category_id) : undefined;
                  const title = t.merchant?.trim() || t.description;
                  const subtitle = [
                    t.merchant?.trim() && t.merchant.trim() !== t.description ? t.description : null,
                    accounts.length > 1 ? accountById.get(t.account_id)?.name : null,
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <div key={t.id} className="tx-row">
                      <CategoryIcon name={cat?.name} color={cat?.color} />
                      <div className="list-main">
                        <div className="list-title">{title}</div>
                        {subtitle && <div className="list-meta">{subtitle}</div>}
                      </div>
                      <select
                        aria-label={`Category for ${title}`}
                        className={`chip-select${cat ? '' : ' is-empty'}`}
                        value={t.category_id ?? ''}
                        onChange={(e) => changeCategory(t, e.target.value)}
                      >
                        <option value="">Uncategorized</option>
                        {sortedCategories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <span className={`tx-amount amount${t.amount > 0 ? ' amount--in' : ''}`}>
                        {formatSigned(t.amount)}
                      </span>
                      {pendingDelete === t.id ? (
                        <button
                          className="btn btn-icon danger"
                          style={{ opacity: 1, color: 'var(--danger)' }}
                          aria-label={`Confirm delete ${title}`}
                          title="Click again to delete"
                          onClick={() => confirmDelete(t.id)}
                          onBlur={() => setPendingDelete(null)}
                          autoFocus
                        >
                          <CheckIcon size={15} weight="bold" />
                        </button>
                      ) : (
                        <button
                          className="btn btn-icon danger"
                          aria-label={`Delete ${title}`}
                          title="Delete"
                          onClick={() => setPendingDelete(t.id)}
                        >
                          <TrashIcon size={15} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            {hitLimit && (
              <p className="small faint" style={{ padding: '16px 22px' }}>
                Showing the latest {RECENT_LIMIT}. Pick a month to see everything in it.
              </p>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}

function AddTransactionForm({
  accounts,
  categories,
  onSaved,
  onError,
}: {
  accounts: Account[];
  categories: Category[];
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const { focusId } = useAccountFocus();
  const [form, setForm] = useState({
    account_id: accounts.length === 1 ? String(accounts[0].id) : focusId !== null ? String(focusId) : '',
    date: today(),
    description: '',
    amount: '',
    direction: 'out' as 'out' | 'in',
    category_id: '',
  });
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = Math.abs(Number(form.amount));
    if (!form.account_id || !value) return;
    setSaving(true);
    try {
      await api.post('/transactions', {
        account_id: Number(form.account_id),
        date: form.date,
        description: form.description.trim() || '(no description)',
        amount: form.direction === 'out' ? -value : value,
        category_id: form.category_id ? Number(form.category_id) : null,
      });
      onSaved();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel title="Add a transaction">
      <form onSubmit={submit} className="form-grid">
        <label>
          Account
          <select required value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}>
            <option value="">Select…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </label>
        <label style={{ gridColumn: 'span 2' }}>
          Description
          <input
            placeholder="Countdown, Netflix, Salary…"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        <label>
          Type
          <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value as 'in' | 'out' })}>
            <option value="out">Money out</option>
            <option value="in">Money in</option>
          </select>
        </label>
        <label>
          Amount
          <input
            required
            type="number"
            step="0.01"
            min="0.01"
            inputMode="decimal"
            placeholder="45.00"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
          />
        </label>
        <label>
          Category
          <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
            <option value="">Auto-detect</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save transaction'}
        </button>
      </form>
    </Panel>
  );
}
