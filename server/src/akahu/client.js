import { db } from '../db/index.js';
import { getSetting } from '../lib/settings.js';

// Overridable so tests and demos can point at a mock Akahu.
const akahuBase = () => (process.env.AKAHU_API_URL || 'https://api.akahu.io/v1').replace(/\/+$/, '');

const readSetting = (key) => getSetting(key);

/** Tokens from server/.env win; otherwise use the ones saved from the Accounts page. */
export function getCredentials() {
  if (process.env.AKAHU_APP_TOKEN && process.env.AKAHU_USER_TOKEN) {
    return { appToken: process.env.AKAHU_APP_TOKEN, userToken: process.env.AKAHU_USER_TOKEN, source: 'env' };
  }
  const appToken = readSetting('akahu_app_token');
  const userToken = readSetting('akahu_user_token');
  return { appToken, userToken, source: appToken && userToken ? 'app' : null };
}

export function isConfigured() {
  return getCredentials().source !== null;
}

export function saveCredentials({ appToken, userToken }) {
  const upsert = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  );
  db.transaction(() => {
    upsert.run('akahu_app_token', appToken);
    upsert.run('akahu_user_token', userToken);
  })();
}

export function clearCredentials() {
  db.prepare("DELETE FROM settings WHERE key IN ('akahu_app_token', 'akahu_user_token')").run();
}

function authHeaders(creds = getCredentials()) {
  const { appToken, userToken } = creds;
  if (!appToken || !userToken) {
    const err = new Error('Akahu is not connected. Add your Akahu tokens on the Accounts page.');
    err.status = 400;
    throw err;
  }
  return { Authorization: `Bearer ${userToken}`, 'X-Akahu-Id': appToken };
}

async function akahuRequest(method, path, params = {}, creds) {
  const url = new URL(`${akahuBase()}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }
  let res;
  try {
    res = await fetch(url, { method, headers: authHeaders(creds) });
  } catch {
    const err = new Error("Couldn't reach Akahu. Check your internet connection and try again.");
    err.status = 502;
    throw err;
  }
  if (!res.ok) {
    const rejected = res.status === 401 || res.status === 403;
    const err = new Error(
      rejected
        ? 'Akahu rejected these tokens. Check they were copied correctly from my.akahu.nz → Developers.'
        : res.status === 429
          ? 'Akahu is rate limiting requests. Wait a few minutes and try again.'
          : `Akahu request to ${path} failed with status ${res.status}`
    );
    err.status = rejected ? 401 : res.status === 429 ? 429 : 502;
    throw err;
  }
  return res.json();
}

const akahuGet = (path, params, creds) => akahuRequest('GET', path, params, creds);

/** Checks a token pair against Akahu before saving it. Returns the connected account count. */
export async function verifyCredentials(creds) {
  const data = await akahuGet('/accounts', {}, creds);
  return data.items?.length ?? 0;
}

// Fetches every connected account for this Akahu user.
export async function fetchAccounts() {
  const data = await akahuGet('/accounts');
  return data.items ?? [];
}

/**
 * Asks Akahu to pull fresh data from the banks. Akahu may ignore this if the
 * accounts were refreshed recently (1 hour rest period for personal apps), and
 * the refresh itself finishes in the background.
 */
export async function requestRefresh() {
  await akahuRequest('POST', '/refresh');
}

/** "12-3456-7890123-00" -> "0123-00"; "1234-****-****-5678" -> "5678". Never stores full numbers. */
export function maskAccountNumber(formatted) {
  if (!formatted) return null;
  const parts = String(formatted).split('-');
  if (parts.length === 4 && /^\d{2}$/.test(parts[0]) && /^\d+$/.test(parts[2])) {
    return `${parts[2].slice(-4)}-${parts[3]}`;
  }
  const digits = String(formatted).replace(/\D/g, '');
  return digits ? digits.slice(-4) : null;
}

// Fetches all settled transactions, following pagination cursors.
// Pass `start` (ISO date) to limit how far back we sync — useful to avoid
// re-pulling a user's entire transaction history on every sync. Pass
// `accountId` to read a single account's history.
export async function fetchAllTransactions({ start, accountId } = {}) {
  const path = accountId ? `/accounts/${encodeURIComponent(accountId)}/transactions` : '/transactions';
  const items = [];
  let cursor;
  do {
    const data = await akahuGet(path, { start, cursor });
    items.push(...data.items);
    cursor = data.cursor?.next || undefined;
  } while (cursor);
  return items;
}

const TYPE_MAP = {
  CHECKING: 'checking',
  SAVINGS: 'savings',
  CREDITCARD: 'credit',
  LOAN: 'loan',
  KIWISAVER: 'investment',
  TERM_DEPOSIT: 'investment',
};

const LIABILITY_TYPES = new Set(['CREDITCARD', 'LOAN']);

export function mapAccountType(akahuType) {
  return TYPE_MAP[akahuType] || 'checking';
}

export function isLiabilityType(akahuType) {
  return LIABILITY_TYPES.has(akahuType);
}
