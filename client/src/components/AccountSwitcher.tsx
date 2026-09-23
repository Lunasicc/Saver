import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { CaretDownIcon, CheckIcon, XIcon } from '@phosphor-icons/react';
import { netBalance, useAccountFocus } from '../lib/accountFocus';
import { formatMoney } from '../lib/format';
import type { Account } from '../lib/types';
import { AccountTypeIcon } from './AccountTypeIcon';

function accountMeta(a: Account) {
  return [a.institution, a.account_mask ? `•• ${a.account_mask}` : null].filter(Boolean).join(' · ');
}

/** Top-bar picker for the account the whole app focuses on. Hidden with fewer than two accounts. */
export function AccountSwitcher() {
  const { accounts, focus, focusId, setFocus } = useAccountFocus();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    // Start keyboard users on the current choice.
    const current = menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    current?.focus();
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  if (!accounts || accounts.length < 2) return null;

  const total = accounts.reduce((s, a) => s + netBalance(a), 0);

  function choose(id: number | null) {
    setFocus(id);
    setOpen(false);
    buttonRef.current?.focus();
  }

  function onMenuKey(e: React.KeyboardEvent) {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const move = (i: number) => items[(i + items.length) % items.length]?.focus();
    if (e.key === 'ArrowDown') move(index + 1);
    else if (e.key === 'ArrowUp') move(index - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(items.length - 1);
    else if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false);
      if (e.key === 'Escape') buttonRef.current?.focus();
      return;
    } else return;
    e.preventDefault();
  }

  return (
    <div className="acct-switch" ref={rootRef}>
      <button
        ref={buttonRef}
        className={`acct-switch-btn${focus ? ' acct-switch-btn--focused' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Showing ${focus ? focus.name : 'all accounts'}. Switch account`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <AccountTypeIcon type={focus ? focus.type : 'all'} size={15} weight={focus ? 'fill' : 'regular'} />
        {focus ? (
          <span className="acct-switch-label">{focus.name}</span>
        ) : (
          <span className="acct-switch-label">
            <span className="acct-switch-long">All accounts</span>
            <span className="acct-switch-short">All</span>
          </span>
        )}
        <CaretDownIcon size={12} weight="bold" className="acct-switch-caret" />
      </button>
      {focus && (
        <button className="acct-switch-clear" aria-label="Show all accounts" title="Show all accounts" onClick={() => choose(null)}>
          <XIcon size={11} weight="bold" />
        </button>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            className="acct-menu"
            role="menu"
            aria-label="Focus on an account"
            onKeyDown={onMenuKey}
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="acct-menu-head">Focus on</div>
            <MenuItem
              type="all"
              title="All accounts"
              meta={`${accounts.length} accounts · net worth`}
              amount={total}
              checked={focusId === null}
              onSelect={() => choose(null)}
            />
            <div className="acct-menu-sep" role="separator" />
            <div className="acct-menu-list">
              {accounts.map((a) => (
                <MenuItem
                  key={a.id}
                  type={a.type}
                  title={a.name}
                  meta={accountMeta(a) || a.type}
                  amount={netBalance(a)}
                  currency={a.currency}
                  checked={focusId === a.id}
                  onSelect={() => choose(a.id)}
                />
              ))}
            </div>
            <Link to="/accounts" className="acct-menu-foot" role="menuitem" onClick={() => setOpen(false)}>
              Manage accounts
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuItem({
  type,
  title,
  meta,
  amount,
  currency,
  checked,
  onSelect,
}: {
  type: string;
  title: string;
  meta: string;
  amount: number;
  currency?: string;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      role="menuitemradio"
      aria-checked={checked}
      tabIndex={-1}
      className={`acct-item${checked ? ' acct-item--on' : ''}`}
      onClick={onSelect}
    >
      <span className="acct-item-icon">
        <AccountTypeIcon type={type} size={16} weight="duotone" />
      </span>
      <span className="acct-item-main">
        <span className="acct-item-title">{title}</span>
        <span className="acct-item-meta">{meta}</span>
      </span>
      <span className={`acct-item-amount num${amount < 0 ? ' amount--bad' : ''}`}>{formatMoney(amount, currency)}</span>
      <span className="acct-item-check">{checked && <CheckIcon size={14} weight="bold" />}</span>
    </button>
  );
}

/** Reminds you a page is focused on one account, with a one-click way back to everything. */
export function FocusNote({ detail }: { detail?: string }) {
  const { focus, setFocus } = useAccountFocus();
  if (!focus) return null;
  return (
    <div className="focus-note" role="status">
      <AccountTypeIcon type={focus.type} size={14} weight="fill" />
      <span>
        Showing <strong>{focus.name}</strong> only{detail ? `. ${detail}` : ''}
      </span>
      <button className="focus-note-clear" onClick={() => setFocus(null)}>
        Show all accounts
      </button>
    </div>
  );
}
