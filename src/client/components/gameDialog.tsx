import React, { useEffect, useRef } from 'react';

interface Props {
  open: boolean;
  labelId: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

/** Native modal semantics provide focus containment, Escape, and an inert background. */
export function GameDialog({ open, labelId, onClose, children, className = '' }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    if (!dialog.open) dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  return (
    <dialog
      ref={dialogRef}
      className={`game-dialog ${className}`}
      aria-labelledby={labelId}
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
