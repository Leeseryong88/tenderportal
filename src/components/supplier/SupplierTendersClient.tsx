'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/client/api';
import { formatDateTimeInZone } from '@/lib/domain/timezone';
import { PortalShell } from '@/components/layout/PortalShell';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { StatusPill } from '@/components/ui/StatusPill';
import type { SupplierTenderViewDTO } from '@/types/domain';

export function SupplierTendersClient({
  displayName,
  email,
  organizationName,
}: {
  displayName: string;
  email: string;
  organizationName: string;
}) {
  const { lang, tr } = useLanguage();
  const { showToast } = useToast();
  const [companyName, setCompanyName] = useState('');
  const [tenders, setTenders] = useState<SupplierTenderViewDTO[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTenders = useCallback(async () => {
    try {
      const res = await apiFetch<{ companyName: string; tenders: SupplierTenderViewDTO[] }>(
        '/api/supplier/tenders'
      );
      setCompanyName(res.companyName);
      setTenders(res.tenders);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load tenders', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadTenders();
  }, [loadTenders]);

  const openActionRequired = tenders.filter(
    (t) => t.windowState === 'OPEN' && t.ownSubmissionState === 'NOT_SUBMITTED'
  ).length;
  const submittedCount = tenders.filter((t) => t.ownSubmissionState === 'SUBMITTED').length;

  return (
    <PortalShell
      role="SUPPLIER"
      displayName={displayName}
      email={email}
      organizationName={organizationName}
      crumbTitle={tr('nav.myTenders')}
    >
      <div className="heading">
        <div>
          <h1>{tr('supplierPortal.welcome', { company: companyName || displayName })}</h1>
          <p>{tr('supplierPortal.sub')}</p>
        </div>
      </div>

      <section className="stats">
        <div className="card stat">
          <div className="stat-label">{tr('supplierPortal.myInvitations')}</div>
          <div className="stat-value">{tenders.length}</div>
          <div className="stat-foot">Assigned tenders</div>
        </div>
        <div className="card stat">
          <div className="stat-label">{tr('supplierPortal.actionRequired')}</div>
          <div className="stat-value">{openActionRequired}</div>
          <div className="stat-foot">{tr('supplierPortal.window.OPEN')}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">{tr('supplierPortal.submitted')}</div>
          <div className="stat-value">{submittedCount}</div>
          <div className="stat-foot">{tr('supplierPortal.receipt')}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">{tr('supplierPortal.portalStatus')}</div>
          <div className="stat-value" style={{ fontSize: 18, marginTop: 15 }}>
            {tr('supplierPortal.authenticated')}
          </div>
          <div className="stat-foot">Isolated company scope</div>
        </div>
      </section>

      <section className="card panel">
        <div className="panel-head">
          <div className="panel-title">{tr('nav.myTenders')}</div>
          <span className="subtle">{tenders.length}</span>
        </div>

        <div className="table-wrap">
          {loading ? (
            <div className="empty">{tr('common.loading')}</div>
          ) : tenders.length === 0 ? (
            <div className="empty">
              {lang === 'ko'
                ? '배정된 초청 입찰이 없습니다.'
                : 'You do not have any assigned tender invitations yet.'}
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{tr('tenders.name')}</th>
                  <th>{tr('tenders.project')}</th>
                  <th>{tr('tenders.deadline')}</th>
                  <th>{tr('supplierPortal.submitted')}</th>
                  <th>{tr('common.status')}</th>
                  <th>{tr('supplierPortal.receipt')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tenders.map((t) => (
                  <tr key={t.tenderId}>
                    <td>
                      <span className="primary-text">{t.name}</span>
                      <span className="secondary">{t.code}</span>
                    </td>
                    <td>
                      {t.projectName}
                      <span className="secondary">{t.projectLocation}</span>
                    </td>
                    <td>{formatDateTimeInZone(t.deadlineAt, t.timeZone, lang)}</td>
                    <td>
                      <StatusPill
                        status={t.ownSubmissionState}
                        labelOverride={tr(`supplierPortal.ownState.${t.ownSubmissionState}`)}
                      />
                    </td>
                    <td>
                      <StatusPill
                        status={t.windowState}
                        labelOverride={tr(`supplierPortal.window.${t.windowState}`)}
                      />
                    </td>
                    <td>{t.latestReceiptNumber || '—'}</td>
                    <td>
                      <Link
                        href={`/supplier/tenders/${t.tenderId}`}
                        className={`btn small ${t.windowState === 'OPEN' ? 'primary' : ''}`}
                      >
                        {t.ownSubmissionState === 'SUBMITTED'
                          ? lang === 'ko'
                            ? '제출자료 보기'
                            : 'View submission'
                          : tr('tenders.open')}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </PortalShell>
  );
}
