import { useState } from 'react';
import { ArrowSquareOutIcon, CheckIcon, WarningIcon } from '@phosphor-icons/react';
import type { PopupState } from '../../lib/useAkahuPopup';

/** Inline status for an Akahu popup: waiting, blocked, or back again. */
export function PopupHint({
  state,
  url,
  onDone,
  waitingText = 'Finish up in the Akahu window, then come back here.',
  returnedText = 'Welcome back.',
}: {
  state: PopupState;
  url: string;
  onDone: () => void;
  waitingText?: string;
  returnedText?: string;
}) {
  if (state === 'idle') return null;
  if (state === 'blocked') {
    return (
      <div className="popup-hint popup-hint--warn" role="status">
        <WarningIcon size={16} weight="fill" />
        <span>
          Your browser blocked the popup.{' '}
          <a href={url} target="_blank" rel="noreferrer" onClick={onDone}>
            Open Akahu in a new tab <ArrowSquareOutIcon size={12} />
          </a>
        </span>
      </div>
    );
  }
  if (state === 'open') {
    return (
      <div className="popup-hint" role="status">
        <span className="live-dot" aria-hidden="true" />
        <span>{waitingText}</span>
        <button type="button" className="link-button small" onClick={onDone}>
          I'm done
        </button>
      </div>
    );
  }
  return (
    <div className="popup-hint popup-hint--done" role="status">
      <CheckIcon size={15} weight="bold" />
      <span>{returnedText}</span>
    </div>
  );
}

/** Bank logo from Akahu's CDN, falling back to initials if it can't load. */
export function BankLogo({ name, logo, size = 36 }: { name: string; logo: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="bank-logo" style={{ width: size, height: size }} aria-hidden="true">
      {logo && !failed ? (
        <img src={logo} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <span className="bank-logo-initials">{initials || '?'}</span>
      )}
    </span>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      className={`switch${checked ? ' switch--on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-thumb" />
    </button>
  );
}
