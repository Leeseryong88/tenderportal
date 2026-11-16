'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ref, uploadBytesResumable } from 'firebase/storage';
import { getFirebaseClientStorage } from '@/lib/firebase/client';
import { apiFetch } from '@/lib/client/api';
import { TENDER_MILESTONES } from '@/lib/domain/schedule';
import { formatDateTimeInZone } from '@/lib/domain/timezone';
import { PortalShell } from '@/components/layout/PortalShell';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { StatusPill } from '@/components/ui/StatusPill';
import type { SupplierTenderViewDTO } from '@/types/domain';
import type { I18nKey } from '@/i18n/en';

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
  const { lang, tr } = useLanguage();
  const { showToast } = useToast();

  const [tender, setTender] = useState<SupplierTenderViewDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
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
      setError(err instanceof Error ? err.message : 'Unable to load tender.');
    } finally {
      setLoading(false);
    }
  }, [tenderId]);

  useEffect(() => {
    void loadTender();
  }, [loadTender]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tender || tender.windowState === 'CLOSED') return;
    if (!selectedFiles.length) {
      showToast(
        lang === 'ko' ? '제출할 파일을 선택하세요.' : 'Select one or more files to submit.',
        'error'
      );
      return;
    }

    setSubmitting(true);
    setProgressText('');

    try {
      const storage = getFirebaseClientStorage();
      const intentIds: string[] = [];

      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i]!;
        setProgressText(
          `${lang === 'ko' ? '업로드 준비 중' : 'Preparing upload'} (${i + 1}/${selectedFiles.length}): ${file.name}`
        );

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

        await new Promise<void>((resolve, reject) => {
          const uploadTask = uploadBytesResumable(ref(storage, intent.stagingPath), file);
          uploadTask.on(
            'state_changed',
            (snap) => {
              const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
              setProgressText(`${file.name}: ${pct}%`);
            },
            (err) => reject(err),
            () => resolve()
          );
        });

        intentIds.push(intent.intentId);
      }

      setProgressText(lang === 'ko' ? '서버 접수 확정 중...' : 'Finalizing server submission...');
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

      // Only show success toast AFTER server transaction commits!
      setSelectedFiles([]);
      setProgressText('');
      showToast(
        `${lang === 'ko' ? '제출이 접수되었습니다' : 'Submission received'}: ${finalized.submission.receiptNumber}`
      );
      await loadTender();
    } catch (err) {
      setProgressText('');
      showToast(err instanceof Error ? err.message : 'Submission failed.', 'error');
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
        <div className="notice danger">{error || 'Access denied.'}</div>
      ) : (
        <>
          <div className="heading">
            <div>
              <h1>{tender.name}</h1>
              <p>
                {tender.code} · {tender.projectName} ({tender.projectLocation})
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
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
                Tender Summary
              </div>
              <div className="detail-row">
                <span>{tr('tenders.deadline')}</span>
                <b>{formatDateTimeInZone(tender.deadlineAt, tender.timeZone, lang)}</b>
              </div>
              <div className="detail-row">
                <span>{tr('tenders.type')}</span>
                <b>{tender.type}</b>
              </div>
              <div className="detail-row">
                <span>{tr('tenders.requiredDocs')}</span>
                <b>{tender.requiredDocuments || '—'}</b>
              </div>
              {tender.description && (
                <div className="notice" style={{ marginTop: 10 }}>
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
                <div className="subtle">No published RFP files yet.</div>
              ) : (
                tender.rfpFiles.map((f) => (
                  <div key={f.fileId} className="detail-row">
                    <span>
                      {f.originalName} ({Math.max(1, Math.round(f.sizeBytes / 1024))} KB)
                    </span>
                    <a
                      className="btn small"
                      href={`/api/files/${f.fileId}/download`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      ↓ {tr('common.download')}
                    </a>
                  </div>
                ))
              )}

              <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '18px 0' }} />

              <div className="panel-title" style={{ marginBottom: 10 }}>
                {tr('supplierPortal.submitProposal')}
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
                </div>
              )}

              {tender.windowState === 'CLOSED' ? (
                <div className="notice warn">
                  {lang === 'ko'
                    ? '입찰 마감되었습니다. 신규 제출이 비활성화되어 있습니다.'
                    : 'This tender is closed. New submissions are disabled.'}
                </div>
              ) : (
                <form onSubmit={handleSubmit}>
                  <div className="upload-zone">
                    <input
                      type="file"
                      multiple
                      disabled={submitting}
                      onChange={(e) => setSelectedFiles(Array.from(e.target.files || []))}
                      data-testid="supplier-file-input"
                    />
                    <div style={{ marginTop: 8 }}>
                      {selectedFiles.length
                        ? selectedFiles.map((f) => f.name).join(', ')
                        : lang === 'ko'
                          ? '제출할 제안서 및 견적 파일을 선택하세요 (API 서버를 거치지 않고 암호화 스토리지로 직접 전송됩니다)'
                          : 'Choose proposal & quotation files (uploaded directly to encrypted storage)'}
                    </div>
                  </div>

                  {progressText && (
                    <div className="notice" style={{ marginTop: 10 }}>
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
                    Submission Receipts & History
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
                            {f.originalName} <StatusPill status={f.scanStatus} />
                          </span>
                          <a
                            className="btn small"
                            href={`/api/files/${f.fileId}/download`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            ↓ {tr('common.download')}
                          </a>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </PortalShell>
  );
}
