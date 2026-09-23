import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  ArrowSquareOutIcon,
  ArrowsClockwiseIcon,
  BankIcon,
  CameraIcon,
  ChartLineUpIcon,
  CheckIcon,
  CreditCardIcon,
  PiggyBankIcon,
  PlugsConnectedIcon,
  PlusIcon,
  ScalesIcon,
  TrashIcon,
  TrendUpIcon,
  WalletIcon,
  XIcon,
  type Icon,
} from '@phosphor-icons/react';
import { api } from '../lib/api';
import type { Account, NetWorthSnapshot, Summary } from '../lib/types';
import { formatDate, formatMoney, formatMoneyCompact, today } from '../lib/format';
import { celebrate } from '../lib/celebrate';
import { notifyDataChanged, onDataChanged } from '../lib/events';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { ChartTooltip } from '../components/ChartTooltip';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner, SuccessNotice } from '../components/ErrorBanner';
import { Panel } from '../components/Panel';
import { Skeleton, SkeletonList } from '../components/Skeleton';

const ACCOUNT_TYPES = ['checking', 'savings', 'credit', 'loan', 'investment', 'cash', 'other'];
const TYPE_ICONS: Record<string, Icon> = {
  checking: BankIcon,
  savings: PiggyBankIcon,
  credit: CreditCardIcon,
  loan: ScalesIcon,
  investment: TrendUpIcon,
};
const EMPTY_FORM = { name: '', type: 'checking', institution: '', starting_balance: '0', is_liability: false };

type SyncResult = {
  accountsSynced: number;
  transactionsImported: number;
  transactionsUpdated?: number;
  transactionsSkipped: number;
};

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function Accounts() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [history, setHistory] = useState<NetWorthSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(() => new URLSearchParams(window.location.search).has('add'));
  const [form, setForm] = useState(EMPTY_FORM);
  const [snapping, setSnapping] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, sum, nw] = await Promise.all([
        api.get<Account[]>('/accounts'),
        api.get<Summary>('/reports/summary'),
        api.get<NetWorthSnapshot[]>('/reports/net-worth'),
      ]);
      setAccounts(list);
      setSummary(sum);
      setHistory(nw);
    } catch (err) {
      setAccounts((a) => a ?? []);
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => onDataChanged(load), [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post('/accounts', {
        name: form.name,
        type: form.type,
        institution: form.institution || null,
        starting_balance: Number(form.starting_balance) || 0,
        is_liability: form.is_liability ? 1 : 0,
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDelete(account: Account) {
    setError(null);
    try {
      // The server refuses with 409 when the account still holds transactions,
      // telling us exactly how many would be destroyed before we ask the user.
      await api.del(`/accounts/${account.id}`);
      load();
    } catch (err) {
      const message = (err as Error).message;
      if (!message.includes('confirm=true')) {
        setError(message);
        return;
      }
      if (!confirm(`${message.replace(' Re-send with ?confirm=true to proceed.', '')}\n\nDelete it anyway?`)) return;
      try {
        await api.del(`/accounts/${account.id}?confirm=true`);
        load();
        notifyDataChanged();
      } catch (retryErr) {
        setError((retryErr as Error).message);
      }
    }
  }

  async function takeSnapshot() {
    setSnapping(true);
    try {
      await api.post('/reports/net-worth/snapshot', {});
      setHistory(await api.get<NetWorthSnapshot[]>('/reports/net-worth'));
      setNotice('Saved today’s net worth to your history.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSnapping(false);
    }
  }

  const snappedToday = history.some((h) => h.date === today());

  return (
    <div>
      <header className="page-head">
        <div>
          <h1 className="page-title">Accounts</h1>
          <p className="page-sub">Everything you own and owe, and how that’s changing.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm((s) => !s)} aria-expanded={showForm}>
          {showForm ? <XIcon size={15} weight="bold" /> : <PlusIcon size={15} weight="bold" />}
          {showForm ? 'Close' : 'Add account'}
        </button>
      </header>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {notice && <SuccessNotice onDismiss={() => setNotice(null)}>{notice}</SuccessNotice>}

      <div className="stack">
        <AnimatePresence initial={false}>
          {showForm && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              style={{ overflow: 'hidden' }}
            >
              <Panel title="Add an account">
                <form onSubmit={handleSubmit} className="form-grid">
                  <label>
                    Name
                    <input required placeholder="Everyday account" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  </label>
                  <label>
                    Type
                    <select
                      value={form.type}
                      onChange={(e) =>
                        setForm({ ...form, type: e.target.value, is_liability: ['credit', 'loan'].includes(e.target.value) })
                      }
                    >
                      {ACCOUNT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {capitalize(t)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Institution
                    <input placeholder="e.g. Kiwibank" value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} />
                  </label>
                  <label>
                    Starting balance
                    <input
                      type="number"
                      step="0.01"
                      inputMode="decimal"
                      value={form.starting_balance}
                      onChange={(e) => setForm({ ...form, starting_balance: e.target.value })}
                    />
                  </label>
                  <label className="inline">
                    <input type="checkbox" checked={form.is_liability} onChange={(e) => setForm({ ...form, is_liability: e.target.checked })} />
                    Money I owe (loan or credit card)
                  </label>
                  <button className="btn btn-primary" type="submit">
                    Save account
                  </button>
                </form>
              </Panel>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="split">
          <Panel
            title="Net worth"
            action={
              <button
                className="btn btn-secondary btn-sm"
                onClick={takeSnapshot}
                disabled={snapping}
                title="Record today’s net worth in the history chart"
              >
                {snappedToday ? <CheckIcon size={14} weight="bold" /> : <CameraIcon size={14} />}
                {snapping ? 'Saving…' : snappedToday ? 'Update today' : 'Save today'}
              </button>
            }
          >
            {summary ? (
              <>
                <div className="hero-number">
                  <AnimatedNumber value={summary.netWorth} splitCents />
                </div>
                <div className="row small" style={{ gap: 18, marginTop: 12 }}>
                  <span className="muted">
                    Own <span className="num" style={{ color: 'var(--text)' }}>{formatMoney(summary.assets)}</span>
                  </span>
                  <span className="muted">
                    Owe <span className="num" style={{ color: 'var(--text)' }}>{formatMoney(summary.liabilities)}</span>
                  </span>
                </div>
              </>
            ) : (
              <>
                <Skeleton width={240} height={52} />
                <Skeleton width={200} height={12} style={{ marginTop: 14 }} />
              </>
            )}
            <NetWorthChart history={history} />
          </Panel>

          <SyncPanel onSynced={load} />
        </div>

        <Panel title="Your accounts" flush>
          {accounts === null ? (
            <div style={{ padding: 22 }}>
              <SkeletonList rows={3} />
            </div>
          ) : accounts.length === 0 ? (
            <EmptyState icon={WalletIcon} title="No accounts yet">
              Add an account, or sync your bank, to start tracking balances.
            </EmptyState>
          ) : (
            <div style={{ padding: '10px 0 6px' }}>
              {accounts.map((a) => {
                const Glyph = TYPE_ICONS[a.type] ?? WalletIcon;
                return (
                  <div key={a.id} className="tx-row">
                    <span className="cat-icon" style={{ width: 34, height: 34, background: 'var(--surface-3)', color: 'var(--text-2)' }}>
                      <Glyph size={17} weight="duotone" />
                    </span>
                    <div className="list-main">
                      <div className="list-title">{a.name}</div>
                      <div className="list-meta">{[a.institution, capitalize(a.type)].filter(Boolean).join(' · ')}</div>
                    </div>
                    {a.akahu_account_id ? (
                      <span className="chip chip--accent">
                        <ArrowsClockwiseIcon size={11} weight="bold" />
                        Synced
                      </span>
                    ) : (
                      <span className="chip">Manual</span>
                    )}
                    <span className={`tx-amount amount${a.is_liability ? ' amount--bad' : ''}`} style={{ fontSize: 15 }}>
                      <AnimatedNumber value={a.current_balance} currency={a.currency} />
                    </span>
                    <button className="btn btn-icon danger" aria-label={`Delete ${a.name}`} title="Delete account" onClick={() => handleDelete(a)}>
                      <TrashIcon size={15} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function NetWorthChart({ history }: { history: NetWorthSnapshot[] }) {
  if (history.length < 2) {
    return (
      <div className="small faint row" style={{ marginTop: 22, gap: 8 }}>
        <ChartLineUpIcon size={16} />
        {history.length === 0
          ? 'Save a snapshot now and then to chart your net worth over time.'
          : 'One snapshot saved. Save another on a later day to see the trend.'}
      </div>
    );
  }
  return (
    <div style={{ height: 200, marginTop: 22, marginLeft: -8 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={history}>
          <defs>
            <linearGradient id="nw-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => formatDate(d).replace(/ \d{4}$/, '')}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
            tick={{ fill: 'var(--text-3)', fontSize: 12 }}
          />
          <YAxis
            tickFormatter={(v: number) => formatMoneyCompact(v)}
            tickLine={false}
            axisLine={false}
            width={52}
            domain={['auto', 'auto']}
            tick={{ fill: 'var(--text-3)', fontSize: 12 }}
          />
          <Tooltip
            cursor={{ stroke: 'var(--line-strong)' }}
            content={({ active, payload }) => {
              const p = active && payload?.[0]?.payload ? (payload[0].payload as NetWorthSnapshot) : null;
              if (!p) return null;
              return (
                <ChartTooltip
                  title={formatDate(p.date)}
                  rows={[
                    { label: 'Net worth', value: formatMoney(p.net_worth), color: 'var(--accent)' },
                    { label: 'Own', value: formatMoney(p.total_assets) },
                    { label: 'Owe', value: formatMoney(p.total_liabilities) },
                  ]}
                />
              );
            }}
          />
          <Area type="monotone" dataKey="net_worth" stroke="var(--accent)" strokeWidth={2} fill="url(#nw-fill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

type AkahuStatus = { configured: boolean; source: 'env' | 'app' | null };

function SyncPanel({ onSynced }: { onSynced: () => void }) {
  const [status, setStatus] = useState<AkahuStatus | null>(null);
  const [months, setMonths] = useState(12);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<AkahuStatus>('/akahu/status')
      .then(setStatus)
      .catch(() => setStatus({ configured: false, source: null }));
  }, []);

  async function sync(range = months) {
    setSyncing(true);
    setError('');
    setResult(null);
    try {
      const res = await api.post<SyncResult>('/akahu/sync', { months: range });
      setResult(res);
      onSynced();
      notifyDataChanged();
      if (res.transactionsImported > 0) celebrate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  async function disconnect() {
    if (!confirm('Remove the saved Akahu tokens? Transactions already synced stay in the app.')) return;
    try {
      setStatus(await api.del<AkahuStatus>('/akahu/credentials'));
      setResult(null);
      notifyDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect');
    }
  }

  return (
    <Panel title="Bank connection" delay={0.05}>
      {status === null ? (
        <SkeletonList rows={2} />
      ) : !status.configured ? (
        <ConnectAkahu
          onConnected={(next) => {
            setStatus(next);
            notifyDataChanged();
            void sync(12);
          }}
        />
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="chip chip--accent">
              <span className="live-dot" aria-hidden="true" />
              Connected via Akahu
            </span>
            {status.source === 'app' ? (
              <button className="link-button small" onClick={disconnect}>
                Disconnect
              </button>
            ) : (
              <span className="muted small">Tokens from server/.env</span>
            )}
          </div>
          <p className="muted small">
            Pulls live balances and transactions from your bank. Anything already imported is skipped, so syncing again
            is always safe. The Sync button in the top bar fetches the last 3 months.
          </p>
          <div className="row">
            <select aria-label="How far back" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
              <option value={3}>Last 3 months</option>
              <option value={12}>Last 12 months</option>
              <option value={24}>Last 2 years</option>
            </select>
            <button className="btn btn-primary" onClick={() => sync()} disabled={syncing}>
              <ArrowsClockwiseIcon size={15} weight="bold" className={syncing ? 'spin' : undefined} />
              {syncing ? 'Syncing…' : 'Full sync'}
            </button>
          </div>
          {result && (
            <p role="status" className="small" style={{ color: 'var(--accent)' }}>
              {result.accountsSynced} account{result.accountsSynced === 1 ? '' : 's'} checked · {result.transactionsImported}{' '}
              new
              {result.transactionsSkipped > 0 ? ` · ${result.transactionsSkipped} already up to date` : ''}
            </p>
          )}
          {error && (
            <p role="alert" className="small amount--bad">
              {error}
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

/** First-run form: each person uses their own free Akahu personal app. */
function ConnectAkahu({ onConnected }: { onConnected: (status: AkahuStatus) => void }) {
  const [appToken, setAppToken] = useState('');
  const [userToken, setUserToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await api.put<AkahuStatus & { accounts: number }>('/akahu/credentials', {
        appToken: appToken.trim(),
        userToken: userToken.trim(),
      });
      onConnected({ configured: res.configured, source: res.source });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="stack" style={{ gap: 14 }} onSubmit={submit}>
      <p className="muted small">
        Sync balances and transactions from any NZ bank using{' '}
        <a href="https://www.akahu.nz" target="_blank" rel="noreferrer">
          Akahu
        </a>
        , a free open-banking service. Your tokens are stored only on this computer.
      </p>
      <ol className="connect-steps small">
        <li>
          Sign up at{' '}
          <a href="https://my.akahu.nz" target="_blank" rel="noreferrer">
            my.akahu.nz <ArrowSquareOutIcon size={12} />
          </a>{' '}
          and connect your bank accounts.
        </li>
        <li>
          Open <strong>Developers</strong>, accept the terms and create your personal app.
        </li>
        <li>Copy the two tokens it shows you into the boxes below.</li>
      </ol>
      <label>
        App ID Token
        <input
          className="mono"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="app_token_…"
          value={appToken}
          onChange={(e) => setAppToken(e.target.value)}
          required
        />
      </label>
      <label>
        User Access Token
        <input
          className="mono"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="user_token_…"
          value={userToken}
          onChange={(e) => setUserToken(e.target.value)}
          required
        />
      </label>
      {error && (
        <p role="alert" className="small amount--bad">
          {error}
        </p>
      )}
      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={saving || !appToken || !userToken}>
          <PlugsConnectedIcon size={15} weight="bold" />
          {saving ? 'Checking…' : 'Connect and sync'}
        </button>
      </div>
    </form>
  );
}
