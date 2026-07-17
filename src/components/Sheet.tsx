import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A right-side drawer (for editors) or centered modal (for confirms).
 * Traps focus, closes on Escape and scrim click, restores focus on unmount.
 */
export function Sheet({
  title,
  onClose,
  children,
  footer,
  variant = 'drawer',
  wide = false,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  variant?: 'drawer' | 'modal';
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const restore = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restore.current = document.activeElement as HTMLElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Tab') {
        // Minimal focus trap: keep Tab inside the sheet.
        const focusables = ref.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (!focusables || !focusables.length) return;
        const list = Array.from(focusables).filter((el) => el.offsetParent !== null);
        if (!list.length) return;
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      restore.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()} style={variant === 'modal' ? {} : { justifyContent: 'flex-end' }}>
      <div
        className={variant === 'modal' ? 'modal' : 'drawer'}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        style={wide ? { width: 'min(760px, 100%)' } : undefined}
      >
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close" title="Close (Esc)">
            ✕
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({
  title,
  body,
  confirmLabel = 'Delete',
  danger = true,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Sheet
      variant="modal"
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className={`btn ${danger ? 'danger primary' : 'primary'}`} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div style={{ color: 'var(--ink-2)', lineHeight: 1.55 }}>{body}</div>
    </Sheet>
  );
}
