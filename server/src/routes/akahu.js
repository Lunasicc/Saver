import { Router } from 'express';
import { db } from '../db/index.js';
import * as akahu from '../akahu/client.js';
import { bulkAutoCategorize } from '../lib/autoCategorize.js';
import { currentMonthLocal, shiftMonth } from '../lib/dates.js';

const router = Router();

router.get('/status', (_req, res) => {
  const { source } = akahu.getCredentials();
  // Never echo tokens back to the browser; only say where they came from.
  res.json({ configured: source !== null, source });
});

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
    res.json({ configured: true, source: akahu.getCredentials().source, accounts });
  } catch (err) {
    next(err);
  }
});

router.delete('/credentials', (_req, res) => {
  akahu.clearCredentials();
  const { source } = akahu.getCredentials();
  res.json({ configured: source !== null, source });
});

router.post('/sync', async (req, res, next) => {
  if (!akahu.isConfigured()) {
    return res.status(400).json({
      error: 'Akahu is not connected. Add your Akahu tokens on the Accounts page first.',
    });
  }

  try {
    await runSync(req, res);
  } catch (err) {
    next(err);
  }
});

async function runSync(req, res) {
  const months = Number(req.body?.months) || 12;
  if (!Number.isInteger(months) || months < 1 || months > 60) {
    return res.status(400).json({ error: 'months must be an integer between 1 and 60' });
  }
  // Anchored to the first of the month `months - 1` back. Date.setMonth() would
  // overflow into the wrong month when run on the 29th-31st.
  const startDate = `${shiftMonth(currentMonthLocal(), -(months - 1))}-01`;

  const akahuAccounts = await akahu.fetchAccounts();

  const upsertAccount = db.prepare(
    `INSERT INTO accounts (name, type, institution, currency, starting_balance, current_balance, is_liability, akahu_account_id)
     VALUES (@name, @type, @institution, @currency, @balance, @balance, @is_liability, @akahu_id)
     ON CONFLICT(akahu_account_id) DO UPDATE SET
       name = excluded.name,
       current_balance = excluded.current_balance
     RETURNING id, akahu_account_id`
  );

  const akahuIdToLocalId = new Map();
  for (const acc of akahuAccounts) {
    const row = upsertAccount.get({
      name: acc.name,
      type: akahu.mapAccountType(acc.type),
      institution: acc.connection?.name ?? null,
      currency: acc.balance?.currency ?? 'NZD',
      balance: acc.balance?.current ?? 0,
      is_liability: akahu.isLiabilityType(acc.type) ? 1 : 0,
      akahu_id: acc._id,
    });
    akahuIdToLocalId.set(acc._id, row.id);
  }

  const transactions = await akahu.fetchAllTransactions({ start: startDate });

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
  const importTx = db.transaction((rows) => {
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
  });
  importTx(transactions);

  // Akahu's reported balance is authoritative for synced accounts; rebase
  // starting_balance so future local edits still recalc correctly.
  const rebase = db.prepare(
    `UPDATE accounts SET starting_balance = current_balance - (
       SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE account_id = accounts.id
     ) WHERE akahu_account_id IS NOT NULL`
  );
  rebase.run();

  const categorized = bulkAutoCategorize({ onlyUncategorized: true });

  res.json({
    accountsSynced: akahuAccounts.length,
    transactionsImported: imported,
    transactionsUpdated: updated,
    transactionsSkipped: skipped,
    transactionsCategorized: categorized.updated,
  });
}

export default router;
