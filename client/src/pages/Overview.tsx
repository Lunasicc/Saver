import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRightIcon,
  BankIcon,
  CalendarCheckIcon,
  FileCsvIcon,
  LockSimpleIcon,
  PencilSimpleIcon,
  QuestionIcon,
  WarningIcon,
  type Icon,
} from '@phosphor-icons/react';
import { api } from '../lib/api';
import type {
  Account,
  Budget,
  CategoryHistory,
  DailySpending,
  MonthlySnapshot,
  RecurringBill,
  Summary,
  TopSpending,
  TrendPoint,
} from '../lib/types';
import { currentMonth, daysInMonth, formatMoney, formatMoneyWhole, monthLong, ordinal, today } from '../lib/format';
import { daysUntilDue, dueLabel, monthlyEquivalent } from '../lib/bills';
import { onDataChanged } from '../lib/events';
import { useAccountFocus, withAccount } from '../lib/accountFocus';
import { FocusNote } from '../components/AccountSwitcher';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { CategoryIcon } from '../components/CategoryIcon';
import { Delta } from '../components/Delta';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { MonthStepper } from '../components/MonthStepper';
import { Panel } from '../components/Panel';
import { Skeleton, SkeletonList } from '../components/Skeleton';
import { CashFlowPanel } from '../components/overview/CashFlowPanel';
import { ComparedWithUsual } from '../components/overview/ComparedWithUsual';
import { DailyHeatmap } from '../components/overview/DailyHeatmap';
import { PaceChart } from '../components/overview/PaceChart';
import { TopSpendingPanel } from '../components/overview/TopSpendingPanel';
import { WhereItWent } from '../components/overview/WhereItWent';
import { txLink, type OverviewData } from '../components/overview/shared';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** More over-budget categories than this collapse into one summary link. */
const OVER_BUDGET_INLINE = 2;

export function Overview() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('month');
  const month = requested && MONTH_RE.test(requested) && requested <= currentMonth() ? requested : currentMonth();

  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { focusId, focus } = useAccountFocus();

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
      const at = (path: string) => withAccount(path, focusId);
      const [snapshot, budgets, trends, summary, bills, accounts, top, daily, history] = await Promise.all([
        api.get<MonthlySnapshot>(at(`/reports/monthly-snapshot?month=${month}`)),
        api.get<Budget[]>(at(`/budgets?month=${month}`)),
        api.get<TrendPoint[]>(at('/reports/trends?months=36')),
        api.get<Summary>(at('/reports/summary')),
        api.get<RecurringBill[]>(at('/recurring-bills')),
        api.get<Account[]>('/accounts'),
        api.get<TopSpending>(at(`/reports/top-spending?month=${month}`)),
        api.get<DailySpending>(at(`/reports/daily?month=${month}`)),
        api.get<CategoryHistory>(at(`/reports/category-history?month=${month}&months=6`)),
      ]);
      setData({ snapshot, budgets, trends, summary, bills, top, daily, history, accountCount: accounts.length, focusId });
    } catch (err) {
      setError((err as Error).message);
    }
  }, [month, focusId]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => onDataChanged(load), [load]);

  const isCurrent = month === currentMonth();
  const loading = !data || data.snapshot.month !== month || data.focusId !== focusId;
  const lastDay = isCurrent ? Number(today().slice(8, 10)) : daysInMonth(month);

  return (
    <div>
      <header className="page-head">
        <div>
          <h1 className="page-title">Overview</h1>
          <p className="page-sub">
            {isCurrent ? 'How this month is going so far.' : `How ${monthLong(month)} played out.`}
          </p>
          <FocusNote />
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
          <Hero data={data} month={month} isCurrent={isCurrent} lastDay={lastDay} focusName={focus?.name ?? null} />
          <Attention data={data} month={month} />
          <div className="split">
            <WhereItWent data={data} month={month} />
            <TopSpendingPanel data={data} />
          </div>
          <div className="split-even">
            <DailyHeatmap data={data} lastDay={lastDay} />
            <ComparedWithUsual data={data} month={month} isCurrent={isCurrent} />
          </div>
          <div className="split">
            <CashFlowPanel trends={data.trends} month={month} onSelect={setMonth} />
            <BillsPanel bills={data.bills} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Hero: how much went out, what kind, and how that's tracking ---------- */

function Hero({
  data,
  month,
  isCurrent,
  lastDay,
  focusName,
}: {
  data: OverviewData;
  month: string;
  isCurrent: boolean;
  lastDay: number;
  focusName: string | null;
}) {
  const { snapshot, budgets, summary, daily } = data;
  const { fixed, everyday } = snapshot.split;
  const splitTotal = fixed + everyday;

  return (
    <Panel>
      <div className="hero-grid hero-grid--wide">
        <div>
          <div className="stat-label">{isCurrent ? 'Spent so far this month' : `Spent in ${monthLong(month)}`}</div>
          <div className="hero-number">
            <AnimatedNumber value={snapshot.spend} splitCents />
          </div>
          <div style={{ marginTop: 12 }}>
            <Delta value={snapshot.delta.spend} higherIsGood={false} />
          </div>

          {splitTotal > 0 && (
            <div className="split-bar-wrap">
              <div className="split-bar" role="img" aria-label={`Everyday ${formatMoneyWhole(everyday)}, bills and commitments ${formatMoneyWhole(fixed)}`}>
                <span className="split-bar-everyday" style={{ flexGrow: everyday }} />
                <span className="split-bar-fixed" style={{ flexGrow: fixed }} />
              </div>
              <div className="split-legend">
                <span>
                  <span className="legend-dot" style={{ background: 'var(--accent)' }} />
                  Everyday <strong className="num">{formatMoneyWhole(everyday)}</strong>
                </span>
                <span>
                  <span className="legend-dot" style={{ background: 'var(--chart-spend)' }} />
                  Bills &amp; commitments <strong className="num">{formatMoneyWhole(fixed)}</strong>
                </span>
              </div>
            </div>
          )}
        </div>

        <PaceChart daily={daily} lastDay={lastDay} />
      </div>

      <div className="stat-row" style={{ marginTop: 24 }}>
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
          <div className="stat-label">{focusName ? 'Balance' : 'Net worth'}</div>
          <div className={`stat-value ${summary.netWorth < 0 ? 'amount--bad' : ''}`}>{formatMoneyWhole(summary.netWorth)}</div>
          <div className="small faint" style={{ marginTop: 4 }}>
            {focusName ? `${focusName}, today` : 'Across all accounts, today'}
          </div>
        </div>
        <BudgetStat budgets={budgets} month={month} isCurrent={isCurrent} lastDay={lastDay} />
      </div>
    </Panel>
  );
}

function BudgetStat({ budgets, month, isCurrent, lastDay }: { budgets: Budget[]; month: string; isCurrent: boolean; lastDay: number }) {
  const total = budgets.reduce((s, b) => s + b.amount, 0);
  const spent = budgets.reduce((s, b) => s + b.spent, 0);
  if (total <= 0) {
    return (
      <div className="stat">
        <div className="stat-label">Budgets</div>
        <Link to="/plan" className="panel-link" style={{ marginTop: 4 }}>
          Set budgets <ArrowRightIcon size={13} weight="bold" />
        </Link>
        <div className="small faint" style={{ marginTop: 6 }}>
          Suggested from your history
        </div>
      </div>
    );
  }
  const days = daysInMonth(month);
  const timePct = lastDay / days;
  const pct = spent / total;
  const ahead = pct > timePct + 0.05;
  return (
    <Link to="/plan" className="stat stat--link">
      <div className="stat-label">Budgets</div>
      <div className="stat-value">
        {formatMoneyWhole(spent)} <span className="faint stat-of">/ {formatMoneyWhole(total)}</span>
      </div>
      <div className="bar" style={{ height: 5, marginTop: 8, overflow: 'visible' }}>
        <div
          className="bar-fill"
          style={{
            width: `${Math.min(pct, 1) * 100}%`,
            background: pct > 1 ? 'var(--danger)' : ahead ? 'var(--warning)' : 'var(--accent)',
          }}
        />
        {isCurrent && <div className="bar-marker" style={{ left: `${timePct * 100}%` }} title="Today" />}
      </div>
      <div className="small faint" style={{ marginTop: 6 }}>
        {pct > 1
          ? `${formatMoneyWhole(spent - total)} over`
          : isCurrent
            ? `${formatMoneyWhole(total - spent)} left${ahead ? ', ahead of the month' : ''}`
            : `${formatMoneyWhole(total - spent)} under`}
      </div>
    </Link>
  );
}

/* ---------- Things worth a look ---------- */

function Attention({ data, month }: { data: OverviewData; month: string }) {
  const { uncategorized } = data.snapshot;
  const over = data.budgets
    .filter((b) => Math.round(b.spent * 100) > Math.round(b.amount * 100))
    .sort((a, b) => b.spent - b.amount - (a.spent - a.amount));
  if (uncategorized.count === 0 && over.length === 0) return null;
  const overTotal = over.reduce((s, b) => s + b.spent - b.amount, 0);

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
      {over.length > OVER_BUDGET_INLINE ? (
        <Link to="/plan" className="attention-item">
          <WarningIcon size={16} weight="fill" style={{ color: 'var(--danger)' }} />
          <span>
            <strong>{over.length} categories</strong> over budget by{' '}
            <span className="amount--bad num">{formatMoneyWhole(overTotal)}</span>
            <span className="faint"> · most in {over[0].category_name}</span>
          </span>
          <ArrowRightIcon size={13} weight="bold" className="attention-arrow" />
        </Link>
      ) : (
        over.map((b) => (
          <Link key={b.id} to={txLink(month, b.category_id)} className="attention-item">
            <WarningIcon size={16} weight="fill" style={{ color: 'var(--danger)' }} />
            <span>
              <strong>{b.category_name}</strong> is over budget by{' '}
              <span className="amount--bad num">{formatMoneyWhole(b.spent - b.amount)}</span>
            </span>
            <ArrowRightIcon size={13} weight="bold" className="attention-arrow" />
          </Link>
        ))
      )}
    </div>
  );
}

/* ---------- Upcoming bills ---------- */

function BillsPanel({ bills }: { bills: RecurringBill[] }) {
  const active = bills
    .filter((b) => b.active)
    .map((b) => ({ ...b, days: daysUntilDue(b) }))
    .sort((a, b) => (a.days ?? 99) - (b.days ?? 99) || b.amount - a.amount);
  const monthly = active.reduce((s, b) => s + monthlyEquivalent(b.amount, b.frequency), 0);

  return (
    <Panel
      title="Upcoming bills"
      delay={0.3}
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
        <>
          <p className="small muted" style={{ marginTop: -8, marginBottom: 6 }}>
            <span className="num">{formatMoneyWhole(monthly)}</span> committed per month across {active.length} bill
            {active.length === 1 ? '' : 's'}.
          </p>
          <div className="list">
            {active.slice(0, 6).map((b) => (
              <div key={b.id} className="list-row">
                <CategoryIcon name={b.category_name} color={b.category_color} icon={b.category_icon} size={30} />
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
        </>
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
