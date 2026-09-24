export type AkahuStatus = {
  configured: boolean;
  source: 'env' | 'app' | null;
  lastSyncAt: string | null;
  autoSync: boolean;
};

export type ConnectionAccount = {
  akahuId: string;
  name: string;
  type: string;
  mask: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  balance: number | null;
  currency: string;
  isLiability: boolean;
  refreshedAt: string | null;
  included: boolean;
  isNew: boolean;
  localAccountId: number | null;
};

export type BankConnection = {
  id: string;
  name: string;
  logo: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  refreshedAt: string | null;
  accounts: ConnectionAccount[];
};

export type ConnectionsResponse = AkahuStatus & { connections: BankConnection[] };

export type SyncResult = {
  mode: 'initial' | 'incremental' | 'range';
  since: string;
  syncedAt: string;
  accountsSynced: number;
  accountsExcluded: number;
  accountsBackfilled: number;
  historySince: string | null;
  transactionsImported: number;
  transactionsUpdated: number;
  transactionsSkipped: number;
  transactionsCategorized: number;
};

export type AutoSyncResult = ({ ran: true } & SyncResult) | { ran: false; reason: string };

export const AKAHU_URLS = {
  home: 'https://my.akahu.nz/',
  connections: 'https://my.akahu.nz/connections',
  developers: 'https://my.akahu.nz/developers',
  about: 'https://www.akahu.nz',
};

export const allAccounts = (connections: BankConnection[]) => connections.flatMap((c) => c.accounts);

export function describeSync(res: SyncResult) {
  const parts = [
    res.transactionsImported > 0
      ? `${res.transactionsImported} new transaction${res.transactionsImported === 1 ? '' : 's'}`
      : 'Already up to date',
  ];
  if (res.transactionsCategorized > 0) parts.push(`${res.transactionsCategorized} auto-categorised`);
  if (res.accountsBackfilled > 0 && res.transactionsImported > 0 && res.historySince) {
    const since = new Date(`${res.historySince}T00:00:00`).toLocaleDateString('en-NZ', { month: 'short', year: 'numeric' });
    parts.push(`history back to ${since} for ${res.accountsBackfilled === 1 ? 'a new account' : `${res.accountsBackfilled} new accounts`}`);
  }
  return parts.join(' · ');
}
