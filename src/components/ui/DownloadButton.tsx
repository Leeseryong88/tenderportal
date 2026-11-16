'use client';

import React, { useState } from 'react';
import { downloadStoredFile } from '@/lib/client/download';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useToast } from '@/components/providers/ToastProvider';

export function DownloadButton({ fileId, fileName }: { fileId: string; fileName: string }) {
  const { tr, trError } = useLanguage();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      className="btn small"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await downloadStoredFile(fileId, fileName);
        } catch (err) {
          showToast(trError(err), 'error');
        } finally {
          setBusy(false);
        }
      }}
    >
      ↓ {busy ? tr('common.loading') : tr('common.download')}
    </button>
  );
}
