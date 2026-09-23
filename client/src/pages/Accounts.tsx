import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  ArrowsClockwiseIcon,
  BankIcon,
  CameraIcon,
  ChartLineUpIcon,
  CheckIcon,
  CreditCardIcon,
  PiggyBankIcon,
  PlusIcon,
  ScalesIcon,
  TrashIcon,
  TrendUpIcon,
  WalletIcon,
  WarningCircleIcon,
  type Icon,
} from '@phosphor-icons/react';
import { api } from '../lib/api';
import type { Account, NetWorthSnapshot, Summary } from '../lib/types';
import type { AkahuStatus } from '../lib/akahu';
import { formatDate, formatMoney, formatMoneyCompact, today } from '../lib/format';
import { notifyDataChanged, onDataChanged } from '../lib/events';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { ChartTooltip } from '../components/ChartTooltip';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner, SuccessNotice } from '../components/ErrorBanner';
import { Panel } from '../components/Panel';
import { Skeleton, SkeletonList } from '../components/Skeleton';
import { ConnectionsHub } from '../components/bank/ConnectionsHub';
import { SetupWizard } from '../components/bank/SetupWizard';
import { AddAccountDialog, type AddMode } from '../components/bank/AddAccountDialog';

const TYPE_ICONS: Record<string, Icon> = {
  checking: BankIcon,
  savings: PiggyBankIcon,
  credit: CreditCardIcon,
  loan: ScalesIcon,
  investment: TrendUpIcon,
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
  const [snapping, setSnapping] = useState(false);
  const [akahu, setAkahu] = useState<AkahuStatus | null>(null);
  const [addMode, setAddMode] = useState<AddMode | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [connectRequest, setConnectRequest] = useState(0);
  const [params, setParams] = useSearchParams();

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

  const loadStatus = useCallback(async () => {
    try {
      setAkahu(await api.get<AkahuStatus>('/akahu/status'));
    } catch {
      setAkahu({ configured: false, source: null, lastSyncAt: null, autoSync: true });
    }
  }, []);

  useEffect(() => {
    load();
    loadStatus();
  }, [load, loadStatus]);
  useEffect(() => onDataChanged(load), [load]);

  const handleStatusChange = useCallback((next: AkahuStatus) => {
    setAkahu({ configured: next.configured, source: next.source, lastSyncAt: next.lastSyncAt, autoSync: next.autoSync });
  }, []);

  const connectBank = useCallback(() => {
    if (akahu?.configured) setConnectRequest((n) => n + 1);
    else setWizardOpen(true);
  }, [akahu?.configured]);

  // Deep links from the welcome screen and import page: ?add=1 | bank | csv | manual.
  const addParam = params.get('add');
  useEffect(() => {
    if (!addParam || akahu === null) return;
    if (addParam === 'bank') {
      if (akahu.configured) document.getElementById('bank-connections')?.scrollIntoView({ behavior: 'smooth' });
      else setWizardOpen(true);
    } else {
      setAddMode(addParam === 'csv' || addParam === 'manual' ? addParam : 'choose');
    }
    setParams(
      (p) => {
        p.delete('add');
        return p;
      },
      { replace: true }
    );
  }, [addParam, akahu, setParams]);

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
          <p className="page-sub">Your banks, everything you own and owe, and how that’s changing.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setAddMode('choose')}>
          <PlusIcon size={15} weight="bold" />
          Add account
        </button>
      </header>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {notice && <SuccessNotice onDismiss={() => setNotice(null)}>{notice}</SuccessNotice>}

      <div className="stack">
        <div id="bank-connections">
          <ConnectionsHub
            status={akahu}
            onStatusChange={handleStatusChange}
            onSetup={() => setWizardOpen(true)}
            connectRequest={connectRequest}
          />
        </div>

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

          <Panel title="Your accounts" flush>
            {accounts === null ? (
              <div style={{ padding: 22 }}>
                <SkeletonList rows={3} />
              </div>
            ) : accounts.length === 0 ? (
              <EmptyState
                icon={WalletIcon}
                title="No accounts yet"
                action={
                  <button className="btn btn-secondary btn-sm" onClick={() => setAddMode('choose')}>
                    <PlusIcon size={14} weight="bold" /> Add account
                  </button>
                }
              >
                Connect a bank, import a statement or add one by hand.
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
                        <div className="list-meta">
                          {[a.institution, capitalize(a.type), a.account_mask ? `•• ${a.account_mask}` : null].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      {a.akahu_account_id ? (
                        a.akahu_status === 'INACTIVE' ? (
                          <span className="chip chip--warning" title="Akahu lost access to this bank. Reconnect it above.">
                            <WarningCircleIcon size={11} weight="fill" />
                            Reconnect
                          </span>
                        ) : (
                          <span className="chip chip--accent">
                            <ArrowsClockwiseIcon size={11} weight="bold" />
                            Synced
                          </span>
                        )
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

      <AddAccountDialog
        open={addMode !== null}
        mode={addMode ?? 'choose'}
        onModeChange={setAddMode}
        onClose={() => setAddMode(null)}
        onConnectBank={connectBank}
        onCreated={load}
      />
      <SetupWizard open={wizardOpen} onClose={() => setWizardOpen(false)} status={akahu} onStatusChange={handleStatusChange} />
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

