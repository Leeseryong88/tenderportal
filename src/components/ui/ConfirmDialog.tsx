'use client';

import React from 'react';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { Modal } from './Modal';

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}) {
  const { tr } = useLanguage();
  return (
    <Modal title={title} onClose={onCancel} maxWidth={460} dismissOnBackdrop>
      {body && <p className="confirm-text">{body}</p>}
      {children}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          {tr('common.cancel')}
        </button>
        <button
          type="button"
          className={danger ? 'btn danger' : 'btn primary'}
          onClick={onConfirm}
          disabled={busy}
          data-testid="confirm-dialog-ok"
          autoFocus
        >
          {busy ? tr('common.loading') : confirmLabel || tr('common.confirm')}
        </button>
      </div>
    </Modal>
  );
}
