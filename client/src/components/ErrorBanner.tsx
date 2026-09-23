import { motion } from 'framer-motion';
import { CheckCircleIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

/**
 * Shown when an API call fails, so a backend/network error surfaces as a clear
 * message instead of an empty page or an endless loading state.
 */
export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <motion.div role="alert" className="notice notice--error" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
      <WarningCircleIcon size={18} weight="fill" />
      <span className="notice-body">{message}</span>
      {onRetry && (
        <button className="btn btn-secondary btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </motion.div>
  );
}

export function SuccessNotice({ children, onDismiss }: { children: ReactNode; onDismiss?: () => void }) {
  return (
    <motion.div role="status" className="notice notice--success" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
      <CheckCircleIcon size={18} weight="fill" />
      <span className="notice-body">{children}</span>
      {onDismiss && (
        <button className="btn btn-icon" aria-label="Dismiss" onClick={onDismiss}>
          <XIcon size={14} />
        </button>
      )}
    </motion.div>
  );
}
