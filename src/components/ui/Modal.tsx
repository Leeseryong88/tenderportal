'use client';

import React, { useEffect } from 'react';
import { useLanguage } from '@/components/providers/LanguageProvider';

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  maxWidth,
  dismissOnBackdrop = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: number;
  /** Off by default so a stray click outside a form does not discard typed input. */
  dismissOnBackdrop?: boolean;
}) {
  const { tr } = useLanguage();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="modal-back"
      onClick={(e) => {
        if (dismissOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={maxWidth ? { width: `min(${maxWidth}px, 100%)` } : undefined}
      >
        <button type="button" className="modal-close" onClick={onClose} aria-label={tr('common.close')}>
          ×
        </button>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
