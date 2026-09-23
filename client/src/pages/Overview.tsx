import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  ArrowRightIcon,
  BankIcon,
  CalendarCheckIcon,
  ChartBarIcon,
  FileCsvIcon,
  LockSimpleIcon,
  PencilSimpleIcon,
  QuestionIcon,
  StorefrontIcon,
  WarningIcon,
  type Icon,
} from '@phosphor-icons/react';
import { api } from '../lib/api';
import type { Account, Budget, MonthlySnapshot, RecurringBill, Summary, TrendPoint } from '../lib/types';
import {
  currentMonth,
  daysInMonth,
  formatMoney,
  formatMoneyCompact,
  formatMoneyWhole,
  monthLong,
  monthShort,
  ordinal,
  shiftMonth,
  today,
} from '../lib/format';
import { daysUntilDue, dueLabel, monthlyEquivalent } from '../lib/bills';
import { onDataChanged } from '../lib/events';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { CategoryIcon } from '../components/CategoryIcon';
import { ChartTooltip } from '../components/ChartTooltip';
import { Delta } from '../components/Delta';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { MonthStepper } from '../components/MonthStepper';
import { Panel } from '../components/Panel';
import { Skeleton, SkeletonList } from '../components/Skeleton';

type Data = {
  snapshot: MonthlySnapshot;
  budgets: Budget[];
  trends: TrendPoint[];
  summary: Summary;
  bills: RecurringBill[];
  accountCount: number;
};

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MERCHANTS_COLLAPSED = 8;

function txLink(month: string, category: number | 'uncategorized') {
  return `/transactions?month=${month}&category=${category}`;
}

export function Overview() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('month');
  const month = requested && MONTH_RE.test(requested) && requested <= currentMonth() ? requested : currentMonth();

  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAllMerchants, setShowAllMerchants] = useState(false);

  const setMonth = useCallback(
    (next: string) => {
      const p = new URLSearchParams(params);
      if (next === currentMonth()) p.delete('month');
      else p.set('month', next);
      setParams(p, { replace: true });
    },
    [params, setParams]
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const [snapshot, budgets, trends, summary, bills, accounts] = await Promise.all([
        api.get<MonthlySnapshot>(`/reports/monthly-snapshot?month=${month}`),
        api.get<Budget[]>(`/budgets?month=${month}`),
        api.get<TrendPoint[]>('/reports/trends?months=36'),
        api.get<Summary>('/reports/summary'),
        api.get<RecurringBill[]>('/recurring-bills'),
        api.get<Account[]>('/accounts'),
      ]);
      setData({ snapshot, budgets, trends, summary, bills, accountCount: accounts.length });
    } catch (err) {
      setError((err as Error).message);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => onDataChanged(load), [load]);

  const isCurrent = month === currentMonth();
  const loading = !data || data.snapshot.month !== month;

  return (
    <div>
      <header className="page-head">
        <div>
          <h1 className="page-title">Overview</h1>
          <p className="page-sub">
            {isCurrent ? 'How this month is going so far.' : `How ${monthLong(month)} played out.`}
          </p>
        </div>
        <MonthStepper month={month} onChange={setMonth} />
      </header>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {!data ? (
        !error && <OverviewSkeleton />
      ) : data.accountCount === 0 ? (
        <Welcome />
      ) : (
        <div className="stack" style={{ opacity: loading ? 0.55 : 1, transition: 'opacity 0.2s ease' }}>
          <Hero data={data} month={month} isCurrent={isCurrent} />
          <Attention data={data} month={month} />
          <div className="split">
            <CategoriesPanel data={data} month={month} />
            <MerchantsPanel
              data={data}
              showAll={showAllMerchants}
              onToggle={() => setShowAllMerchants((v) => !v)}
            />
          </div>
          <div className="split">
            <CashFlowPanel data={data} month={month} onSelect={setMonth} />
            <BillsPanel bills={data.bills} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Hero: how much went out, and how that's tracking ---------- */

function Hero({ data, month, isCurrent }: { data: Data; month: string; isCurrent: boolean }) {
  const { snapshot, budgets, summary, bills } = data;
  const budgetTotal = budgets.reduce((s, b) => s + b.amount, 0);
  const budgetSpent = budgets.reduce((s, b) => s + b.spent, 0);
  const monthlyBills = bills.filter((b) => b.active).reduce((s, b) => s + monthlyEquivalent(b.amount, b.frequency), 0);
  const days = daysInMonth(month);
  const dayOfMonth = isCurrent ? Number(today().slice(8, 10)) : days;
  const timePct = dayOfMonth / days;
  const spentPct = budgetTotal > 0 ? budgetSpent / budgetTotal : 0;
  const ahead = spentPct > timePct + 0.05;

  return (
    <Panel>
      <div className="hero-grid">
        <div>
          <div className="stat-label">{isCurrent ? 'Spent so far this month' : `Spent in ${monthLong(month)}`}</div>
          <div className="hero-number">
            <AnimatedNumber value={snapshot.spend} splitCents />
          </div>
          <div style={{ marginTop: 12 }}>
            <Delta value={snapshot.delta.spend} higherIsGood={false} />
          </div>
        </div>

        {budgetTotal > 0 ? (
          <div className="hero-pace">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="stat-label" style={{ margin: 0 }}>
                Budgeted categories
              </span>
              <span className="small num">
                {formatMoneyWhole(budgetSpent)} <span className="faint">of {formatMoneyWhole(budgetTotal)}</span>
              </span>
            </div>
            <div className="bar" style={{ height: 8, marginTop: 10, overflow: 'visible' }}>
              <div
                className="bar-fill"
                style={{
                  width: `${Math.min(spentPct, 1) * 100}%`,
                  background: spentPct > 1 ? 'var(--danger)' : ahead ? 'var(--warning)' : 'var(--accent)',
                }}
              />
              {isCurrent && <div className="bar-marker" style={{ left: `${timePct * 100}%` }} title="Today" />}
            </div>
            <p className="small muted" style={{ marginTop: 10 }}>
              {spentPct > 1
                ? `Over budget by ${formatMoneyWhole(budgetSpent - budgetTotal)}.`
                : isCurrent
                  ? `${formatMoneyWhole(budgetTotal - budgetSpent)} left with ${days - dayOfMonth} day${days - dayOfMonth === 1 ? '' : 's'} to go${ahead ? ' — spending faster than the month.' : '.'}`
                  : `Finished ${formatMoneyWhole(budgetTotal - budgetSpent)} under budget.`}
            </p>
          </div>
        ) : (
          <div className="hero-pace">
            <p className="small muted">No budgets for this month.</p>
            <Link to="/plan" className="panel-link" style={{ marginTop: 6 }}>
              Set budgets from your history <ArrowRightIcon size={13} weight="bold" />
            </Link>
          </div>
        )}
      </div>

      <div className="stat-row" style={{ marginTop: 26 }}>
        <div className="stat">
          <div className="stat-label">Money in</div>
          <div className="stat-value amount--in">{formatMoneyWhole(snapshot.income)}</div>
          <div style={{ marginTop: 4 }}>
            <Delta value={snapshot.delta.income} higherIsGood suffix="" />
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Net</div>
          <div className={`stat-value ${snapshot.net < 0 ? 'amount--bad' : ''}`}>
            {snapshot.net > 0 ? '+' : snapshot.net < 0 ? '−' : ''}
            {formatMoneyWhole(Math.abs(snapshot.net))}
          </div>
          <div className="small faint" style={{ marginTop: 4 }}>
            {snapshot.net >= 0 ? 'Kept this month' : 'More out than in'}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Net worth</div>
          <div className="stat-value">{formatMoneyWhole(summary.netWorth)}</div>
          <div className="small faint" style={{ marginTop: 4 }}>
            Across all accounts, today
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Bills</div>
          <div className="stat-value">{monthlyBills > 0 ? formatMoneyWhole(monthlyBills) : '—'}</div>
          <div className="small faint" style={{ marginTop: 4 }}>
            {monthlyBills > 0 ? 'Committed per month' : 'None tracked yet'}
          </div>
        </div>
      </div>
    </Panel>
  );
}

/* ---------- Things worth a look ---------- */

function Attention({ data, month }: { data: Data; month: string }) {
  const { uncategorized } = data.snapshot;
  const over = data.budgets.filter((b) => Math.round(b.spent * 100) > Math.round(b.amount * 100));
  if (uncategorized.count === 0 && over.length === 0) return null;

  return (
    <div className="attention">
      {uncategorized.count > 0 && (
        <Link to={txLink(month, 'uncategorized')} className="attention-item">
          <QuestionIcon size={16} weight="bold" style={{ color: 'var(--warning)' }} />
          <span>
            <strong>{uncategorized.count}</strong> uncategorized transaction{uncategorized.count === 1 ? '' : 's'}{' '}
            <span className="faint">· {formatMoney(uncategorized.total)}</span>
          </span>
          <ArrowRightIcon size={13} weight="bold" className="attention-arrow" />
        </Link>
      )}
      {over.map((b) => (
        <Link key={b.id} to={txLink(month, b.category_id)} className="attention-item">
          <WarningIcon size={16} weight="fill" style={{ color: 'var(--danger)' }} />
          <span>
            <strong>{b.category_name}</strong> is over budget by{' '}
            <span className="amount--bad num">{formatMoneyWhole(b.spent - b.amount)}</span>
          </span>
          <ArrowRightIcon size={13} weight="bold" className="attention-arrow" />
        </Link>
      ))}
    </div>
  );
}

/* ---------- Where it went: by category ---------- */

function CategoriesPanel({ data, month }: { data: Data; month: string }) {
  const { categories, uncategorized, spend } = data.snapshot;
  const budgetByCategory = new Map(data.budgets.map((b) => [b.category_id, b.amount]));
  const max = Math.max(...categories.map((c) => c.total), uncategorized.total, 1);

  return (
    <Panel
      title="Where it went"
      action={
        <Link to={`/transactions?month=${month}`} className="panel-link">
          All transactions <ArrowRightIcon size={13} weight="bold" />
        </Link>
      }
      delay={0.05}
    >
      {categories.length === 0 && uncategorized.count === 0 ? (
        <EmptyState icon={ChartBarIcon} title="No spending this month">
          Nothing has gone out in {monthLong(month)} yet.
        </EmptyState>
      ) : (
        <div className="list">
          {categories.map((c) => {
            const budget = budgetByCategory.get(c.category_id);
            const pct = budget ? c.total / budget : c.total / max;
            const over = budget !== undefined && Math.round(c.total * 100) > Math.round(budget * 100);
            return (
              <Link key={c.category_id} to={txLink(month, c.category_id)} className="list-row list-row--link">
                <CategoryIcon name={c.name} color={c.color} />
                <div className="list-main">
                  <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                    <span className="list-title">{c.name}</span>
                    <span className="amount num">{formatMoney(c.total)}</span>
                  </div>
                  <div className="bar" style={{ margin: '7px 0 6px' }}>
                    <div
                      className="bar-fill"
                      style={{
                        width: `${Math.min(pct, 1) * 100}%`,
                        background: over ? 'var(--danger)' : budget ? 'var(--accent)' : c.color,
                        opacity: budget ? 1 : 0.85,
                      }}
                    />
                  </div>
                  <div className="list-meta">
                    {c.count} transaction{c.count === 1 ? '' : 's'} · {Math.round(c.pct * 100)}% of spend
                    {budget !== undefined && (
                      <span className={over ? 'amount--bad' : undefined}>
                        {' '}
                        · {over ? 'over' : 'of'} {formatMoneyWhole(budget)} budget
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
          {uncategorized.count > 0 && (
            <Link to={txLink(month, 'uncategorized')} className="list-row list-row--link">
              <CategoryIcon name={null} />
              <div className="list-main">
                <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                  <span className="list-title">Uncategorized</span>
                  <span className="amount num">{formatMoney(uncategorized.total)}</span>
                </div>
                <div className="bar" style={{ margin: '7px 0 6px' }}>
                  <div
                    className="bar-fill"
                    style={{ width: `${(uncategorized.total / max) * 100}%`, background: 'var(--warning)' }}
                  />
                </div>
                <div className="list-meta">
                  {uncategorized.count} to sort · {spend > 0 ? Math.round((uncategorized.total / spend) * 100) : 0}% of
                  spend
                </div>
              </div>
            </Link>
          )}
        </div>
      )}
    </Panel>
  );
}

/* ---------- Top businesses ---------- */

function MerchantsPanel({ data, showAll, onToggle }: { data: Data; showAll: boolean; onToggle: () => void }) {
  const { merchants } = data.snapshot;
  const shown = showAll ? merchants : merchants.slice(0, MERCHANTS_COLLAPSED);

  return (
    <Panel
      title="Top businesses"
      delay={0.1}
      action={merchants.length > 0 && <span className="small faint">{merchants.length} places</span>}
    >
      {merchants.length === 0 ? (
        <EmptyState icon={StorefrontIcon} title="No businesses yet" />
      ) : (
        <>
          <div className="list">
            {shown.map((m, i) => (
              <div key={m.merchant} className="list-row">
                <span className="rank">{i + 1}</span>
                <div className="list-main">
                  <div className="list-title">{m.merchant}</div>
                  <div className="list-meta">
                    {m.count} visit{m.count === 1 ? '' : 's'}
                    {m.count > 1 && ` · avg ${formatMoney(m.total / m.count)}`}
                  </div>
                </div>
                <span className="amount num">{formatMoney(m.total)}</span>
              </div>
            ))}
          </div>
          {merchants.length > MERCHANTS_COLLAPSED && (
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 12, width: '100%' }} onClick={onToggle}>
              {showAll ? 'Show fewer' : `Show all ${merchants.length}`}
            </button>
          )}
        </>
      )}
    </Panel>
  );
}

/* ---------- 12-month cash flow ---------- */

type CashPoint = TrendPoint & { label: string };

function CashFlowPanel({ data, month, onSelect }: { data: Data; month: string; onSelect: (m: string) => void }) {
  const series = useMemo<CashPoint[]>(() => {
    const byMonth = new Map(data.trends.map((t) => [t.month, t]));
    // Window ends at the current month, or at the selected month if that's older than a year.
    const end = currentMonth() > shiftMonth(month, 11) ? month : currentMonth();
    return Array.from({ length: 12 }, (_, i) => {
      const m = shiftMonth(end, i - 11);
      const t = byMonth.get(m);
      return { month: m, label: monthShort(m), income: t?.income ?? 0, spend: t?.spend ?? 0 };
    });
  }, [data.trends, month]);

  const withData = series.filter((p) => p.income > 0 || p.spend > 0);
  const avgSpend = withData.length ? withData.reduce((s, p) => s + p.spend, 0) / withData.length : 0;

  return (
    <Panel
      title="Cash flow"
      delay={0.15}
      action={
        <div className="legend">
          <span>
            <span className="legend-dot" style={{ background: 'var(--accent)' }} />
            In
          </span>
          <span>
            <span className="legend-dot" style={{ background: 'var(--chart-spend)' }} />
            Out
          </span>
        </div>
      }
    >
      {withData.length === 0 ? (
        <EmptyState icon={ChartBarIcon} title="No history yet" />
      ) : (
        <>
          <p className="small muted" style={{ marginTop: -8, marginBottom: 14 }}>
            Averaging <span className="num">{formatMoneyWhole(avgSpend)}</span> out per month. Click a month to jump
            to it.
          </p>
          <div style={{ height: 230, marginLeft: -8 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series} barGap={3} barCategoryGap="24%">
                <CartesianGrid vertical={false} stroke="var(--line)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--text-3)', fontSize: 12 }} />
                <YAxis
                  tickFormatter={(v: number) => formatMoneyCompact(v)}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  tick={{ fill: 'var(--text-3)', fontSize: 12 }}
                />
                <Tooltip
                  cursor={{ fill: 'var(--surface-2)' }}
                  content={({ active, payload }) => {
                    const p = active && payload?.[0]?.payload ? (payload[0].payload as CashPoint) : null;
                    if (!p) return null;
                    return (
                      <ChartTooltip
                        title={monthLong(p.month)}
                        rows={[
                          { label: 'In', value: formatMoney(p.income), color: 'var(--accent)' },
                          { label: 'Out', value: formatMoney(p.spend), color: 'var(--chart-spend)' },
                          { label: 'Net', value: formatMoney(p.income - p.spend) },
                        ]}
                      />
                    );
                  }}
                />
                <Bar dataKey="income" radius={[4, 4, 0, 0]} onClick={(_, i) => onSelect(series[i].month)} cursor="pointer">
                  {series.map((p) => (
                    <Cell key={p.month} fill="var(--accent)" fillOpacity={p.month === month ? 1 : 0.35} />
                  ))}
                </Bar>
                <Bar dataKey="spend" radius={[4, 4, 0, 0]} onClick={(_, i) => onSelect(series[i].month)} cursor="pointer">
                  {series.map((p) => (
                    <Cell key={p.month} fill="var(--chart-spend)" fillOpacity={p.month === month ? 1 : 0.4} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Panel>
  );
}

/* ---------- Upcoming bills ---------- */

function BillsPanel({ bills }: { bills: RecurringBill[] }) {
  const active = bills
    .filter((b) => b.active)
    .map((b) => ({ ...b, days: daysUntilDue(b) }))
    .sort((a, b) => (a.days ?? 99) - (b.days ?? 99) || b.amount - a.amount);

  return (
    <Panel
      title="Upcoming bills"
      delay={0.2}
      action={
        active.length > 0 && (
          <Link to="/plan?tab=bills" className="panel-link">
            Manage <ArrowRightIcon size={13} weight="bold" />
          </Link>
        )
      }
    >
      {active.length === 0 ? (
        <EmptyState
          icon={CalendarCheckIcon}
          title="No bills tracked"
          action={
            <Link to="/plan?tab=bills" className="btn btn-secondary btn-sm">
              Find them in my history
            </Link>
          }
        >
          Spot your regular charges automatically so you always know what's coming.
        </EmptyState>
      ) : (
        <div className="list">
          {active.slice(0, 6).map((b) => (
            <div key={b.id} className="list-row">
              <CategoryIcon name={b.category_name} color={b.category_color} size={30} />
              <div className="list-main">
                <div className="list-title">{b.name}</div>
                <div className="list-meta">
                  {b.frequency === 'monthly' ? `${dueLabel(b.days, b.frequency)} · ${ordinal(b.due_day)}` : dueLabel(null, b.frequency)}
                </div>
              </div>
              <span className="amount num">{formatMoney(b.amount)}</span>
            </div>
          ))}
          {active.length > 6 && <div className="small faint" style={{ paddingTop: 10 }}>+{active.length - 6} more</div>}
        </div>
      )}
    </Panel>
  );
}

/* ---------- First run: nothing to show yet ---------- */

const START_OPTIONS: { to: string; icon: Icon; title: string; body: string; cta: string; primary?: boolean }[] = [
  {
    to: '/accounts?add=bank',
    icon: BankIcon,
    title: 'Connect your bank',
    body: 'Sync balances and transactions automatically from any NZ bank. Saver walks you through it in about three minutes.',
    cta: 'Connect',
    primary: true,
  },
  {
    to: '/accounts?add=csv',
    icon: FileCsvIcon,
    title: 'Import a statement',
    body: 'Upload a CSV export from your internet banking.',
    cta: 'Import',
  },
  {
    to: '/accounts?add=manual',
    icon: PencilSimpleIcon,
    title: 'Track it by hand',
    body: 'Create an account and enter transactions yourself. Cash, savings jars, anything.',
    cta: 'Start manually',
  },
];

function Welcome() {
  return (
    <div className="stack">
      <Panel className="panel--accent welcome">
        <h2 className="welcome-title">Welcome. Let's find out where your money goes.</h2>
        <p className="muted">
          Everything is stored in a database file on this computer. Nothing is uploaded anywhere, and there are no
          accounts to sign up for.
        </p>
        <p className="welcome-privacy small">
          <LockSimpleIcon size={14} weight="bold" /> Runs locally on your machine only
        </p>
      </Panel>
      <div className="welcome-grid">
        {START_OPTIONS.map(({ to, icon: Glyph, title, body, cta, primary }) => (
          <Link key={title} to={to} className="panel welcome-card">
            <span className="empty-icon">
              <Glyph size={22} weight="duotone" />
            </span>
            <div className="welcome-card-title">{title}</div>
            <p className="muted small">{body}</p>
            <span className={`btn ${primary ? 'btn-primary' : 'btn-secondary'}`}>
              {cta} <ArrowRightIcon size={14} weight="bold" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="stack">
      <div className="panel">
        <Skeleton width={140} height={12} />
        <Skeleton width={260} height={52} style={{ marginTop: 14 }} />
        <Skeleton width={180} height={12} style={{ marginTop: 16 }} />
        <div className="stat-row" style={{ marginTop: 26, paddingTop: 18, gap: 20 }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={40} />
          ))}
        </div>
      </div>
      <div className="split">
        <div className="panel">
          <SkeletonList rows={6} />
        </div>
        <div className="panel">
          <SkeletonList rows={6} />
        </div>
      </div>
    </div>
  );
}
