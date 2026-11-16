import crypto from 'crypto';
import { getAdminDb } from '@/lib/firebase/admin';
import type { AuditLogRecord, Role } from '@/types/domain';

export async function writeAuditLog(input: {
  tenantId: string;
  requestId?: string;
  actorUid: string;
  actorRole: Role | 'SYSTEM_BOOTSTRAP';
  action: string;
  targetType: string;
  targetId: string;
  beforeSummary?: Record<string, unknown> | null;
  afterSummary?: Record<string, unknown> | null;
  reason?: string | null;
}): Promise<void> {
  const db = getAdminDb();
  const id = `aud_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const doc: AuditLogRecord = {
    id,
    tenantId: input.tenantId,
    requestId: input.requestId || crypto.randomUUID(),
    actorUid: input.actorUid,
    actorRole: input.actorRole,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    beforeSummary: input.beforeSummary ?? null,
    afterSummary: input.afterSummary ?? null,
    reason: input.reason ?? null,
    createdAt: new Date().toISOString(),
  };

  await db.collection(`tenants/${input.tenantId}/auditLogs`).doc(id).set(doc);
}
