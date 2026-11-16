import { NextRequest } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { AuthzError, authorize } from '@/lib/server/authz';
import { writeAuditLog } from '@/lib/server/audit';
import { assertValidOrigin, jsonError, jsonPrivate } from '@/lib/server/security';
import { syncTenderProjections } from '@/lib/server/tenderProjection';
import { assignTenderUsersSchema } from '@/lib/validation/schemas';
import type { MembershipRecord, ProjectRecord, TenderRecord } from '@/types/domain';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ tenderId: string }> }
) {
  const originCheck = assertValidOrigin(req);
  if (!originCheck.ok) {
    return jsonError('ORIGIN_FORBIDDEN', originCheck.reason || 'Forbidden origin.', 403);
  }

  try {
    const { actor } = await authorize('ADMIN_TENDERS_WRITE');
    const { tenderId } = await context.params;
    const parsed = assignTenderUsersSchema.safeParse(await req.json());
    if (!parsed.success) {
      return jsonError('VALIDATION_ERROR', 'Invalid assignment payload.', 400);
    }

    const { companyId, assignedUserIds } = parsed.data;
    const uniqueUids = [...new Set(assignedUserIds)];
    const db = getAdminDb();

    const tenderRef = db.doc(`tenants/${actor.tenantId}/tenders/${tenderId}`);
    const tenderSnap = await tenderRef.get();
    if (!tenderSnap.exists) {
      return jsonError('NOT_FOUND', 'Tender not found.', 404);
    }
    const tender = tenderSnap.data() as TenderRecord;
    if (!tender.invitedCompanyIds.includes(companyId)) {
      return jsonError('COMPANY_NOT_INVITED', 'Company is not invited to this tender.', 400);
    }

    // Verify every assigned UID is an ACTIVE SUPPLIER belonging to `companyId` in same tenant
    for (const uid of uniqueUids) {
      const mSnap = await db.doc(`memberships/${uid}`).get();
      if (!mSnap.exists) {
        return jsonError('INVALID_USER', `User not found: ${uid}`, 400);
      }
      const m = mSnap.data() as MembershipRecord;
      if (
        m.tenantId !== actor.tenantId ||
        m.status !== 'ACTIVE' ||
        m.role !== 'SUPPLIER' ||
        m.supplierCompanyId !== companyId
      ) {
        return jsonError(
          'USER_COMPANY_MISMATCH',
          `User ${uid} is not an active supplier account linked to company ${companyId}.`,
          400
        );
      }
    }

    const partRef = tenderRef.collection('participants').doc(companyId);
    const partSnap = await partRef.get();
    const prevUsers = partSnap.exists ? partSnap.data()?.assignedUserIds || [] : [];

    await partRef.set(
      {
        companyId,
        tenantId: actor.tenantId,
        tenderId,
        assignedUserIds: uniqueUids,
      },
      { merge: true }
    );

    const projSnap = await db.doc(`tenants/${actor.tenantId}/projects/${tender.projectId}`).get();
    const project = projSnap.exists ? (projSnap.data() as ProjectRecord) : null;
    await syncTenderProjections(actor.tenantId, tender, project);

    await writeAuditLog({
      tenantId: actor.tenantId,
      actorUid: actor.uid,
      actorRole: actor.role,
      action: 'TENDER_COMPANY_USERS_ASSIGNED',
      targetType: 'tenderParticipant',
      targetId: `${tenderId}:${companyId}`,
      beforeSummary: { assignedUserIds: prevUsers },
      afterSummary: { assignedUserIds: uniqueUids },
    });

    return jsonPrivate({ ok: true, companyId, assignedUserIds: uniqueUids });
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to assign users.', 500);
  }
}
