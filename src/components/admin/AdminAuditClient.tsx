'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/client/api';
import { EMPTY_AUDIT_NAMES, formatAuditLog, type AuditNames } from '@/lib/audit/format';
import { formatDateTimeInZone } from '@/lib/domain/timezone';
import { PortalShell } from '@/components/layout/PortalShell';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useToast } from '@/components/providers/ToastProvider';
import type { AuditLogRecord } from '@/types/domain';

export function AdminAuditClient({
  displayName,
  email,
  organizationName,
  displayTimeZone,
}: {
  displayName: string;
  email: string;
  organizationName: string;
  displayTimeZone: string;
}) {
  const { lang, tr, trError } = useLanguage();
  const { showToast } = useToast();
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [names, setNames] = useState<AuditNames>(EMPTY_AUDIT_NAMES);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    void apiFetch<{ logs: AuditLogRecord[]; names?: AuditNames }>('/api/admin/audit')
      .then((res) => {
        setLogs(res.logs);
        setNames(res.names || EMPTY_AUDIT_NAMES);
      })
      .catch((err) => showToast(trError(err), 'error'))
      .finally(() => setLoading(false));
  }, [showToast, trError]);

  const rows = useMemo(
    () => logs.map((log) => ({ log, view: formatAuditLog(log, names, lang, displayTimeZone) })),
    [logs, names, lang, displayTimeZone]
  );

  const q = query.trim().toLowerCase();
  const visible = q
    ? rows.filter(({ log, view }) =>
        [view.actor, view.actorRole, view.summary, ...view.details, view.reason, log.action]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      )
    : rows;

  return (
    <PortalShell
      role="ADMIN"
      displayName={displayName}
      email={email}
      organizationName={organizationName}
      crumbTitle={tr('nav.audit')}
    >
      <div className="heading">
        <div>
          <h1>{tr('nav.audit')}</h1>
          <p>{tr('audit.sub')}</p>
        </div>
      </div>

      <div className="toolbar">
        <input
          className="search grow"
          type="search"
          placeholder={tr('common.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="card table-card">
        <div className="table-wrap">
          {loading ? (
            <div className="empty">{tr('common.loading')}</div>
          ) : visible.length === 0 ? (
            <div className="empty">{tr('common.noResults')}</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{tr('audit.colTime')}</th>
                  <th>{tr('audit.colActor')}</th>
                  <th>{tr('audit.colAction')}</th>
                  <th>{tr('common.reason')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(({ log, view }) => (
                  <tr key={log.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {formatDateTimeInZone(log.createdAt, displayTimeZone, lang)}
                    </td>
                    <td className="cell-wrap">
                      <span className="primary-text" style={{ fontWeight: 500 }}>
                        {view.actor}
                      </span>
                      <span className="secondary">{view.actorRole}</span>
                    </td>
                    <td className="audit-activity" title={`${tr('audit.actionCode')}: ${log.action}`}>
                      <b>{view.summary}</b>
                      {view.details.length > 0 && (
                        <ul className="audit-details">
                          {view.details.map((d) => (
                            <li key={d}>{d}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="cell-wrap">{view.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </PortalShell>
  );
}
