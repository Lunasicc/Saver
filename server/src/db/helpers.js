import { db } from './index.js';

// Recompute an account's current_balance from starting_balance + sum of transactions.
export function recalcAccountBalance(accountId) {
  const { total } = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE account_id = ?')
    .get(accountId);
  const account = db.prepare('SELECT starting_balance FROM accounts WHERE id = ?').get(accountId);
  if (!account) return;
  const balance = account.starting_balance + total;
  db.prepare('UPDATE accounts SET current_balance = ? WHERE id = ?').run(balance, accountId);
}
