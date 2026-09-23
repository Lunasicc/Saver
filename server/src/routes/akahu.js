import { Router } from 'express';
import { db } from '../db/index.js';
import * as akahu from '../akahu/client.js';
import {
  autoSync,
  getLastSyncAt,
  getSeenAccounts,
  isAutoSyncEnabled,
  resetLastSync,
  setAccountsIncluded,
  setAutoSyncEnabled,
  syncFromAkahu,
} from '../akahu/sync.js';

const router = Router();

function statusBody() {
  const { source } = akahu.getCredentials();
  // Never echo tokens back to the browser; only say where they came from.
  return { configured: source !== null, source, lastSyncAt: getLastSyncAt(), autoSync: isAutoSyncEnabled() };
}

function requireConnected(_req, res, next) {
  if (!akahu.isConfigured()) {
    return res.status(400).json({
      error: 'Akahu is not connected. Add your Akahu tokens on the Accounts page first.',
    });
  }
  next();
}

router.get('/status', (_req, res) => res.json(statusBody()));

const TOKEN_PATTERNS = { appToken: /^app_token_[A-Za-z0-9]+$/, userToken: /^user_token_[A-Za-z0-9]+$/ };

router.put('/credentials', async (req, res, next) => {
  const appToken = String(req.body?.appToken ?? '').trim();
  const userToken = String(req.body?.userToken ?? '').trim();
  if (!TOKEN_PATTERNS.appToken.test(appToken)) {
    return res.status(400).json({ error: 'The App ID Token should start with "app_token_".' });
  }
  if (!TOKEN_PATTERNS.userToken.test(userToken)) {
    return res.status(400).json({ error: 'The User Access Token should start with "user_token_".' });
  }
  try {
    const accounts = await akahu.verifyCredentials({ appToken, userToken });
    akahu.saveCredentials({ appToken, userToken });
    res.json({ ...statusBody(), accounts });
  } catch (err) {
    next(err);
  }
});

router.delete('/credentials', (_req, res) => {
  akahu.clearCredentials();
  // A different Akahu login may be connected next, so start its history from scratch.
  resetLastSync();
  res.json(statusBody());
});

router.patch('/settings', (req, res) => {
  if (typeof req.body?.autoSync !== 'boolean') {
    return res.status(400).json({ error: 'autoSync must be true or false' });
  }
  setAutoSyncEnabled(req.body.autoSync);
  res.json(statusBody());
});

const localAccountsByAkahuId = db.prepare(
  'SELECT id, akahu_account_id FROM accounts WHERE akahu_account_id IS NOT NULL'
);

/** Live view of the user's Akahu accounts, grouped into one entry per bank login. */
router.get('/connections', requireConnected, async (_req, res, next) => {
  try {
    const accounts = await akahu.fetchAccounts();
    const seen = getSeenAccounts();
    const localIds = new Map(localAccountsByAkahuId.all().map((r) => [r.akahu_account_id, r.id]));

    const groups = new Map();
    for (const acc of accounts) {
      const key = acc._authorisation || acc._credentials || acc.connection?._id || acc._id;
      if (!groups.has(key)) {
        groups.set(key, {
          id: key,
          name: acc.connection?.name ?? 'Bank',
          logo: acc.connection?.logo ?? null,
          accounts: [],
        });
      }
      groups.get(key).accounts.push({
        akahuId: acc._id,
        name: acc.name,
        type: akahu.mapAccountType(acc.type),
        mask: akahu.maskAccountNumber(acc.formatted_account),
        status: acc.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
        balance: acc.balance?.current ?? null,
        currency: acc.balance?.currency ?? 'NZD',
        isLiability: akahu.isLiabilityType(acc.type),
        refreshedAt: acc.refreshed?.transactions ?? acc.refreshed?.balance ?? null,
        included: seen.get(acc._id) !== false,
        isNew: !seen.has(acc._id),
        localAccountId: localIds.get(acc._id) ?? null,
      });
    }

    const connections = [...groups.values()].map((group) => {
      const times = group.accounts.map((a) => a.refreshedAt).filter(Boolean).sort();
      return {
        ...group,
        status: group.accounts.some((a) => a.status === 'INACTIVE') ? 'INACTIVE' : 'ACTIVE',
        // The oldest refresh is the honest answer to "how fresh is this bank's data?"
        refreshedAt: times[0] ?? null,
      };
    });
    connections.sort((a, b) => a.name.localeCompare(b.name));

    res.json({ ...statusBody(), connections });
  } catch (err) {
    next(err);
  }
});

const AKAHU_ACCOUNT_ID = /^acc_[A-Za-z0-9]+$/;

/** Bulk include/exclude: { changes: [{ akahuId, included }] }. Also marks accounts as seen. */
router.patch('/accounts', (req, res) => {
  const changes = req.body?.changes;
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > 500) {
    return res.status(400).json({ error: 'changes must be a non-empty array' });
  }
  for (const change of changes) {
    if (!AKAHU_ACCOUNT_ID.test(String(change?.akahuId ?? '')) || typeof change.included !== 'boolean') {
      return res.status(400).json({ error: 'Each change needs an akahuId like "acc_…" and included true/false' });
    }
  }
  setAccountsIncluded(changes);
  res.json({ updated: changes.length });
});

router.post('/refresh', requireConnected, async (_req, res, next) => {
  try {
    await akahu.requestRefresh();
    res.json({ requested: true });
  } catch (err) {
    next(err);
  }
});

router.post('/sync', requireConnected, async (req, res, next) => {
  const months = req.body?.months;
  if (months !== undefined && (!Number.isInteger(months) || months < 1 || months > 60)) {
    return res.status(400).json({ error: 'months must be an integer between 1 and 60' });
  }
  try {
    res.json(await syncFromAkahu({ months }));
  } catch (err) {
    next(err);
  }
});

router.post('/auto-sync', async (_req, res, next) => {
  try {
    res.json(await autoSync());
  } catch (err) {
    next(err);
  }
});

export default router;
