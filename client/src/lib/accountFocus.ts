import { useEffect, useSyncExternalStore } from 'react';
import { api } from './api';
import { onDataChanged } from './events';
import type { Account } from './types';

/**
 * Which account the app is focused on (null = all accounts). Shared by the top-bar
 * switcher and every page that reports on money, and remembered between visits.
 */
const STORAGE_KEY = 'saver:focus-account';

type State = { focusId: number | null; accounts: Account[] | null };

function readStored(): number | null {
  try {
    const id = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

let state: State = { focusId: readStored(), accounts: null };
const listeners = new Set<() => void>();

function update(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function setFocus(id: number | null) {
  if (id === state.focusId) return;
  try {
    if (id === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(id));
  } catch {
    // Private mode: the focus still works for this visit.
  }
  update({ focusId: id });
}

/** Pages that already fetch the account list can hand it over instead of refetching. */
export function syncAccounts(accounts: Account[]) {
  update({ accounts });
  // Focusing only makes sense with a choice to make, and on an account that still exists.
  if (state.focusId !== null && (accounts.length < 2 || !accounts.some((a) => a.id === state.focusId))) {
    setFocus(null);
  }
}

let loading: Promise<void> | null = null;
export function refreshAccounts() {
  loading ??= api
    .get<Account[]>('/accounts')
    .then(syncAccounts)
    .catch(() => undefined)
    .finally(() => {
      loading = null;
    });
  return loading;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let started = false;
function start() {
  if (started) return;
  started = true;
  void refreshAccounts();
  onDataChanged(() => void refreshAccounts());
  // Keep other open tabs in step.
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) update({ focusId: readStored() });
  });
}

export function useAccountFocus() {
  useEffect(start, []);
  const { focusId, accounts } = useSyncExternalStore(subscribe, () => state);
  const focus = (focusId !== null && accounts?.find((a) => a.id === focusId)) || null;
  return { focusId, focus, accounts, setFocus };
}

/** Appends ?account_id= when the app is focused on one account. */
export function withAccount(path: string, focusId: number | null) {
  if (focusId === null) return path;
  return `${path}${path.includes('?') ? '&' : '?'}account_id=${focusId}`;
}

/** Signed balance: what an account adds to (or takes from) your net worth. */
export function netBalance(a: Account) {
  return a.is_liability ? -Math.abs(a.current_balance) : a.current_balance;
}
