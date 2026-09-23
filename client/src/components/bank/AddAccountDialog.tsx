import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftIcon, ArrowRightIcon, BankIcon, FileCsvIcon, PencilSimpleIcon, type Icon } from '@phosphor-icons/react';
import { api } from '../../lib/api';
import { notifyDataChanged } from '../../lib/events';
import { Dialog } from '../Dialog';

export type AddMode = 'choose' | 'csv' | 'manual';

const ACCOUNT_TYPES = ['checking', 'savings', 'credit', 'loan', 'investment', 'cash', 'other'];
const EMPTY_FORM = { name: '', type: 'checking', institution: '', starting_balance: '0', is_liability: false };

const OPTIONS: { id: 'bank' | 'csv' | 'manual'; icon: Icon; title: string; body: string; badge?: string }[] = [
  {
    id: 'bank',
    icon: BankIcon,
    title: 'Connect a bank',
    body: 'Balances and transactions sync automatically from any NZ bank.',
    badge: 'Recommended',
  },
  {
    id: 'csv',
    icon: FileCsvIcon,
    title: 'Import a statement',
    body: 'Upload a CSV export from your internet banking.',
  },
  {
    id: 'manual',
    icon: PencilSimpleIcon,
    title: 'Track it by hand',
    body: 'Cash, savings jars, anything you want to enter yourself.',
  },
];

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type Props = {
  open: boolean;
  mode: AddMode;
  onModeChange: (mode: AddMode) => void;
  onClose: () => void;
  onConnectBank: () => void;
  onCreated: () => void;
};

/** One place to add any kind of account: synced, imported, or manual. */
export function AddAccountDialog({ open, mode, onModeChange, onClose, onConnectBank, onCreated }: Props) {
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function close() {
    setForm(EMPTY_FORM);
    setError('');
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const created = await api.post<{ id: number }>('/accounts', {
        name: form.name,
        type: form.type,
        institution: form.institution || null,
        starting_balance: Number(form.starting_balance) || 0,
        is_liability: form.is_liability ? 1 : 0,
      });
      notifyDataChanged();
      onCreated();
      const goImport = mode === 'csv';
      close();
      if (goImport) navigate(`/transactions?tab=import&account=${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the account');
    } finally {
      setSaving(false);
    }
  }

  const title = mode === 'choose' ? 'Add an account' : mode === 'csv' ? 'Import a statement' : 'Track an account by hand';

  return (
    <Dialog open={open} onClose={close} title={title}>
      {mode === 'choose' ? (
        <div className="option-list">
          {OPTIONS.map(({ id, icon: Glyph, title: optionTitle, body, badge }) => (
            <button
              key={id}
              type="button"
              className="option-card"
              onClick={() => {
                if (id === 'bank') {
                  close();
                  onConnectBank();
                } else onModeChange(id);
              }}
            >
              <span className="empty-icon">
                <Glyph size={20} weight="duotone" />
              </span>
              <span className="option-card-text">
                <span className="option-card-title">
                  {optionTitle}
                  {badge && <span className="chip chip--accent chip--xs">{badge}</span>}
                </span>
                <span className="muted small">{body}</span>
              </span>
              <ArrowRightIcon size={16} className="option-card-arrow" />
            </button>
          ))}
        </div>
      ) : (
        <form onSubmit={submit} className="stack" style={{ gap: 16 }}>
          <p className="muted small" style={{ margin: 0 }}>
            {mode === 'csv'
              ? 'First, name the account the statement belongs to. Next you’ll pick the CSV file.'
              : 'Enter the balance it has today. You can add transactions to it at any time.'}
          </p>
          <div className="form-grid form-grid--2">
            <label>
              Name
              <input
                required
                autoFocus
                placeholder="Everyday account"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              Type
              <select
                value={form.type}
                onChange={(e) =>
                  setForm({ ...form, type: e.target.value, is_liability: ['credit', 'loan'].includes(e.target.value) })
                }
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {capitalize(t)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Institution
              <input
                placeholder="e.g. Kiwibank"
                value={form.institution}
                onChange={(e) => setForm({ ...form, institution: e.target.value })}
              />
            </label>
            <label>
              {mode === 'csv' ? 'Balance before the statement' : 'Current balance'}
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                value={form.starting_balance}
                onChange={(e) => setForm({ ...form, starting_balance: e.target.value })}
              />
            </label>
          </div>
          <label className="inline">
            <input
              type="checkbox"
              checked={form.is_liability}
              onChange={(e) => setForm({ ...form, is_liability: e.target.checked })}
            />
            Money I owe (loan or credit card)
          </label>
          {error && (
            <p role="alert" className="small amount--bad" style={{ margin: 0 }}>
              {error}
            </p>
          )}
          <div className="wizard-actions">
            <button type="button" className="btn btn-ghost" onClick={() => onModeChange('choose')}>
              <ArrowLeftIcon size={14} /> Back
            </button>
            <span style={{ flex: 1 }} />
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? 'Saving…' : mode === 'csv' ? 'Next: choose file' : 'Save account'}
              {mode === 'csv' && <ArrowRightIcon size={14} weight="bold" />}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
