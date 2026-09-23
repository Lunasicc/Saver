import { useEffect, useRef, type ReactNode } from 'react';
import { XIcon } from '@phosphor-icons/react';

type Props = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
  /** Keep the dialog open on Escape / backdrop clicks (e.g. while a sync runs). */
  locked?: boolean;
};

/** Native <dialog> modal: focus trapping, Escape and top-layer stacking come for free. */
export function Dialog({ open, onClose, title, children, wide = false, locked = false }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`dialog${wide ? ' dialog--wide' : ''}`}
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!locked) onClose();
      }}
      onMouseDown={(e) => {
        // Clicking the backdrop lands on the <dialog> element itself.
        if (e.target === ref.current && !locked) onClose();
      }}
    >
      {open && (
        <div className="dialog-inner">
          <header className="dialog-head">
            <h2 id="dialog-title" className="dialog-title">
              {title}
            </h2>
            <button className="btn btn-icon" aria-label="Close" onClick={onClose} disabled={locked}>
              <XIcon size={16} />
            </button>
          </header>
          {children}
        </div>
      )}
    </dialog>
  );
}
