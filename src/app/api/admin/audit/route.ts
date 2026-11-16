import { getAdminDb } from '@/lib/firebase/admin';
import { AuthzError, authorize } from '@/lib/server/authz';
import { jsonError, jsonPrivate } from '@/lib/server/security';
import type { AuditLogRecord } from '@/types/domain';

export async function GET() {
  try {
    const { actor } = await authorize('ADMIN_AUDIT_READ');
    const db = getAdminDb();
    const snap = await db
      .collection(`tenants/${actor.tenantId}/auditLogs`)
      .orderBy('createdAt', 'desc')
      .limit(150)
      .get();

    const logs = snap.docs.map((d) => d.data() as AuditLogRecord);
    return jsonPrivate({ logs });
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to load audit logs.', 500);
  }
}
