import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowsClockwiseIcon,
  BankIcon,
  CloudArrowDownIcon,
  CreditCardIcon,
  LockSimpleIcon,
  PiggyBankIcon,
  PlugsConnectedIcon,
  PlusIcon,
  ScalesIcon,
  SparkleIcon,
  TrendUpIcon,
  WalletIcon,
  WarningCircleIcon,
  type Icon,
} from '@phosphor-icons/react';
import { api } from '../../lib/api';
import {
  AKAHU_URLS,
  allAccounts,
  describeSync,
  type AkahuStatus,
  type BankConnection,
  type ConnectionAccount,
  type ConnectionsResponse,
  type SyncResult,
} from '../../lib/akahu';
import { formatMoney, timeAgo } from '../../lib/format';
import { celebrate } from '../../lib/celebrate';
import { notifyDataChanged, onDataChanged } from '../../lib/events';
import { useAkahuPopup } from '../../lib/useAkahuPopup';
import { Panel } from '../Panel';
import { SkeletonList } from '../Skeleton';
import { BankLogo, PopupHint, Switch } from './parts';

const TYPE_ICONS: Record<string, Icon> = {
  checking: BankIcon,
  savings: PiggyBankIcon,
  credit: CreditCardIcon,
  loan: ScalesIcon,
  investment: TrendUpIcon,
};

const REFRESH_POLL_MS = 6000;
const REFRESH_TIMEOUT_MS = 90000;

type Busy = null | 'sync' | 'refresh';
type Message = { tone: 'ok' | 'bad' | 'info'; text: string };

type Props = {
  status: AkahuStatus | null;
  onStatusChange: (status: AkahuStatus) => void;
  onSetup: () => void;
  /** Bumped by the page to start "connect another bank" from elsewhere (e.g. the Add dialog). */
  connectRequest: number;
};

/** Every bank connection in one place: health, freshness, what's included, and sync controls. */
export function ConnectionsHub({ status, onStatusChange, onSetup, connectRequest }: Props) {
  const [connections, setConnections] = useState<BankConnection[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const popup = useAkahuPopup();
  const configured = Boolean(status?.configured);

  const load = useCallback(async () => {
    try {
      const res = await api.get<ConnectionsResponse>('/akahu/connections');
      setConnections(res.connections);
      setLoadError('');
      onStatusChange(res);
      return res;
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not reach Akahu');
      setConnections((c) => c ?? []);
      return null;
    }
  }, [onStatusChange]);

  useEffect(() => {
    if (configured) void load();
    else setConnections(null);
  }, [configured, load]);

  // Syncs and imports elsewhere (wizard, top bar) change what's included and when we last synced.
  useEffect(() => (configured ? onDataChanged(() => void load()) : undefined), [configured, load]);

  const sync = useCallback(async () => {
    setBusy('sync');
    setMessage(null);
    try {
      const res = await api.post<SyncResult>('/akahu/sync', {});
      setMessage({ tone: 'ok', text: describeSync(res) });
      if (res.transactionsImported > 0) celebrate();
      // Also reloads this hub through its onDataChanged subscription.
      notifyDataChanged();
    } catch (err) {
      setMessage({ tone: 'bad', text: err instanceof Error ? err.message : 'Sync failed' });
    } finally {
      setBusy(null);
    }
  }, [load]);

  // Ask the banks for fresh data, wait until Akahu reports it, then sync.
  const refreshingRef = useRef(false);
  async function refreshFromBank() {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setBusy('refresh');
    setMessage({ tone: 'info', text: 'Asking your banks for the latest data. This usually takes under a minute…' });
    try {
      const before = latestRefresh(connections ?? []);
      await api.post('/akahu/refresh', {});
      const started = Date.now();
      let fresh = false;
      while (Date.now() - started < REFRESH_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, REFRESH_POLL_MS));
        const res = await api.get<ConnectionsResponse>('/akahu/connections');
        setConnections(res.connections);
        if (latestRefresh(res.connections) > before) {
          fresh = true;
          break;
        }
      }
      if (!fresh) {
        setMessage({
          tone: 'info',
          text: 'Your banks were refreshed recently. Akahu updates personal apps at most once an hour. Syncing what’s there now.',
        });
      }
      refreshingRef.current = false;
      await sync();
      if (!fresh) setMessage((m) => (m?.tone === 'ok' ? { ...m, text: `${m.text} · no newer bank data yet` } : m));
    } catch (err) {
      setMessage({ tone: 'bad', text: err instanceof Error ? err.message : 'Refresh failed' });
      setBusy(null);
    } finally {
      refreshingRef.current = false;
    }
  }

  async function toggleAccount(account: ConnectionAccount, included: boolean) {
    setConnections((list) =>
      (list ?? []).map((c) => ({
        ...c,
        accounts: c.accounts.map((a) => (a.akahuId === account.akahuId ? { ...a, included, isNew: false } : a)),
      }))
    );
    try {
      await api.patch('/akahu/accounts', { changes: [{ akahuId: account.akahuId, included }] });
      if (included && !account.localAccountId) {
        setMessage({ tone: 'info', text: `${account.name} will be imported on the next sync.` });
      } else if (!included) {
        setMessage({ tone: 'info', text: `${account.name} won't sync any more. Its existing transactions stay.` });
      }
    } catch (err) {
      setMessage({ tone: 'bad', text: err instanceof Error ? err.message : 'Could not save that change' });
      void load();
    }
  }

  async function importNew(newAccounts: ConnectionAccount[]) {
    await api.patch('/akahu/accounts', {
      changes: newAccounts.map((a) => ({ akahuId: a.akahuId, included: a.included })),
    });
    await sync();
  }

  async function setAutoSync(enabled: boolean) {
    try {
      onStatusChange(await api.patch<AkahuStatus>('/akahu/settings', { autoSync: enabled }));
    } catch (err) {
      setMessage({ tone: 'bad', text: err instanceof Error ? err.message : 'Could not save that setting' });
    }
  }

  async function disconnect() {
    if (!confirm('Disconnect Saver from Akahu? Transactions already synced stay in the app.')) return;
    try {
      onStatusChange(await api.del<AkahuStatus>('/akahu/credentials'));
      setMessage(null);
      notifyDataChanged();
    } catch (err) {
      setMessage({ tone: 'bad', text: err instanceof Error ? err.message : 'Could not disconnect' });
    }
  }

  const { open: openPopup } = popup;
  const connectAnother = useCallback(() => {
    setMessage(null);
    openPopup(AKAHU_URLS.connections);
  }, [openPopup]);

  // "Connect a bank" chosen from the Add account dialog.
  const handledRequest = useRef(connectRequest);
  useEffect(() => {
    if (connectRequest === handledRequest.current) return;
    handledRequest.current = connectRequest;
    if (configured) connectAnother();
  }, [connectRequest, configured, connectAnother]);

  // While someone is adding a bank in Akahu, look for it every few seconds.
  useEffect(() => {
    if (!configured || (popup.state !== 'open' && popup.state !== 'returned')) return;
    void load();
    if (popup.state !== 'open') return;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [popup.state, configured, load]);

  if (status === null) {
    return (
      <Panel title="Bank connections">
        <SkeletonList rows={2} />
      </Panel>
    );
  }

  if (!configured) {
    return (
      <Panel className="panel--accent hub-setup">
        <div className="hub-setup-body">
          <span className="empty-icon">
            <PlugsConnectedIcon size={22} weight="duotone" />
          </span>
          <div>
            <h2 className="panel-title" style={{ fontSize: 17 }}>
              Sync your bank automatically
            </h2>
            <p className="muted small" style={{ margin: '6px 0 0', maxWidth: '58ch' }}>
              Connect any NZ bank through Akahu, New Zealand's open-banking service. Balances and transactions then flow in
              by themselves and get sorted into categories. Setup takes about three minutes and Saver guides you through it.
            </p>
            <p className="welcome-privacy small">
              <LockSimpleIcon size={14} weight="bold" /> Read-only. Saver never sees your bank password.
            </p>
          </div>
        </div>
        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn btn-primary" onClick={onSetup}>
            <PlugsConnectedIcon size={15} weight="bold" /> Set up bank sync
          </button>
        </div>
      </Panel>
    );
  }

  const accounts = connections ? allAccounts(connections) : [];
  const newAccounts = accounts.filter((a) => a.isNew);
  const lookedForNew = popup.state === 'returned';

  return (
    <Panel
      title="Bank connections"
      action={
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={connectAnother} disabled={busy !== null}>
            <PlusIcon size={14} weight="bold" /> <span className="btn-label">Connect another bank</span>
          </button>
        </div>
      }
    >
      <div className="stack" style={{ gap: 16 }}>
        <div className="hub-toolbar">
          <div className="hub-freshness small muted">
            <span className="live-dot" aria-hidden="true" />
            Last synced {timeAgo(status.lastSyncAt)}
          </div>
          <label className="inline small hub-auto">
            <Switch checked={status.autoSync} onChange={setAutoSync} label="Sync automatically when Saver opens" />
            Auto-sync
          </label>
          <span style={{ flex: 1 }} />
          <button
            className="btn btn-secondary btn-sm"
            onClick={refreshFromBank}
            disabled={busy !== null || !status.lastSyncAt}
            title="Ask your banks for the very latest transactions, then sync"
          >
            <CloudArrowDownIcon size={14} weight="bold" className={busy === 'refresh' ? 'pulse' : undefined} />
            {busy === 'refresh' ? 'Refreshing…' : 'Refresh from bank'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={status.lastSyncAt ? sync : onSetup} disabled={busy !== null}>
            <ArrowsClockwiseIcon size={14} weight="bold" className={busy === 'sync' ? 'spin' : undefined} />
            {busy === 'sync' ? 'Syncing…' : 'Sync now'}
          </button>
        </div>

        {message && (
          <p
            role={message.tone === 'bad' ? 'alert' : 'status'}
            className={`small hub-message hub-message--${message.tone}`}
          >
            {message.text}
          </p>
        )}

        <PopupHint
          state={popup.state}
          url={popup.url}
          onDone={popup.markDone}
          waitingText="Add your bank in the Akahu window. Saver will spot the new accounts automatically."
          returnedText={
            newAccounts.length > 0
              ? `Found ${newAccounts.length} new account${newAccounts.length === 1 ? '' : 's'}.`
              : 'No new accounts yet. Akahu can take a minute to finish linking a bank.'
          }
        />
        {lookedForNew && newAccounts.length === 0 && (
          <div className="row" style={{ gap: 8, marginTop: -6 }}>
            <button className="link-button small" onClick={() => void load()}>
              Check again
            </button>
          </div>
        )}

        {!status.lastSyncAt && accounts.length > 0 && (
          <div className="hub-new" role="status">
            <SparkleIcon size={18} weight="fill" />
            <div style={{ flex: 1 }}>
              <strong>Ready for your first import</strong>
              <p className="small muted" style={{ margin: '2px 0 0' }}>
                Pick which accounts to bring in and how much history to import.
              </p>
            </div>
            <button className="btn btn-primary btn-sm" onClick={onSetup}>
              Choose accounts
            </button>
          </div>
        )}

        {status.lastSyncAt && newAccounts.length > 0 && (
          <div className="hub-new" role="status">
            <SparkleIcon size={18} weight="fill" />
            <div style={{ flex: 1 }}>
              <strong>
                {newAccounts.length} new account{newAccounts.length === 1 ? '' : 's'} found
              </strong>
              <p className="small muted" style={{ margin: '2px 0 0' }}>
                Switch off anything you don't want, then import.
              </p>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => void importNew(newAccounts)} disabled={busy !== null}>
              Import {newAccounts.filter((a) => a.included).length}
            </button>
          </div>
        )}

        {loadError && (
          <p role="alert" className="small hub-message hub-message--bad">
            {loadError}{' '}
            <button className="link-button small" onClick={() => void load()}>
              Try again
            </button>
          </p>
        )}

        {connections === null ? (
          <SkeletonList rows={3} />
        ) : connections.length === 0 && !loadError ? (
          <div className="wizard-empty">
            <BankIcon size={26} weight="duotone" />
            <div>
              <strong>No banks connected in Akahu yet</strong>
              <p className="muted small" style={{ margin: '2px 0 0' }}>
                Use <em>Connect another bank</em> to add one. It shows up here as soon as it's linked.
              </p>
            </div>
          </div>
        ) : (
          <div className="bank-grid">
            {connections.map((c) => (
              <BankCard key={c.id} connection={c} onToggle={toggleAccount} onReconnect={connectAnother} />
            ))}
          </div>
        )}

        <div className="hub-foot small muted">
          <span>
            <LockSimpleIcon size={12} weight="bold" /> Read-only access through Akahu. Keys stay on this computer.
          </span>
          {status.source === 'app' ? (
            <button className="link-button small" onClick={disconnect}>
              Disconnect
            </button>
          ) : (
            <span>Tokens from server/.env</span>
          )}
        </div>
      </div>
    </Panel>
  );
}

function latestRefresh(connections: BankConnection[]) {
  return allAccounts(connections).reduce((max, a) => (a.refreshedAt && a.refreshedAt > max ? a.refreshedAt : max), '');
}

function BankCard({
  connection,
  onToggle,
  onReconnect,
}: {
  connection: BankConnection;
  onToggle: (account: ConnectionAccount, included: boolean) => void;
  onReconnect: () => void;
}) {
  const inactive = connection.status === 'INACTIVE';
  return (
    <article className={`bank-card${inactive ? ' bank-card--warn' : ''}`} aria-label={connection.name}>
      <header className="bank-card-head">
        <BankLogo name={connection.name} logo={connection.logo} />
        <div className="list-main">
          <div className="list-title">{connection.name}</div>
          <div className="list-meta">Bank data from {timeAgo(connection.refreshedAt)}</div>
        </div>
        {inactive ? (
          <span className="chip chip--warning">
            <WarningCircleIcon size={12} weight="fill" /> Needs reconnecting
          </span>
        ) : (
          <span className="chip chip--accent">
            <span className="live-dot" aria-hidden="true" /> Active
          </span>
        )}
      </header>
      {inactive && (
        <div className="bank-card-alert small">
          Akahu lost access to this bank. This often happens after a password change.{' '}
          <button className="link-button small" onClick={onReconnect}>
            Reconnect in Akahu
          </button>
        </div>
      )}
      <ul className="bank-accounts">
        {connection.accounts.map((a) => {
          const Glyph = TYPE_ICONS[a.type] ?? WalletIcon;
          return (
            <li key={a.akahuId} className={`bank-account${a.included ? '' : ' is-off'}`}>
              <Glyph size={16} weight="duotone" className="bank-account-icon" />
              <div className="list-main">
                <div className="bank-account-name">
                  {a.name}
                  {a.isNew && <span className="chip chip--accent chip--xs">New</span>}
                </div>
                <div className="list-meta">
                  {a.mask ? <span className="mono">•• {a.mask}</span> : null}
                  {a.mask && a.status === 'INACTIVE' ? ' · ' : null}
                  {a.status === 'INACTIVE' ? <span style={{ color: 'var(--warning)' }}>Not updating</span> : null}
                  {!a.included ? <span> {a.mask ? '· ' : ''}Not synced</span> : null}
                </div>
              </div>
              {a.balance !== null && (
                <span className={`num small${a.isLiability ? ' amount--bad' : ''}`}>{formatMoney(a.balance, a.currency)}</span>
              )}
              <Switch
                checked={a.included}
                onChange={(next) => onToggle(a, next)}
                label={`${a.included ? 'Stop syncing' : 'Sync'} ${a.name}`}
              />
            </li>
          );
        })}
      </ul>
    </article>
  );
}
