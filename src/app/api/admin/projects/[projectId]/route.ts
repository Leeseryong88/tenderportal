import { NextRequest } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { AuthzError, authorize } from '@/lib/server/authz';
import { normalizeCountryInput } from '@/lib/domain/coverage';
import {
  computeTenderStatus,
  normalizeSchedule,
  propagateProjectScheduleToTender,
} from '@/lib/domain/schedule';
import { isValidIanaTimeZone, timeZoneForLocation } from '@/lib/domain/timezone';
import { writeAuditLog } from '@/lib/server/audit';
import { assertValidOrigin, jsonError, jsonPrivate } from '@/lib/server/security';
import { syncTenderProjections } from '@/lib/server/tenderProjection';
import { projectUpsertSchema } from '@/lib/validation/schemas';
import type { ProjectRecord, TenderRecord } from '@/types/domain';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  const originCheck = assertValidOrigin(req);
  if (!originCheck.ok) {
    return jsonError('ORIGIN_FORBIDDEN', originCheck.reason || 'Forbidden origin.', 403);
  }

  try {
    const { actor } = await authorize('ADMIN_PROJECTS_WRITE');
    const { projectId } = await context.params;
    const parsed = projectUpsertSchema.safeParse(await req.json());
    if (!parsed.success) {
      return jsonError('VALIDATION_ERROR', 'Invalid project payload.', 400);
    }

    const db = getAdminDb();
    const projRef = db.doc(`tenants/${actor.tenantId}/projects/${projectId}`);
    const snap = await projRef.get();
    if (!snap.exists) {
      return jsonError('NOT_FOUND', 'Project not found.', 404);
    }

    const existing = snap.data() as ProjectRecord;
    if (existing.tenantId !== actor.tenantId) {
      return jsonError('FORBIDDEN', 'Access denied.', 403);
    }

    const ctry = normalizeCountryInput(parsed.data.country);
    const locationChanged =
      existing.countryName !== ctry.countryName || existing.city !== parsed.data.city;

    const timeZone =
      parsed.data.timeZone && isValidIanaTimeZone(parsed.data.timeZone)
        ? parsed.data.timeZone
        : locationChanged
          ? timeZoneForLocation(ctry.countryName, parsed.data.city)
          : existing.timeZone;

    const nextSchedule = normalizeSchedule(parsed.data.masterSchedule);
    const updated: ProjectRecord = {
      ...existing,
      name: parsed.data.name,
      countryCode: ctry.countryCode,
      countryName: ctry.countryName,
      city: parsed.data.city,
      type: parsed.data.type,
      owner: parsed.data.owner,
      status: parsed.data.status,
      timeZone,
      masterSchedule: nextSchedule,
      updatedAt: new Date().toISOString(),
    };

    await projRef.set(updated);

    // Propagate masterSchedule ONLY to INHERITED stages of non-closed tenders
    const tendersSnap = await db
      .collection(`tenants/${actor.tenantId}/tenders`)
      .where('projectId', '==', projectId)
      .get();

    const nowMs = Date.now();
    for (const tDoc of tendersSnap.docs) {
      const tender = tDoc.data() as TenderRecord;
      if (computeTenderStatus(tender, nowMs) === 'CLOSED') continue;
      const propagated = propagateProjectScheduleToTender(
        nextSchedule,
        tender.schedule,
        tender.scheduleSources
      );
      const nextTender: TenderRecord = {
        ...tender,
        schedule: propagated.schedule,
        scheduleSources: propagated.scheduleSources,
        updatedAt: new Date().toISOString(),
      };
      await tDoc.ref.set(nextTender);
      await syncTenderProjections(actor.tenantId, nextTender, updated);
    }

    await writeAuditLog({
      tenantId: actor.tenantId,
      actorUid: actor.uid,
      actorRole: actor.role,
      action: 'PROJECT_UPDATED',
      targetType: 'project',
      targetId: projectId,
      beforeSummary: { name: existing.name, status: existing.status },
      afterSummary: { name: updated.name, status: updated.status },
    });

    return jsonPrivate({ project: updated });
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to update project.', 500);
  }
}
