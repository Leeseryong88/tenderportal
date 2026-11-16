import { NextRequest } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { AuthzError, authorize } from '@/lib/server/authz';
import { writeAuditLog } from '@/lib/server/audit';
import { assertValidOrigin, jsonError, jsonPrivate } from '@/lib/server/security';

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ tenderId: string; tokenHash: string }> }
) {
  const originCheck = assertValidOrigin(req);
  if (!originCheck.ok) {
    return jsonError('ORIGIN_FORBIDDEN', originCheck.reason || 'Forbidden origin.', 403);
  }

  try {
    const { actor } = await authorize('ADMIN_TENDERS_WRITE');
    const { tenderId, tokenHash } = await context.params;
    const db = getAdminDb();

    const ref = db.doc(`invitationTokens/${tokenHash}`);
    const snap = await ref.get();
    if (!snap.exists) {
      return jsonError('NOT_FOUND', 'Invitation not found.', 404);
    }

    const data = snap.data()!;
    if (data.tenantId !== actor.tenantId || data.tenderId !== tenderId) {
      return jsonError('FORBIDDEN', 'Access denied.', 403);
    }

    await ref.set(
      {
        revokedAt: new Date().toISOString(),
        revokedByUid: actor.uid,
      },
      { merge: true }
    );

    await writeAuditLog({
      tenantId: actor.tenantId,
      actorUid: actor.uid,
      actorRole: actor.role,
      action: 'INVITATION_TOKEN_REVOKED',
      targetType: 'invitationToken',
      targetId: tokenHash.slice(0, 12),
      afterSummary: { tenderId, companyId: data.companyId },
    });

    return jsonPrivate({ ok: true });
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to revoke invitation.', 500);
  }
}
