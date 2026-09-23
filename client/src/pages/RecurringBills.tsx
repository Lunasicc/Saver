import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarCheckIcon, MagnifyingGlassIcon, PlusIcon, TrashIcon, XIcon } from '@phosphor-icons/react';
import { api } from '../lib/api';
import type { Account, Category, RecurringBill, RecurringCandidate, RecurringDetectionReport } from '../lib/types';
import { formatDate, formatMoney, formatMoneyWhole, ordinal } from '../lib/format';
import { daysUntilDue, dueLabel, monthlyEquivalent } from '../lib/bills';
import { CategoryIcon } from '../components/CategoryIcon';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { Panel } from '../components/Panel';
import { SkeletonList } from '../components/Skeleton';

const FREQUENCIES = ['weekly', 'fortnightly', 'monthly', 'yearly'] as const;
const EMPTY_FORM = { name: '', amount: '', category_id: '', account_id: '', due_day: '1', frequency: 'monthly' };

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Confidence({ value }: { value: number }) {
  if (value >= 0.85) return <span className="chip chip--accent">High</span>;
  if (value >= 0.6) return <span className="chip chip--warning">Medium</span>;
  return <span className="chip">Low</span>;
}

export function RecurringBills() {
  const [bills, setBills] = useState<RecurringBill[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const [detection, setDetection] = useState<RecurringDetectionReport | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [applying, setApplying] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api
      .get<RecurringBill[]>('/recurring-bills')
      .then(setBills)
      .catch((err: Error) => {
        setBills([]);
        setError(err.message);
      });
  }, []);

  useEffect(() => {
    api
      .get<Category[]>('/categories')
      .then((c) => setCategories([...c].sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => setCategories([]));
    api.get<Account[]>('/accounts').then(setAccounts).catch(() => setAccounts([]));
    load();
  }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post('/recurring-bills', {
        name: form.name,
        amount: Number(form.amount),
        category_id: form.category_id ? Number(form.category_id) : null,
        account_id: form.account_id ? Number(form.account_id) : null,
        due_day: Number(form.due_day),
        frequency: form.frequency,
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDelete(id: number) {
    try {
      await api.del(`/recurring-bills/${id}`);
      setBills((list) => list?.filter((b) => b.id !== id) ?? null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function runDetection() {
    setDetecting(true);
    setError(null);
    try {
      const report = await api.get<RecurringDetectionReport>('/recurring-bills/detect?months=12');
      setDetection(report);
      // Pre-select confident, not-yet-tracked candidates.
      setSelected(
        Object.fromEntries(
          report.candidates.filter((c) => !c.already_tracked && c.confidence >= 0.6).map((c) => [c.name, true])
        )
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDetecting(false);
    }
  }

  async function applyDetection() {
    if (!detection) return;
    const chosen = detection.candidates.filter((c) => selected[c.name]);
    if (chosen.length === 0) return;
    setApplying(true);
    try {
      await api.post('/recurring-bills/detect/apply', {
        bills: chosen.map((c) => ({
          name: c.name,
          amount: c.amount,
          frequency: c.frequency,
          due_day: Math.min(28, Math.max(1, c.due_day)),
          category_id: c.category_id,
          account_id: c.account_id,
        })),
      });
      setDetection(null);
      setSelected({});
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApplying(false);
    }
  }

  function toggle(c: RecurringCandidate) {
    setSelected((prev) => ({ ...prev, [c.name]: !prev[c.name] }));
  }

  const active = (bills ?? []).filter((b) => b.active);
  const totalMonthly = active.reduce((s, b) => s + monthlyEquivalent(b.amount, b.frequency), 0);
  const ordered = (bills ?? [])
    .map((b) => ({ ...b, days: daysUntilDue(b) }))
    .sort((a, b) => (a.days ?? 99) - (b.days ?? 99) || b.amount - a.amount);
  const selectedCandidates = detection?.candidates.filter((c) => selected[c.name]) ?? [];
  const selectedMonthly = selectedCandidates.reduce((s, c) => s + monthlyEquivalent(c.amount, c.frequency), 0);

  return (
    <div className="stack">
      <div className="section-head" style={{ marginBottom: 0, alignItems: 'center' }}>
        <div>
          <h2 className="section-title">Bills</h2>
          <p className="section-sub">
            {active.length > 0 ? (
              <>
                About <strong className="num" style={{ color: 'var(--text)' }}>{formatMoneyWhole(totalMonthly)}</strong> a
                month is already committed across {active.length} bill{active.length === 1 ? '' : 's'}.
              </>
            ) : (
              'Track the regular charges you can’t avoid, so you know what’s coming.'
            )}
          </p>
        </div>
        <div className="row">
          <button
            className={`btn ${detection ? 'btn-ghost' : 'btn-secondary'}`}
            onClick={() => (detection ? setDetection(null) : runDetection())}
            disabled={detecting}
          >
            {detection ? <XIcon size={15} /> : <MagnifyingGlassIcon size={15} />}
            {detecting ? 'Scanning…' : detection ? 'Hide results' : 'Find recurring charges'}
          </button>
          <button className="btn btn-primary" onClick={() => setShowForm((s) => !s)} aria-expanded={showForm}>
            {showForm ? <XIcon size={15} weight="bold" /> : <PlusIcon size={15} weight="bold" />}
            {showForm ? 'Close' : 'Add bill'}
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}

      <AnimatePresence initial={false}>
        {detection && (
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
                  <h2 className="panel-title">
                    Found {detection.detected} recurring charge{detection.detected === 1 ? '' : 's'}
                  </h2>
                  <p className="small muted" style={{ marginTop: 4 }}>
                    Businesses you’ve paid on a regular rhythm over the last {detection.months} months. Tick the ones to
                    track.
                  </p>
                </div>
              }
            >
              {detection.candidates.length === 0 ? (
                <EmptyState icon={MagnifyingGlassIcon} title="No regular patterns yet" />
              ) : (
                <>
                  <div className="list">
                    {detection.candidates.map((c) => (
                      <div
                        key={c.name}
                        className="list-row"
                        style={{ opacity: selected[c.name] || c.already_tracked ? 1 : 0.55 }}
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(selected[c.name])}
                          disabled={c.already_tracked}
                          onChange={() => toggle(c)}
                          aria-label={`Track ${c.name} as a recurring bill`}
                        />
                        <CategoryIcon name={c.category_name} color={c.category_color} size={30} />
                        <div className="list-main">
                          <div className="list-title">{c.name}</div>
                          <div className="list-meta">
                            {capitalize(c.frequency)} · seen {c.occurrences}× · last {formatDate(c.last_charged)} · next ≈{' '}
                            {formatDate(c.next_expected)}
                          </div>
                        </div>
                        {c.already_tracked ? <span className="chip">Tracked</span> : <Confidence value={c.confidence} />}
                        <span className="amount num" style={{ minWidth: 86, textAlign: 'right' }}>
                          {formatMoney(c.amount)}
                          {c.amount_varies && <div className="small faint">varies</div>}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="row" style={{ justifyContent: 'space-between', marginTop: 18 }}>
                    <span className="muted">
                      {selectedCandidates.length} selected ·{' '}
                      <strong className="num" style={{ color: 'var(--text)' }}>
                        {formatMoneyWhole(selectedMonthly)}
                      </strong>{' '}
                      a month
                    </span>
                    <button
                      className="btn btn-primary"
                      onClick={applyDetection}
                      disabled={applying || selectedCandidates.length === 0}
                    >
                      {applying
                        ? 'Adding…'
                        : `Track ${selectedCandidates.length} bill${selectedCandidates.length === 1 ? '' : 's'}`}
                    </button>
                  </div>
                </>
              )}
            </Panel>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={{ overflow: 'hidden' }}
          >
            <Panel title="Add a bill">
              <form onSubmit={handleSubmit} className="form-grid">
                <label>
                  Name
                  <input required placeholder="Netflix" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </label>
                <label>
                  Amount
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0.01"
                    inputMode="decimal"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  />
                </label>
                <label>
                  How often
                  <select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
                    {FREQUENCIES.map((f) => (
                      <option key={f} value={f}>
                        {capitalize(f)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Due day of month
                  <input type="number" min={1} max={28} value={form.due_day} onChange={(e) => setForm({ ...form, due_day: e.target.value })} />
                </label>
                <label>
                  Category
                  <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                    <option value="">None</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                {accounts.length > 1 && (
                  <label>
                    Account
                    <select value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}>
                      <option value="">None</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button className="btn btn-primary" type="submit">
                  Save bill
                </button>
              </form>
            </Panel>
          </motion.div>
        )}
      </AnimatePresence>

      <Panel flush>
        {bills === null ? (
          <div style={{ padding: 22 }}>
            <SkeletonList rows={4} />
          </div>
        ) : bills.length === 0 ? (
          <EmptyState
            icon={CalendarCheckIcon}
            title="No bills tracked yet"
            action={
              !detection && (
                <button className="btn btn-primary" onClick={runDetection} disabled={detecting}>
                  <MagnifyingGlassIcon size={15} />
                  Find them in my history
                </button>
              )
            }
          >
            Scan the last year for recurring charges and pick which to keep an eye on.
          </EmptyState>
        ) : (
          <div style={{ padding: '6px 0' }}>
            {ordered.map((b) => (
              <div key={b.id} className="tx-row bill-row" style={{ opacity: b.active ? 1 : 0.5 }}>
                <CategoryIcon name={b.category_name} color={b.category_color} />
                <div className="list-main">
                  <div className="list-title">{b.name}</div>
                  <div className="list-meta">
                    {b.frequency === 'monthly'
                      ? `${dueLabel(b.days, b.frequency)} · the ${ordinal(b.due_day)}`
                      : `${capitalize(b.frequency)} · ≈ ${formatMoneyWhole(monthlyEquivalent(b.amount, b.frequency))}/month`}
                  </div>
                </div>
                {b.days !== null && b.days <= 3 ? <span className="chip chip--warning">Soon</span> : <span />}
                <span className="tx-amount amount">{formatMoney(b.amount)}</span>
                <button className="btn btn-icon danger" aria-label={`Delete ${b.name}`} title="Delete bill" onClick={() => handleDelete(b.id)}>
                  <TrashIcon size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
