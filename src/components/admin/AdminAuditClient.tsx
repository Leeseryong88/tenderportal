'use client';

import React, { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/client/api';
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
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    void apiFetch<{ logs: AuditLogRecord[] }>('/api/admin/audit')
      .then((res) => setLogs(res.logs))
      .catch((err) => showToast(trError(err), 'error'))
      .finally(() => setLoading(false));
  }, [showToast, trError]);

  const q = query.trim().toLowerCase();
  const visible = q
    ? logs.filter((log) =>
        [log.action, log.actorUid, log.actorRole, log.targetType, log.targetId, log.reason]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      )
    : logs;

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
                  <th>{tr('audit.colTarget')}</th>
                  <th>{tr('common.reason')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((log) => (
                  <tr key={log.id}>
                    <td>{formatDateTimeInZone(log.createdAt, displayTimeZone, lang)}</td>
                    <td className="cell-wrap">
                      <span className="primary-text" style={{ fontWeight: 500 }}>
                        {log.actorUid}
                      </span>
                      <span className="secondary">{log.actorRole}</span>
                    </td>
                    <td>
                      <b>{log.action}</b>
                    </td>
                    <td className="cell-wrap">
                      {log.targetType}
                      <span className="secondary">{log.targetId}</span>
                    </td>
                    <td className="cell-wrap">{log.reason || '—'}</td>
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
