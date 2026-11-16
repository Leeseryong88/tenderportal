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
  const { lang, tr } = useLanguage();
  const { showToast } = useToast();
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void apiFetch<{ logs: AuditLogRecord[] }>('/api/admin/audit')
      .then((res) => setLogs(res.logs))
      .catch((err) => showToast(err instanceof Error ? err.message : 'Failed to load audit logs', 'error'))
      .finally(() => setLoading(false));
  }, [showToast]);

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
          <p>Immutable server-recorded security and procurement audit trail.</p>
        </div>
      </div>

      <div className="card table-card">
        <div className="table-wrap">
          {loading ? (
            <div className="empty">{tr('common.loading')}</div>
          ) : logs.length === 0 ? (
            <div className="empty">{tr('common.noResults')}</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>TIME</th>
                  <th>ACTOR</th>
                  <th>ACTION</th>
                  <th>TARGET</th>
                  <th>REASON</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td>{formatDateTimeInZone(log.createdAt, displayTimeZone, lang)}</td>
                    <td>
                      {log.actorUid}
                      <span className="secondary">{log.actorRole}</span>
                    </td>
                    <td>
                      <b>{log.action}</b>
                    </td>
                    <td>
                      {log.targetType}:{log.targetId}
                    </td>
                    <td>{log.reason || '—'}</td>
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
