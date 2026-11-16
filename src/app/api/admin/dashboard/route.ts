import { getAdminDb } from '@/lib/firebase/admin';
import { AuthzError, authorize } from '@/lib/server/authz';
import { computeTenderStatus } from '@/lib/domain/schedule';
import { dateInTimeZone } from '@/lib/domain/timezone';
import { jsonError, jsonPrivate } from '@/lib/server/security';
import { buildAuditNameIndex } from '@/lib/server/auditNames';
import { getTenantSettings } from '@/lib/server/settings';
import type {
  AuditLogRecord,
  DashboardTask,
  ProjectRecord,
  TenderAdminDTO,
  TenderRecord,
} from '@/types/domain';

export async function GET() {
  try {
    const { actor } = await authorize('ADMIN_DASHBOARD_READ');
    const db = getAdminDb();
    const tenantId = actor.tenantId;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    const [settings, projectsSnap, tendersSnap, tasksSnap, auditSnap] = await Promise.all([
      getTenantSettings(tenantId),
      db.collection(`tenants/${tenantId}/projects`).get(),
      db.collection(`tenants/${tenantId}/tenders`).get(),
      db.collection(`tenants/${tenantId}/tasks`).get(),
      db
        .collection(`tenants/${tenantId}/auditLogs`)
        .orderBy('createdAt', 'desc')
        .limit(8)
        .get(),
    ]);

    const projects = projectsSnap.docs.map((d) => d.data() as ProjectRecord);
    const projectMap = new Map(projects.map((p) => [p.id, p]));

    const tenders: TenderAdminDTO[] = tendersSnap.docs
      .map((d) => {
        const t = d.data() as TenderRecord;
        const proj = projectMap.get(t.projectId);
        return {
          ...t,
          computedStatus: computeTenderStatus(t, nowMs),
          projectName: proj?.name || '—',
          projectLocation: proj ? `${proj.city}, ${proj.countryName}` : '',
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const tasks = tasksSnap.docs
      .map((d) => d.data() as DashboardTask)
      .sort((a, b) => a.dateLocal.localeCompare(b.dateLocal));

    const recentAudit = auditSnap.docs.map((d) => d.data() as AuditLogRecord);
    const auditNames = await buildAuditNameIndex(db, tenantId, recentAudit);

    const serverToday = dateInTimeZone(nowIso, settings.displayTimeZone || 'Asia/Seoul');

    return jsonPrivate({
      serverNowIso: nowIso,
      serverToday,
      displayTimeZone: settings.displayTimeZone || 'Asia/Seoul',
      projects,
      tenders,
      tasks,
      recentAudit,
      auditNames,
    });
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to load dashboard.', 500);
  }
}
