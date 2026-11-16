'use client';

import { ApiClientError } from './api';

export async function downloadStoredFile(fileId: string, fileName: string): Promise<void> {
  const res = await fetch(`/api/files/${encodeURIComponent(fileId)}/download`, {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    const err = payload?.error || {};
    throw new ApiClientError(res.status, err.code || 'API_ERROR', err.message || `Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
