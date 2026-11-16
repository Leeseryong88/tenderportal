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
import { approveUserSchema } from '@/lib/validation/schemas';
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
    const parsed = approveUserSchema.safeParse(await req.json());
    if (!parsed.success) {
      return jsonError('VALIDATION_ERROR', 'Invalid approval payload.', 400);
    }

    const db = getAdminDb();
    const auth = getAdminAuth();
    const membershipRef = db.doc(`memberships/${uid}`);
    const memSnap = await membershipRef.get();
    if (!memSnap.exists) {
      return jsonError('NOT_FOUND', 'Membership record not found.', 404);
    }

    const current = memSnap.data() as MembershipRecord;
    if (current.tenantId !== actor.tenantId) {
      return jsonError('FORBIDDEN', 'Access denied.', 403);
    }

    const targetRole = parsed.data.role;
    const targetCompanyId = targetRole === 'SUPPLIER' ? parsed.data.supplierCompanyId || null : null;

    if (targetRole === 'SUPPLIER' && !targetCompanyId) {
      return jsonError(
        'SUPPLIER_COMPANY_REQUIRED',
        'Supplier role requires selecting an existing supplier company ID.',
        400
      );
    }

    if (targetCompanyId) {
      const supSnap = await db.doc(`tenants/${actor.tenantId}/suppliers/${targetCompanyId}`).get();
      if (!supSnap.exists) {
        return jsonError('SUPPLIER_NOT_FOUND', 'Selected supplier company not found in tenant.', 400);
      }
    }

    // Admin management authority checks
    if ((targetRole === 'ADMIN' || current.role === 'ADMIN') && !actor.canManageAdmins) {
      return jsonError(
        'ADMIN_MANAGEMENT_FORBIDDEN',
        'Only owner administrators with canManageAdmins may appoint or modify ADMIN accounts.',
        403
      );
    }

    // Last active admin protection when demoting an active ADMIN
    if (current.role === 'ADMIN' && current.status === 'ACTIVE' && targetRole !== 'ADMIN') {
      const activeAdmins = await db
        .collection('memberships')
        .where('tenantId', '==', actor.tenantId)
        .where('role', '==', 'ADMIN')
        .where('status', '==', 'ACTIVE')
        .get();
      if (activeAdmins.size <= 1) {
        return jsonError(
          'LAST_ADMIN_PROTECTED',
          'Cannot demote the last active administrator in this tenant.',
          409
        );
      }
    }

    // Verify user's email is verified in Firebase Auth before activating
    const authUser = await auth.getUser(uid);
    if (!authUser.emailVerified) {
      return jsonError(
        'TARGET_EMAIL_NOT_VERIFIED',
        'User must verify their email address before approval.',
        400
      );
    }

    // 1) If company changed or role changed away from SUPPLIER, revoke old grants FIRST
    const companyChanged =
      current.supplierCompanyId && current.supplierCompanyId !== targetCompanyId;
    const leftSupplier = current.role === 'SUPPLIER' && targetRole !== 'SUPPLIER';
    if (companyChanged || leftSupplier) {
      await revokeUserTenderGrants(actor.tenantId, uid);
    }

    // 2) Update membership ledger atomically with incremented authzVersion
    const nextVersion = (current.authzVersion || 1) + 1;
    const now = new Date().toISOString();
    const canManageAdmins =
      targetRole === 'ADMIN'
        ? Boolean(parsed.data.canManageAdmins ?? current.canManageAdmins)
        : false;

    const updatedMembership: MembershipRecord = {
      uid,
      tenantId: actor.tenantId,
      role: targetRole,
      status: 'ACTIVE',
      supplierCompanyId: targetCompanyId,
      authzVersion: nextVersion,
      canManageAdmins,
      updatedAt: now,
      updatedByUid: actor.uid,
    };

    await membershipRef.set(updatedMembership);
    await db.doc(`accessRequests/${uid}`).set(
      {
        status: 'ACTIVE',
        decisionByUid: actor.uid,
        decisionReason: parsed.data.reason || 'Approved by administrator',
        decidedAt: now,
        updatedAt: now,
      },
      { merge: true }
    );

    // 3) Update Firebase Auth claims, enable user, and revoke old refresh tokens
    try {
      await auth.updateUser(uid, { disabled: false });
      await auth.setCustomUserClaims(uid, {
        tenantId: actor.tenantId,
        role: targetRole,
        status: 'ACTIVE',
        authzVersion: nextVersion,
      });
      await auth.revokeRefreshTokens(uid);
    } catch {
      return jsonError(
        'AUTH_SYNC_PARTIAL_FAILURE',
        'Membership updated, but Firebase Auth sync failed. Please retry approval.',
        503
      );
    }

    await writeAuditLog({
      tenantId: actor.tenantId,
      actorUid: actor.uid,
      actorRole: actor.role,
      action: 'USER_APPROVED_OR_UPDATED',
      targetType: 'membership',
      targetId: uid,
      beforeSummary: {
        role: current.role,
        status: current.status,
        supplierCompanyId: current.supplierCompanyId,
      },
      afterSummary: {
        role: updatedMembership.role,
        status: updatedMembership.status,
        supplierCompanyId: updatedMembership.supplierCompanyId,
        authzVersion: nextVersion,
      },
      reason: parsed.data.reason || null,
    });

    return jsonPrivate({ ok: true, membership: updatedMembership });
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to approve user.', 500);
  }
}
