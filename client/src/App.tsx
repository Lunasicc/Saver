import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useOutlet } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowsClockwiseIcon,
  ChartDonutIcon,
  CheckCircleIcon,
  CurrencyCircleDollarIcon,
  ListBulletsIcon,
  TargetIcon,
  WalletIcon,
  XIcon,
} from '@phosphor-icons/react';
import { api } from './lib/api';
import { notifyDataChanged, onDataChanged } from './lib/events';
import { APP_NAME } from './lib/brand';
import { describeSync, type AkahuStatus, type AutoSyncResult, type SyncResult } from './lib/akahu';
import { timeAgo } from './lib/format';
import { AccountSwitcher } from './components/AccountSwitcher';

const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: ChartDonutIcon, end: true },
  { to: '/transactions', label: 'Transactions', icon: ListBulletsIcon },
  { to: '/plan', label: 'Planning', icon: TargetIcon },
  { to: '/accounts', label: 'Accounts', icon: WalletIcon },
];

/** Top-bar sync: incremental, shows how fresh the data is, and runs auto-sync once per app load. */
function SyncButton() {
  const [status, setStatus] = useState<AkahuStatus | null>(null);
  const [state, setState] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const autoRan = useRef(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    const load = () =>
      api
        .get<AkahuStatus>('/akahu/status')
        .then(setStatus)
        .catch(() => setStatus(null));
    load();
    return onDataChanged(load);
  }, []);

  // Keep "synced 3 min ago" honest while the app stays open.
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (status === null || autoRan.current) return;
    // Only the status seen when the app opens counts; connecting mid-session never auto-syncs.
    autoRan.current = true;
    if (!status.configured || !status.autoSync || !status.lastSyncAt) return;
    setState('syncing');
    api
      .post<AutoSyncResult>('/akahu/auto-sync', {})
      .then((res) => {
        setState('idle');
        if (!res.ran) return;
        if (res.transactionsImported > 0) setToast(`Synced your bank: ${describeSync(res)}`);
        notifyDataChanged();
      })
      .catch(() => setState('idle'));
  }, [status]);

  useEffect(() => {
    if (state !== 'done' && state !== 'error') return;
    const timer = setTimeout(() => setState('idle'), 4000);
    return () => clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!status?.configured || !status.lastSyncAt) return null;

  async function sync() {
    setState('syncing');
    try {
      const res = await api.post<SyncResult>('/akahu/sync', {});
      setMessage(describeSync(res));
      setState('done');
      notifyDataChanged();
    } catch (err) {
      setMessage((err as Error).message);
      setState('error');
    }
  }

  return (
    <div className="row" style={{ gap: 10 }}>
      <AnimatePresence>
        {state === 'done' || state === 'error' ? (
          <motion.span
            key="msg"
            role="status"
            className={`small ${state === 'error' ? 'amount--bad' : 'muted'}`}
            initial={{ opacity: 0, x: 6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {message}
          </motion.span>
        ) : status.lastSyncAt && state === 'idle' ? (
          <span key="age" className="small faint sync-age">
            {timeAgo(status.lastSyncAt)}
          </span>
        ) : null}
      </AnimatePresence>
      <button
        className="btn btn-secondary"
        onClick={sync}
        disabled={state === 'syncing'}
        title={`Sync with your bank via Akahu${status.lastSyncAt ? ` (last synced ${timeAgo(status.lastSyncAt)})` : ''}`}
      >
        <ArrowsClockwiseIcon size={15} weight="bold" className={state === 'syncing' ? 'spin' : undefined} />
        <span className="btn-label">{state === 'syncing' ? 'Syncing…' : 'Sync bank'}</span>
      </button>
      <AnimatePresence>
        {toast && (
          <motion.div
            className="toast"
            role="status"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
          >
            <CheckCircleIcon size={18} weight="fill" />
            <span>{toast}</span>
            <button className="btn btn-icon" aria-label="Dismiss" onClick={() => setToast(null)}>
              <XIcon size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
/**
 * The page that's animating out must keep rendering its own route. A plain <Outlet />
 * would render the *new* page inside the exiting wrapper too, mounting it twice.
 */
function FrozenOutlet() {
  const outlet = useOutlet();
  const [frozen] = useState(outlet);
  return frozen;
}

function App() {
  const location = useLocation();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand" aria-label={`${APP_NAME} — Overview`}>
            <span className="brand-mark">
              <CurrencyCircleDollarIcon size={17} weight="bold" />
            </span>
            <span className="brand-text">{APP_NAME}</span>
          </NavLink>
          <nav className="nav" aria-label="Main">
            {NAV_ITEMS.map(({ to, label, icon: Glyph, end }) => (
              <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link${isActive ? ' nav-link--active' : ''}`}>
                {({ isActive }) => (
                  <>
                    <Glyph size={17} weight={isActive ? 'fill' : 'regular'} />
                    <span className="nav-label">{label}</span>
                    {isActive && (
                      <motion.span
                        layoutId="nav-indicator"
                        className="nav-indicator"
                        transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                      />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="topbar-actions">
            <AccountSwitcher />
            <SyncButton />
          </div>
        </div>
      </header>
      <main className="main">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <FrozenOutlet />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

export default App;
