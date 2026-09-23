import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowsClockwiseIcon,
  BankIcon,
  CheckCircleIcon,
  CheckIcon,
  EyeIcon,
  KeyIcon,
  LockSimpleIcon,
  PlugsConnectedIcon,
  ShieldCheckIcon,
  UserPlusIcon,
} from '@phosphor-icons/react';
import { api } from '../../lib/api';
import {
  AKAHU_URLS,
  allAccounts,
  describeSync,
  type AkahuStatus,
  type BankConnection,
  type ConnectionsResponse,
  type SyncResult,
} from '../../lib/akahu';
import { formatMoney } from '../../lib/format';
import { celebrate } from '../../lib/celebrate';
import { notifyDataChanged } from '../../lib/events';
import { useAkahuPopup } from '../../lib/useAkahuPopup';
import { Dialog } from '../Dialog';
import { BankLogo, PopupHint } from './parts';

const STEPS = ['Akahu account', 'Connect banks', 'Link Saver', 'Choose accounts', 'Import'];

type Props = {
  open: boolean;
  onClose: () => void;
  status: AkahuStatus | null;
  onStatusChange: (status: AkahuStatus) => void;
};

/**
 * Guided bank setup. Bank logins happen on Akahu's site (banks require it), so
 * each outside step opens a popup and the wizard notices when you're back.
 */
export function SetupWizard({ open, onClose, status, onStatusChange }: Props) {
  const [step, setStep] = useState(0);
  const [syncing, setSyncing] = useState(false);

  // Already linked (e.g. tokens in server/.env)? Jump straight to choosing accounts.
  useEffect(() => {
    if (open) setStep(status?.configured ? 3 : 0);
    // Only when the dialog opens; status updates mid-flow shouldn't reset the step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} title="Connect your bank" wide locked={syncing}>
      <ol className="wizard-steps" aria-label="Setup progress">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={`wizard-step${i === step ? ' is-current' : ''}${i < step ? ' is-done' : ''}`}
            aria-current={i === step ? 'step' : undefined}
          >
            <span className="wizard-step-dot">{i < step ? <CheckIcon size={11} weight="bold" /> : i + 1}</span>
            <span className="wizard-step-label">{label}</span>
          </li>
        ))}
      </ol>

      <div className="wizard-body">
        {step === 0 && <StepAkahuAccount onNext={() => setStep(1)} />}
        {step === 1 && <StepConnectBanks onBack={() => setStep(0)} onNext={() => setStep(2)} />}
        {step === 2 && (
          <StepTokens
            onBack={() => setStep(1)}
            onLinked={(next) => {
              onStatusChange(next);
              notifyDataChanged();
              setStep(3);
            }}
          />
        )}
        {(step === 3 || step === 4) && (
          <StepChooseAndImport
            importing={step === 4}
            onBack={status?.source === 'app' ? () => setStep(2) : undefined}
            onImport={() => setStep(4)}
            onSyncingChange={setSyncing}
            onFinished={onClose}
            onRetry={() => setStep(3)}
          />
        )}
      </div>
    </Dialog>
  );
}

function StepAkahuAccount({ onNext }: { onNext: () => void }) {
  const popup = useAkahuPopup();
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div>
        <h3 className="wizard-title">Saver connects to your bank through Akahu</h3>
        <p className="muted">
          Akahu is New Zealand's open-banking service. It works with every major NZ bank, and it's free for personal use.
          You need a free Akahu account first.
        </p>
      </div>
      <ul className="assurance-list">
        <li>
          <EyeIcon size={18} weight="duotone" />
          <span>
            <strong>Read-only.</strong> Saver can see balances and transactions. It can't move money.
          </span>
        </li>
        <li>
          <ShieldCheckIcon size={18} weight="duotone" />
          <span>
            <strong>You log in to your bank on the bank's own page.</strong> Saver never sees your bank password.
          </span>
        </li>
        <li>
          <LockSimpleIcon size={18} weight="duotone" />
          <span>
            <strong>Stays on this computer.</strong> Your data and access keys are saved locally and nowhere else.
          </span>
        </li>
      </ul>
      <PopupHint
        state={popup.state}
        url={popup.url}
        onDone={popup.markDone}
        waitingText="Create your account in the Akahu window, then come back here."
        returnedText="Nice. Next, connect your banks."
      />
      <div className="wizard-actions">
        <button className="btn btn-secondary" onClick={onNext}>
          I already have one
        </button>
        {popup.state === 'returned' ? (
          <button className="btn btn-primary" onClick={onNext}>
            Continue <ArrowRightIcon size={14} weight="bold" />
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => popup.open(AKAHU_URLS.home)}>
            <UserPlusIcon size={15} weight="bold" /> Create a free Akahu account
          </button>
        )}
      </div>
    </div>
  );
}

function StepConnectBanks({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const popup = useAkahuPopup();
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div>
        <h3 className="wizard-title">Connect your banks in Akahu</h3>
        <p className="muted">Add every bank you want in Saver. You can add more at any time.</p>
      </div>
      <ol className="connect-steps">
        <li>
          In the Akahu window, open <strong>Connections</strong> and choose <strong>Add connection</strong>.
        </li>
        <li>Pick your bank and log in on its secure page.</li>
        <li>Choose the accounts to share, then close the window.</li>
      </ol>
      <PopupHint
        state={popup.state}
        url={popup.url}
        onDone={popup.markDone}
        waitingText="Connect your banks in the Akahu window, then come back here."
        returnedText="Got it. One last step: link Saver to Akahu."
      />
      <div className="wizard-actions">
        <button className="btn btn-ghost" onClick={onBack}>
          <ArrowLeftIcon size={14} /> Back
        </button>
        <span style={{ flex: 1 }} />
        <button className={`btn ${popup.state === 'returned' ? 'btn-secondary' : 'btn-ghost'}`} onClick={onNext}>
          Already done
        </button>
        {popup.state === 'returned' ? (
          <button className="btn btn-primary" onClick={onNext}>
            Continue <ArrowRightIcon size={14} weight="bold" />
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => popup.open(AKAHU_URLS.connections)}>
            <BankIcon size={15} weight="bold" /> Open Akahu connections
          </button>
        )}
      </div>
    </div>
  );
}

function StepTokens({ onBack, onLinked }: { onBack: () => void; onLinked: (status: AkahuStatus) => void }) {
  const popup = useAkahuPopup();
  const [appToken, setAppToken] = useState('');
  const [userToken, setUserToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // People often paste the tokens into the wrong boxes; route them by prefix.
  function handleToken(value: string, field: 'app' | 'user') {
    const v = value.trim();
    if (v.startsWith('user_token_')) setUserToken(v);
    else if (v.startsWith('app_token_')) setAppToken(v);
    else if (field === 'app') setAppToken(value);
    else setUserToken(value);
    if (field === 'app' && v.startsWith('user_token_')) setAppToken((prev) => (prev === value ? '' : prev));
    if (field === 'user' && v.startsWith('app_token_')) setUserToken((prev) => (prev === value ? '' : prev));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await api.put<AkahuStatus & { accounts: number }>('/akahu/credentials', {
        appToken: appToken.trim(),
        userToken: userToken.trim(),
      });
      onLinked(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="stack" style={{ gap: 18 }} onSubmit={submit}>
      <div>
        <h3 className="wizard-title">Link Saver to your Akahu account</h3>
        <p className="muted">
          Akahu gives you two access keys, called tokens. They let this copy of Saver read your accounts.
        </p>
      </div>
      <ol className="connect-steps">
        <li>
          <button type="button" className="link-button" onClick={() => popup.open(AKAHU_URLS.developers)}>
            Open Akahu Developers <KeyIcon size={12} />
          </button>
        </li>
        <li>Accept the developer terms and turn on two-factor sign-in if Akahu asks you to.</li>
        <li>Copy the App ID Token and the User Access Token into the boxes below.</li>
      </ol>
      <PopupHint
        state={popup.state}
        url={popup.url}
        onDone={popup.markDone}
        waitingText="Copy both tokens from the Akahu window, then paste them below."
        returnedText="Paste both tokens below."
      />
      <div className="form-grid form-grid--2">
        <label>
          App ID Token
          <input
            className="mono"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="app_token_…"
            value={appToken}
            onChange={(e) => handleToken(e.target.value, 'app')}
            required
          />
        </label>
        <label>
          User Access Token
          <input
            className="mono"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="user_token_…"
            value={userToken}
            onChange={(e) => handleToken(e.target.value, 'user')}
            required
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="small amount--bad">
          {error}
        </p>
      )}
      <div className="wizard-actions">
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          <ArrowLeftIcon size={14} /> Back
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary" type="submit" disabled={saving || !appToken || !userToken}>
          <PlugsConnectedIcon size={15} weight="bold" />
          {saving ? 'Checking with Akahu…' : 'Verify and continue'}
        </button>
      </div>
    </form>
  );
}

function StepChooseAndImport({
  importing,
  onBack,
  onImport,
  onSyncingChange,
  onFinished,
  onRetry,
}: {
  importing: boolean;
  onBack?: () => void;
  onImport: () => void;
  onSyncingChange: (busy: boolean) => void;
  onFinished: () => void;
  onRetry: () => void;
}) {
  const popup = useAkahuPopup();
  const [connections, setConnections] = useState<BankConnection[] | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [months, setMonths] = useState(12);
  const [loadError, setLoadError] = useState('');
  const [result, setResult] = useState<SyncResult | null>(null);
  const [syncError, setSyncError] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const res = await api.get<ConnectionsResponse>('/akahu/connections');
      setConnections(res.connections);
      setSelected((prev) => {
        const next = { ...prev };
        for (const a of allAccounts(res.connections)) if (!(a.akahuId in next)) next[a.akahuId] = a.included;
        return next;
      });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load your accounts');
      setConnections((c) => c ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const accounts = useMemo(() => (connections ? allAccounts(connections) : []), [connections]);
  const chosen = accounts.filter((a) => selected[a.akahuId]);

  // While the person is off adding a bank, check for it every few seconds.
  useEffect(() => {
    if (popup.state !== 'open' && popup.state !== 'returned') return;
    void load();
    if (popup.state !== 'open') return;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [popup.state, load]);

  async function runImport() {
    onImport();
    onSyncingChange(true);
    setSyncError('');
    try {
      await api.patch('/akahu/accounts', {
        changes: accounts.map((a) => ({ akahuId: a.akahuId, included: Boolean(selected[a.akahuId]) })),
      });
      const res = await api.post<SyncResult>('/akahu/sync', { months });
      setResult(res);
      notifyDataChanged();
      if (res.transactionsImported > 0) celebrate();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      onSyncingChange(false);
    }
  }

  if (importing) {
    if (syncError) {
      return (
        <div className="wizard-result">
          <p role="alert" className="amount--bad">
            {syncError}
          </p>
          <div className="wizard-actions">
            <button className="btn btn-primary" onClick={onRetry}>
              <ArrowLeftIcon size={14} /> Back to accounts
            </button>
          </div>
        </div>
      );
    }
    if (!result) {
      return (
        <div className="wizard-result" aria-busy="true">
          <ArrowsClockwiseIcon size={34} className="spin" style={{ color: 'var(--accent)' }} />
          <h3 className="wizard-title">Importing from your banks…</h3>
          <p className="muted">
            Pulling up to {months} months of transactions and sorting them into categories. This can take a minute.
          </p>
        </div>
      );
    }
    return (
      <div className="wizard-result">
        <CheckCircleIcon size={40} weight="fill" style={{ color: 'var(--accent)' }} />
        <h3 className="wizard-title">You're all set</h3>
        <p className="muted">
          {result.accountsSynced} account{result.accountsSynced === 1 ? '' : 's'} connected · {describeSync(result)}
        </p>
        <p className="small muted">
          Saver syncs automatically when you open it. You can manage your banks any time on the Accounts page.
        </p>
        <div className="wizard-actions" style={{ justifyContent: 'center' }}>
          <button className="btn btn-secondary" onClick={onFinished}>
            Stay here
          </button>
          <Link to="/" className="btn btn-primary" onClick={onFinished}>
            See where your money goes <ArrowRightIcon size={14} weight="bold" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div>
        <h3 className="wizard-title">Choose what to bring into Saver</h3>
        <p className="muted">Turn off any accounts you don't want to track. You can change this later.</p>
      </div>

      {connections === null ? (
        <p className="muted">Looking for your accounts…</p>
      ) : loadError ? (
        <p role="alert" className="small amount--bad">
          {loadError}{' '}
          <button className="link-button small" onClick={() => void load()}>
            Try again
          </button>
        </p>
      ) : accounts.length === 0 ? (
        <div className="wizard-empty">
          <BankIcon size={26} weight="duotone" />
          <div>
            <strong>No bank accounts in Akahu yet</strong>
            <p className="muted small">Connect a bank in Akahu. Saver will spot it as soon as it's ready.</p>
          </div>
        </div>
      ) : (
        <div className="choose-list">
          {connections.map((c) => (
            <fieldset key={c.id} className="choose-bank">
              <legend className="choose-bank-head">
                <BankLogo name={c.name} logo={c.logo} size={26} />
                <span>{c.name}</span>
              </legend>
              {c.accounts.map((a) => (
                <label key={a.akahuId} className="choose-account">
                  <input
                    type="checkbox"
                    checked={Boolean(selected[a.akahuId])}
                    onChange={(e) => setSelected((s) => ({ ...s, [a.akahuId]: e.target.checked }))}
                  />
                  <span className="choose-account-name">
                    {a.name}
                    {a.mask && <span className="mono muted small"> •• {a.mask}</span>}
                  </span>
                  {a.balance !== null && (
                    <span className={`num small${a.isLiability ? ' amount--bad' : ' muted'}`}>
                      {formatMoney(a.balance, a.currency)}
                    </span>
                  )}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      )}

      <PopupHint
        state={popup.state}
        url={popup.url}
        onDone={popup.markDone}
        waitingText="Add your bank in the Akahu window. New accounts will appear here."
        returnedText="Checked Akahu for new accounts."
      />

      <div className="wizard-actions">
        {onBack && (
          <button className="btn btn-ghost" onClick={onBack}>
            <ArrowLeftIcon size={14} /> Back
          </button>
        )}
        <button className="btn btn-ghost" onClick={() => popup.open(AKAHU_URLS.connections)}>
          <BankIcon size={15} /> Add another bank
        </button>
        <span style={{ flex: 1 }} />
        <select aria-label="How much history to import" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
          <option value={3}>Last 3 months</option>
          <option value={12}>Last 12 months</option>
          <option value={24}>Last 2 years</option>
        </select>
        <button className="btn btn-primary" onClick={runImport} disabled={chosen.length === 0}>
          Import {chosen.length} account{chosen.length === 1 ? '' : 's'} <ArrowRightIcon size={14} weight="bold" />
        </button>
      </div>
    </div>
  );
}
