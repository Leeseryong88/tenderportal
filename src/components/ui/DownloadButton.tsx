'use client';

import React, { useState } from 'react';
import { downloadStoredFile } from '@/lib/client/download';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useToast } from '@/components/providers/ToastProvider';

export function DownloadButton({
  fileId,
  fileName,
  scanStatus,
}: {
  fileId: string;
  fileName: string;
  scanStatus?: string;
}) {
  const { tr, trError } = useLanguage();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const blocked = scanStatus !== undefined && scanStatus !== 'CLEAN';

  return (
    <button
      type="button"
      className="btn small"
      disabled={busy || blocked}
      title={blocked ? tr('error.FILE_SCAN_NOT_CLEAN') : undefined}
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
