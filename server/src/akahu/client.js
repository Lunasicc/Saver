import { db } from '../db/index.js';

const AKAHU_BASE = 'https://api.akahu.io/v1';

const readSetting = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || '';

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

async function akahuGet(path, params = {}, creds) {
  const url = new URL(`${AKAHU_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }
  const res = await fetch(url, { headers: authHeaders(creds) });
  if (!res.ok) {
    const err = new Error(
      res.status === 401 || res.status === 403
        ? 'Akahu rejected these tokens. Check they were copied correctly from my.akahu.nz → Developers.'
        : `Akahu request to ${path} failed with status ${res.status}`
    );
    err.status = res.status === 401 || res.status === 403 ? 401 : 502;
    throw err;
  }
  return res.json();
}

/** Checks a token pair against Akahu before saving it. Returns the connected account count. */
export async function verifyCredentials(creds) {
  const data = await akahuGet('/accounts', {}, creds);
  return data.items?.length ?? 0;
}

// Fetches every connected account for this Akahu user.
export async function fetchAccounts() {
  const data = await akahuGet('/accounts');
  return data.items;
}

// Fetches all settled transactions, following pagination cursors.
// Pass `start` (ISO date) to limit how far back we sync — useful to avoid
// re-pulling a user's entire transaction history on every sync.
export async function fetchAllTransactions({ start } = {}) {
  const items = [];
  let cursor;
  do {
    const data = await akahuGet('/transactions', { start, cursor });
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
