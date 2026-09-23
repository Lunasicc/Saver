/**
 * Reads the optional `account_id` query param used to focus reports on one account.
 * Returns null for "all accounts", or `{ error }` when the value isn't a valid id.
 */
export function parseAccountFilter(query) {
  const raw = query?.account_id;
  if (raw === undefined || raw === '' || raw === 'all') return { account: null };
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) return { error: 'account_id must be a positive integer' };
  return { account: id };
}

/** SQL fragment matching every account when @account is NULL, else just that one. */
export function accountClause(column = 'account_id') {
  return `(@account IS NULL OR ${column} = @account)`;
}
