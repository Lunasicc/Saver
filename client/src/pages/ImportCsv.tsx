import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BankIcon, CheckCircleIcon, FileCsvIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import { api } from '../lib/api';
import type { Account } from '../lib/types';
import { celebrate } from '../lib/celebrate';
import { notifyDataChanged } from '../lib/events';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { Panel } from '../components/Panel';

type ParsedCsv = { headers: string[]; rows: string[][]; rowCount: number };
type ImportResult = { imported: number; skipped: number; total: number };

function normalizeDate(value: string) {
  // Coerce common bank export formats (DD/MM/YYYY etc.) to ISO YYYY-MM-DD.
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const parts = value.split(/[/-]/);
  if (parts.length === 3) {
    const [d, m, y] = parts;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return value;
}

/** Best-guess column indexes from header names, so most bank exports need no mapping. */
function guessMapping(headers: string[]) {
  const find = (re: RegExp, fallback: number) => {
    const i = headers.findIndex((h) => re.test(h));
    return String(i >= 0 ? i : Math.min(fallback, headers.length - 1));
  };
  return {
    date: find(/date/i, 0),
    description: find(/desc|payee|memo|details|particulars|narrative/i, 1),
    amount: find(/amount|value/i, 2),
  };
}

export function ImportCsv() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState({ date: '0', description: '1', amount: '2' });
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<Account[]>('/accounts')
      .then((list) => {
        setAccounts(list);
        setLoaded(true);
        if (list.length === 1) setAccountId(String(list[0].id));
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setResult(null);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = await api.post<ParsedCsv>('/transactions/parse-csv', { csvText: String(reader.result) });
        setParsed(data);
        setMapping(guessMapping(data.headers));
      } catch (err) {
        setParsed(null);
        setError(err instanceof Error ? err.message : 'Failed to read that CSV');
      }
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!parsed || !accountId) return;
    const idx = { date: Number(mapping.date), description: Number(mapping.description), amount: Number(mapping.amount) };
    const transactions = parsed.rows.map((row) => ({
      date: normalizeDate(row[idx.date]),
      description: row[idx.description],
      amount: Number(String(row[idx.amount]).replace(/[^0-9.-]/g, '')),
    }));
    setImporting(true);
    setError('');
    try {
      const res = await api.post<ImportResult>('/transactions/import', { account_id: Number(accountId), transactions });
      setResult(res);
      setParsed(null);
      setFileName('');
      if (res.imported > 0) {
        celebrate();
        notifyDataChanged();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="stack">
      <div className="section-head" style={{ marginBottom: 0 }}>
        <div>
          <h2 className="section-title">Import a bank statement</h2>
          <p className="section-sub">
            Upload a CSV export from your bank. Duplicates are skipped automatically and new rows are categorized with
            your rules.
          </p>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {result && (
        <div role="status" className="notice notice--success">
          <CheckCircleIcon size={18} weight="fill" />
          <span className="notice-body">
            Imported <strong>{result.imported}</strong> new transaction{result.imported === 1 ? '' : 's'}.
            {result.skipped > 0 && ` Skipped ${result.skipped} (duplicates or unreadable rows).`}
          </span>
        </div>
      )}

      <Panel>
        {loaded && accounts.length === 0 ? (
          <EmptyState icon={BankIcon} title="Add an account first">
            Statements are imported into an account. <Link to="/accounts?add=1">Create one on the Accounts page</Link>,
            then come back here.
          </EmptyState>
        ) : (
        <div className="form-grid">
          <label>
            Into account
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Select an account…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="dropzone">
            <input type="file" accept=".csv,text/csv" onChange={handleFile} className="sr-only" />
            <UploadSimpleIcon size={18} />
            <span>{fileName || 'Choose a CSV file'}</span>
          </label>
        </div>
        )}
      </Panel>

      {parsed && (
        <Panel
          title={
            <div className="row">
              <FileCsvIcon size={18} weight="duotone" style={{ color: 'var(--text-2)' }} />
              <h2 className="panel-title">Check the columns</h2>
              <span className="chip">{parsed.rowCount} rows</span>
            </div>
          }
        >
          <div className="form-grid">
            {(['date', 'description', 'amount'] as const).map((field) => (
              <label key={field}>
                {field[0].toUpperCase() + field.slice(1)}
                <select value={mapping[field]} onChange={(e) => setMapping({ ...mapping, [field]: e.target.value })}>
                  {parsed.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Column ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <div className="table-scroll" style={{ marginTop: 18 }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 5).map((row, i) => (
                  <tr key={i}>
                    <td className="num">{row[Number(mapping.date)]}</td>
                    <td>{row[Number(mapping.description)]}</td>
                    <td className="num">{row[Number(mapping.amount)]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="row" style={{ marginTop: 18 }}>
            <button className="btn btn-primary" disabled={!accountId || importing} onClick={handleImport}>
              {importing ? 'Importing…' : `Import ${parsed.rowCount} transactions`}
            </button>
            {!accountId && <span className="small" style={{ color: 'var(--warning)' }}>Choose an account first.</span>}
          </div>
        </Panel>
      )}
    </div>
  );
}
