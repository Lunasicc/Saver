import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowsClockwiseIcon,
  ChartDonutIcon,
  CurrencyCircleDollarIcon,
  ListBulletsIcon,
  TargetIcon,
  WalletIcon,
} from '@phosphor-icons/react';
import { api } from './lib/api';
import { notifyDataChanged, onDataChanged } from './lib/events';
import { APP_NAME } from './lib/brand';

const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: ChartDonutIcon, end: true },
  { to: '/transactions', label: 'Transactions', icon: ListBulletsIcon },
  { to: '/plan', label: 'Planning', icon: TargetIcon },
  { to: '/accounts', label: 'Accounts', icon: WalletIcon },
];

type SyncResult = { accountsSynced: number; transactionsImported: number };

function SyncButton() {
  const [configured, setConfigured] = useState(false);
  const [state, setState] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const load = () =>
      api
        .get<{ configured: boolean }>('/akahu/status')
        .then((s) => setConfigured(s.configured))
        .catch(() => setConfigured(false));
    load();
    return onDataChanged(load);
  }, []);

  useEffect(() => {
    if (state !== 'done' && state !== 'error') return;
    const timer = setTimeout(() => setState('idle'), 4000);
    return () => clearTimeout(timer);
  }, [state]);

  if (!configured) return null;

  async function sync() {
    setState('syncing');
    try {
      const res = await api.post<SyncResult>('/akahu/sync', { months: 3 });
      setMessage(
        res.transactionsImported > 0
          ? `${res.transactionsImported} new transaction${res.transactionsImported === 1 ? '' : 's'}`
          : 'Up to date'
      );
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
        {(state === 'done' || state === 'error') && (
          <motion.span
            role="status"
            className={`small ${state === 'error' ? 'amount--bad' : 'muted'}`}
            initial={{ opacity: 0, x: 6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {message}
          </motion.span>
        )}
      </AnimatePresence>
      <button className="btn btn-secondary" onClick={sync} disabled={state === 'syncing'} title="Sync with your bank via Akahu">
        <ArrowsClockwiseIcon size={15} weight="bold" className={state === 'syncing' ? 'spin' : undefined} />
        <span className="btn-label">{state === 'syncing' ? 'Syncing…' : 'Sync bank'}</span>
      </button>
    </div>
  );
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
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

export default App;
