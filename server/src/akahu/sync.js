import { db } from '../db/index.js';
import * as akahu from './client.js';
import { bulkAutoCategorize } from '../lib/autoCategorize.js';
import { currentMonthLocal, shiftMonth } from '../lib/dates.js';
import { getSetting, setSetting, deleteSetting } from '../lib/settings.js';

const LAST_SYNC_KEY = 'akahu_last_sync_at';
const AUTO_SYNC_KEY = 'akahu_auto_sync';
// Incremental syncs re-read this much history so pending -> settled changes are picked up.
const INCREMENTAL_OVERLAP_DAYS = 14;
export const AUTO_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

export const getLastSyncAt = () => getSetting(LAST_SYNC_KEY) || null;
export const resetLastSync = () => deleteSetting(LAST_SYNC_KEY);
export const isAutoSyncEnabled = () => getSetting(AUTO_SYNC_KEY, '1') !== '0';
export const setAutoSyncEnabled = (enabled) => setSetting(AUTO_SYNC_KEY, enabled ? '1' : '0');

const selectSeen = db.prepare('SELECT akahu_account_id, included FROM akahu_seen_accounts');
const insertSeen = db.prepare('INSERT OR IGNORE INTO akahu_seen_accounts (akahu_account_id, included) VALUES (?, 1)');
const upsertSeen = db.prepare(
  `INSERT INTO akahu_seen_accounts (akahu_account_id, included) VALUES (?, ?)
   ON CONFLICT(akahu_account_id) DO UPDATE SET included = excluded.included`
);

/** Map of akahu account id -> included (boolean) for every account we've seen. */
export function getSeenAccounts() {
  return new Map(selectSeen.all().map((r) => [r.akahu_account_id, r.included === 1]));
}

export const setAccountsIncluded = db.transaction((changes) => {
  for (const { akahuId, included } of changes) upsertSeen.run(akahuId, included ? 1 : 0);
});

function isoDateDaysBefore(iso, days) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Where a sync should start reading from. An explicit `months` wins; otherwise
 * we continue from the last successful sync, or take a year on the first run.
 */
export function syncStartDate({ months, lastSyncAt = getLastSyncAt() } = {}) {
  if (months) return { start: `${shiftMonth(currentMonthLocal(), -(months - 1))}-01`, mode: 'range' };
  if (lastSyncAt) return { start: isoDateDaysBefore(lastSyncAt, INCREMENTAL_OVERLAP_DAYS), mode: 'incremental' };
  return { start: `${shiftMonth(currentMonthLocal(), -11)}-01`, mode: 'initial' };
}

let running = null;
export const isSyncRunning = () => running !== null;

/** Pulls accounts and transactions from Akahu. Only one sync runs at a time. */
export async function syncFromAkahu({ months } = {}) {
  if (running) {
    const err = new Error('A sync is already running. Give it a moment to finish.');
    err.status = 409;
    throw err;
  }
  running = runSync({ months });
  try {
    return await running;
  } finally {
    running = null;
  }
}

async function runSync({ months }) {
  const { start, mode } = syncStartDate({ months });
  const akahuAccounts = await akahu.fetchAccounts();

  // Accounts we haven't seen before default to included.
  for (const acc of akahuAccounts) insertSeen.run(acc._id);
  const seen = getSeenAccounts();
  const included = akahuAccounts.filter((acc) => seen.get(acc._id) !== false);

  const upsertAccount = db.prepare(
    `INSERT INTO accounts (name, type, institution, currency, starting_balance, current_balance, is_liability,
                           akahu_account_id, akahu_connection_id, akahu_logo, akahu_status, akahu_refreshed_at, account_mask)
     VALUES (@name, @type, @institution, @currency, @balance, @balance, @is_liability,
             @akahu_id, @connection_id, @logo, @status, @refreshed_at, @mask)
     ON CONFLICT(akahu_account_id) DO UPDATE SET
       name = excluded.name,
       current_balance = excluded.current_balance,
       akahu_connection_id = excluded.akahu_connection_id,
       akahu_logo = excluded.akahu_logo,
       akahu_status = excluded.akahu_status,
       akahu_refreshed_at = excluded.akahu_refreshed_at,
       account_mask = excluded.account_mask
     RETURNING id, akahu_account_id`
  );

  const akahuIdToLocalId = new Map();
  db.transaction(() => {
    for (const acc of included) {
      const row = upsertAccount.get({
        name: acc.name,
        type: akahu.mapAccountType(acc.type),
        institution: acc.connection?.name ?? null,
        currency: acc.balance?.currency ?? 'NZD',
        balance: acc.balance?.current ?? 0,
        is_liability: akahu.isLiabilityType(acc.type) ? 1 : 0,
        akahu_id: acc._id,
        connection_id: acc.connection?._id ?? null,
        logo: acc.connection?.logo ?? null,
        status: acc.status ?? null,
        refreshed_at: acc.refreshed?.transactions ?? acc.refreshed?.balance ?? null,
        mask: akahu.maskAccountNumber(acc.formatted_account),
      });
      akahuIdToLocalId.set(acc._id, row.id);
    }
  })();

  const transactions = included.length ? await akahu.fetchAllTransactions({ start }) : [];

  // The bank owns date/description/amount; the user owns category, merchant and note.
  // Updating on conflict keeps corrections Akahu makes to pending->settled transactions
  // in sync without clobbering the user's own categorisation work.
  const insertTx = db.prepare(
    `INSERT INTO transactions (account_id, date, description, amount, source, external_id)
     VALUES (?, ?, ?, ?, 'akahu', ?)
     ON CONFLICT(account_id, external_id) DO UPDATE SET
       date = excluded.date,
       description = excluded.description,
       amount = excluded.amount`
  );
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const existsTx = db.prepare('SELECT 1 FROM transactions WHERE account_id = ? AND external_id = ?');
  db.transaction((rows) => {
    for (const tx of rows) {
      const localAccountId = akahuIdToLocalId.get(tx._account);
      if (!localAccountId) {
        skipped++;
        continue;
      }
      const alreadyPresent = Boolean(existsTx.get(localAccountId, tx._id));
      insertTx.run(localAccountId, tx.date.slice(0, 10), tx.description, tx.amount, tx._id);
      if (alreadyPresent) updated++;
      else imported++;
    }
  })(transactions);

  // Akahu's reported balance is authoritative for synced accounts; rebase
  // starting_balance so future local edits still recalc correctly.
  db.prepare(
    `UPDATE accounts SET starting_balance = current_balance - (
       SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE account_id = accounts.id
     ) WHERE akahu_account_id IS NOT NULL`
  ).run();

  const categorized = bulkAutoCategorize({ onlyUncategorized: true });
  const syncedAt = new Date().toISOString();
  setSetting(LAST_SYNC_KEY, syncedAt);

  return {
    mode,
    since: start,
    syncedAt,
    accountsSynced: included.length,
    accountsExcluded: akahuAccounts.length - included.length,
    transactionsImported: imported,
    transactionsUpdated: updated,
    transactionsSkipped: skipped,
    transactionsCategorized: categorized.updated,
  };
}

/** Runs an incremental sync when auto-sync is on and the last one is stale. */
export async function autoSync({ now = Date.now() } = {}) {
  if (!akahu.isConfigured()) return { ran: false, reason: 'not-connected' };
  if (!isAutoSyncEnabled()) return { ran: false, reason: 'disabled' };
  if (isSyncRunning()) return { ran: false, reason: 'running' };
  const last = getLastSyncAt();
  // The first import is deliberate (the person picks accounts and history), never automatic.
  if (!last) return { ran: false, reason: 'never-synced' };
  if (now - Date.parse(last) < AUTO_SYNC_INTERVAL_MS) return { ran: false, reason: 'recent', lastSyncAt: last };
  return { ran: true, ...(await syncFromAkahu()) };
}
