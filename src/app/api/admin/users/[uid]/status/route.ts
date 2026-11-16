import { NextRequest } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin';
import { AuthzError, authorize } from '@/lib/server/authz';
import { writeAuditLog } from '@/lib/server/audit';
import {
  assertValidOrigin,
  jsonError,
  jsonPrivate,
  verifyRecentReauth,
} from '@/lib/server/security';
import { revokeUserTenderGrants } from '@/lib/server/tenderProjection';
import { updateUserStatusSchema } from '@/lib/validation/schemas';
import type { MembershipRecord } from '@/types/domain';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ uid: string }> }
) {
  const originCheck = assertValidOrigin(req);
  if (!originCheck.ok) {
    return jsonError('ORIGIN_FORBIDDEN', originCheck.reason || 'Forbidden origin.', 403);
  }

  try {
    const { actor } = await authorize('ADMIN_USERS_WRITE');
    const reauth = await verifyRecentReauth(req, actor.uid);
    if (!reauth.ok) {
      return jsonError(reauth.code, reauth.message, 403);
    }

    const { uid } = await context.params;
    const parsed = updateUserStatusSchema.safeParse(await req.json());
    if (!parsed.success) {
      return jsonError('VALIDATION_ERROR', 'Invalid status payload.', 400);
    }

    const db = getAdminDb();
    const auth = getAdminAuth();
    const membershipRef = db.doc(`memberships/${uid}`);
    const snap = await membershipRef.get();
    if (!snap.exists) {
      return jsonError('NOT_FOUND', 'Membership not found.', 404);
    }

    const current = snap.data() as MembershipRecord;
    if (current.tenantId !== actor.tenantId) {
      return jsonError('FORBIDDEN', 'Access denied.', 403);
    }

    if (current.role === 'ADMIN' && !actor.canManageAdmins) {
      return jsonError(
        'ADMIN_MANAGEMENT_FORBIDDEN',
        'Only owner administrators with canManageAdmins may suspend or modify ADMIN accounts.',
        403
      );
    }

    // Last active admin protection
    if (
      current.role === 'ADMIN' &&
      current.status === 'ACTIVE' &&
      parsed.data.status !== 'ACTIVE'
    ) {
      const activeAdmins = await db
        .collection('memberships')
        .where('tenantId', '==', actor.tenantId)
        .where('role', '==', 'ADMIN')
        .where('status', '==', 'ACTIVE')
        .get();
      if (activeAdmins.size <= 1) {
        return jsonError(
          'LAST_ADMIN_PROTECTED',
          'Cannot disable or reject the last active administrator.',
          409
        );
      }
    }

    // 1) Revoke tender access grants FIRST if rejecting or disabling
    if (parsed.data.status !== 'ACTIVE') {
      await revokeUserTenderGrants(actor.tenantId, uid);
    }

    // 2) Bump authzVersion and update membership
    const nextVersion = (current.authzVersion || 1) + 1;
    const now = new Date().toISOString();
    const nextMembership: MembershipRecord = {
      ...current,
      status: parsed.data.status,
      role: parsed.data.status === 'REJECTED' ? null : current.role,
      supplierCompanyId:
        parsed.data.status === 'REJECTED' ? null : current.supplierCompanyId,
      authzVersion: nextVersion,
      updatedAt: now,
      updatedByUid: actor.uid,
    };

    await membershipRef.set(nextMembership);
    await db.doc(`accessRequests/${uid}`).set(
      {
        status: parsed.data.status,
        decisionByUid: actor.uid,
        decisionReason: parsed.data.reason,
        decidedAt: now,
        updatedAt: now,
      },
      { merge: true }
    );

    // 3) Sync Auth disabled flag, claims, and revoke tokens
    try {
      await auth.updateUser(uid, { disabled: parsed.data.status === 'DISABLED' });
      await auth.setCustomUserClaims(uid, {
        tenantId: actor.tenantId,
        role: nextMembership.role,
        status: nextMembership.status,
        authzVersion: nextVersion,
      });
      await auth.revokeRefreshTokens(uid);
    } catch {
      return jsonError(
        'AUTH_SYNC_PARTIAL_FAILURE',
        'Access blocked in membership ledger, but Firebase Auth sync failed. Please retry.',
        503
      );
    }

    await writeAuditLog({
      tenantId: actor.tenantId,
      actorUid: actor.uid,
      actorRole: actor.role,
      action: `USER_STATUS_${parsed.data.status}`,
      targetType: 'membership',
      targetId: uid,
      beforeSummary: { status: current.status, role: current.role },
      afterSummary: { status: nextMembership.status, authzVersion: nextVersion },
      reason: parsed.data.reason,
    });

    return jsonPrivate({ ok: true, membership: nextMembership });
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to update user status.', 500);
  }
}
