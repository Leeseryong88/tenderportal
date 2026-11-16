'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ref, uploadBytesResumable } from 'firebase/storage';
import { getAuthenticatedStorage, stagingPathUid } from '@/lib/firebase/client';
import { apiFetch } from '@/lib/client/api';
import { TENDER_MILESTONES } from '@/lib/domain/schedule';
import { formatDateTimeInZone } from '@/lib/domain/timezone';
import { PortalShell } from '@/components/layout/PortalShell';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DownloadButton } from '@/components/ui/DownloadButton';
import { StatusPill } from '@/components/ui/StatusPill';
import type { SupplierTenderViewDTO } from '@/types/domain';
import type { I18nKey } from '@/i18n/en';

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function fileKey(f: File): string {
  return `${f.name}:${f.size}:${f.lastModified}`;
}

export function SupplierTenderDetailClient({
  tenderId,
  displayName,
  email,
  organizationName,
}: {
  tenderId: string;
  displayName: string;
  email: string;
  organizationName: string;
}) {
  const { lang, tr, trv, trError } = useLanguage();
  const { showToast } = useToast();

  const [tender, setTender] = useState<SupplierTenderViewDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progressText, setProgressText] = useState('');

  const loadTender = useCallback(async () => {
    try {
      const res = await apiFetch<{ tender: SupplierTenderViewDTO }>(
        `/api/supplier/tenders/${tenderId}`
      );
      setTender(res.tender);
      setError('');
    } catch (err) {
      setError(trError(err));
    } finally {
      setLoading(false);
    }
  }, [tenderId, trError]);

  useEffect(() => {
    void loadTender();
  }, [loadTender]);

  useEffect(() => {
    if (!submitting) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [submitting]);

  const addFiles = (picked: File[]) => {
    setSelectedFiles((prev) => {
      const seen = new Set(prev.map(fileKey));
      return [...prev, ...picked.filter((f) => !seen.has(fileKey(f)))];
    });
  };

  const removeFile = (key: string) => {
    setSelectedFiles((prev) => prev.filter((f) => fileKey(f) !== key));
  };

  const handleReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tender || tender.windowState === 'CLOSED') return;
    if (!selectedFiles.length) {
      showToast(tr('supplierPortal.noFilesSelected'), 'error');
      return;
    }
    setReviewing(true);
  };

  const executeSubmit = async () => {
    if (!tender || !selectedFiles.length) return;
    setReviewing(false);
    setSubmitting(true);
    setProgressText('');

    try {
      const intentIds: string[] = [];

      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i]!;
        const position = `(${i + 1}/${selectedFiles.length})`;
        setProgressText(`${tr('supplierPortal.preparing')} ${position}: ${file.name}`);

        const intent = await apiFetch<{
          intentId: string;
          fileId: string;
          stagingPath: string;
        }>(`/api/supplier/tenders/${tenderId}/upload-intents`, {
          method: 'POST',
          body: JSON.stringify({
            originalName: file.name,
            contentType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
          }),
        });

        const storage = await getAuthenticatedStorage(stagingPathUid(intent.stagingPath));
        await new Promise<void>((resolve, reject) => {
          const uploadTask = uploadBytesResumable(ref(storage, intent.stagingPath), file);
          uploadTask.on(
            'state_changed',
            (snap) => {
              const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
              setProgressText(`${tr('common.uploading')} ${position} ${file.name}: ${pct}%`);
            },
            (err) => reject(err),
            () => resolve()
          );
        });

        intentIds.push(intent.intentId);
      }

      setProgressText(tr('supplierPortal.finalizing'));
      const idempotencyKey =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `sub_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      const finalized = await apiFetch<{
        submission: { receiptNumber: string; acceptedAt: string };
      }>(`/api/supplier/tenders/${tenderId}/submit`, {
        method: 'POST',
        body: JSON.stringify({ intentIds, idempotencyKey }),
      });

      // Only report success after the server transaction has committed.
      setSelectedFiles([]);
      setProgressText('');
      showToast(`${tr('supplierPortal.success')}: ${finalized.submission.receiptNumber}`);
      await loadTender();
    } catch (err) {
      setProgressText('');
      showToast(trError(err), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PortalShell
      role="SUPPLIER"
      displayName={displayName}
      email={email}
      organizationName={organizationName}
      crumbTitle={tender?.name || tr('nav.myTenders')}
    >
      <div style={{ marginBottom: 14 }}>
        <Link href="/supplier/tenders" className="btn small">
          ← {tr('nav.myTenders')}
        </Link>
      </div>

      {loading ? (
        <div className="card panel empty">{tr('common.loading')}</div>
      ) : error || !tender ? (
        <div className="notice danger">{error || tr('error.TENDER_ACCESS_DENIED')}</div>
      ) : (
        <>
          <div className="heading">
            <div>
              <h1>{tender.name}</h1>
              <p>
                {tender.code} · {tender.projectName} ({tender.projectLocation})
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <StatusPill
                status={tender.windowState}
                labelOverride={tr(`supplierPortal.window.${tender.windowState}`)}
              />
              <StatusPill
                status={tender.ownSubmissionState}
                labelOverride={tr(`supplierPortal.ownState.${tender.ownSubmissionState}`)}
              />
            </div>
          </div>

          <div className="grid">
            <section className="card panel">
              <div className="panel-title" style={{ marginBottom: 10 }}>
                {tr('supplierPortal.summary')}
              </div>
              <div className="detail-row">
                <span>{tr('tenders.deadline')}</span>
                <b>{formatDateTimeInZone(tender.deadlineAt, tender.timeZone, lang)}</b>
              </div>
              <div className="detail-row">
                <span>{tr('tenders.type')}</span>
                <b>{trv('category', tender.type)}</b>
              </div>
              <div className="detail-row">
                <span>{tr('tenders.requiredDocs')}</span>
                <b>{tender.requiredDocuments || '—'}</b>
              </div>
              {tender.description && (
                <div className="notice" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>
                  {tender.description}
                </div>
              )}

              <div className="panel-title" style={{ marginTop: 18, marginBottom: 8 }}>
                {tr('tenders.schedule')}
              </div>
              {TENDER_MILESTONES.map((st) => {
                const entry = tender.schedule?.[st.key] || { dateLocal: null, status: 'UNSET' };
                return (
                  <div key={st.key} className="detail-row">
                    <span>{tr(st.labelKey as I18nKey)}</span>
                    <b>
                      {entry.status === 'NOT_APPLICABLE'
                        ? tr('milestone.status.NOT_APPLICABLE')
                        : entry.status === 'PLANNED' && entry.dateLocal
                          ? entry.dateLocal
                          : tr('milestone.status.UNSET')}
                    </b>
                  </div>
                );
              })}
            </section>

            <section className="card panel">
              <div className="panel-title" style={{ marginBottom: 10 }}>
                {tr('tenders.rfpDocs')}
              </div>
              {tender.rfpFiles.length === 0 ? (
                <div className="subtle">{tr('supplierPortal.noRfp')}</div>
              ) : (
                tender.rfpFiles.map((f) => (
                  <div key={f.fileId} className="detail-row">
                    <span>
                      {f.originalName} <small className="subtle">({formatSize(f.sizeBytes)})</small>
                    </span>
                    <DownloadButton fileId={f.fileId} fileName={f.originalName} />
                  </div>
                ))
              )}

              <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '18px 0' }} />

              <div className="panel-title" style={{ marginBottom: 10 }}>
                {tender.ownSubmissionState === 'SUBMITTED'
                  ? tr('supplierPortal.resubmitProposal')
                  : tr('supplierPortal.submitProposal')}
              </div>

              {tender.ownSubmissionState === 'SUBMITTED' && (
                <div className="notice">
                  <b>
                    {tr('supplierPortal.receipt')}: {tender.latestReceiptNumber}
                  </b>
                  <br />
                  {tr('supplierPortal.acceptedAt')}:{' '}
                  {formatDateTimeInZone(tender.latestSubmittedAt, tender.timeZone, lang)} (v
                  {tender.latestVersionNumber})
                  <br />
                  {tr('supplierPortal.resubmitNotice')}
                </div>
              )}

              {tender.windowState === 'CLOSED' ? (
                <div className="notice warn">{tr('supplierPortal.closedNotice')}</div>
              ) : (
                <form onSubmit={handleReview}>
                  <div className="upload-zone">
                    <input
                      type="file"
                      multiple
                      disabled={submitting}
                      onChange={(e) => {
                        const picked = Array.from(e.target.files || []);
                        e.target.value = '';
                        addFiles(picked);
                      }}
                      data-testid="supplier-file-input"
                    />
                    <div style={{ marginTop: 8 }}>{tr('supplierPortal.chooseFiles')}</div>
                  </div>

                  {selectedFiles.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <b style={{ fontSize: 13 }}>
                        {tr('supplierPortal.selectedFiles')} ({selectedFiles.length})
                      </b>
                      <ul className="file-review-list">
                        {selectedFiles.map((f) => (
                          <li key={fileKey(f)}>
                            <span>
                              {f.name}
                              <small>{formatSize(f.size)}</small>
                            </span>
                            <button
                              type="button"
                              className="btn small"
                              disabled={submitting}
                              onClick={() => removeFile(fileKey(f))}
                            >
                              {tr('supplierPortal.removeFile')}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {progressText && (
                    <div className="notice" style={{ marginTop: 10 }} aria-live="polite">
                      {progressText}
                    </div>
                  )}

                  <div className="modal-actions">
                    <button
                      type="submit"
                      className="btn primary"
                      disabled={submitting || selectedFiles.length === 0}
                      data-testid="supplier-submit-btn"
                    >
                      {submitting
                        ? tr('common.loading')
                        : tender.ownSubmissionState === 'SUBMITTED'
                          ? tr('supplierPortal.resubmitProposal')
                          : tr('supplierPortal.submitProposal')}
                    </button>
                  </div>
                </form>
              )}

              {tender.submissionHistory.length > 0 && (
                <div style={{ marginTop: 18 }}>
                  <div className="panel-title" style={{ marginBottom: 8 }}>
                    {tr('supplierPortal.history')}
                  </div>
                  {tender.submissionHistory.map((ver) => (
                    <div key={ver.versionId} className="detail-box">
                      <div className="detail-row">
                        <span>
                          <b>v{ver.versionNumber}</b> · {ver.receiptNumber}
                        </span>
                        <span className="subtle">
                          {formatDateTimeInZone(ver.acceptedAt, tender.timeZone, lang)}
                        </span>
                      </div>
                      {ver.files.map((f) => (
                        <div key={f.fileId} className="detail-row">
                          <span>
                            {f.originalName} <StatusPill status={f.scanStatus} kind="scan" />
                          </span>
                          <DownloadButton fileId={f.fileId} fileName={f.originalName} scanStatus={f.scanStatus} />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {reviewing && (
            <ConfirmDialog
              title={tr('supplierPortal.reviewTitle')}
              body={tr('supplierPortal.reviewDesc')}
              confirmLabel={tr('supplierPortal.confirmSubmit')}
              onCancel={() => setReviewing(false)}
              onConfirm={() => void executeSubmit()}
            >
              <ul className="file-review-list" data-testid="submission-review-list">
                {selectedFiles.map((f) => (
                  <li key={fileKey(f)}>
                    <span>
                      {f.name}
                      <small>{formatSize(f.size)}</small>
                    </span>
                  </li>
                ))}
              </ul>
              {tender.ownSubmissionState === 'SUBMITTED' && (
                <div className="notice warn">{tr('supplierPortal.resubmitNotice')}</div>
              )}
            </ConfirmDialog>
          )}
        </>
      )}
    </PortalShell>
  );
}
