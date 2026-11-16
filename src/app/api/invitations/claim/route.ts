import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import { AuthzError, authorize } from '@/lib/server/authz';
import { writeAuditLog } from '@/lib/server/audit';
import { assertValidOrigin, jsonError, jsonPrivate } from '@/lib/server/security';
import { claimInviteSchema } from '@/lib/validation/schemas';
import type { TenderParticipantRecord, TenderRecord } from '@/types/domain';

export async function POST(req: NextRequest) {
  const originCheck = assertValidOrigin(req);
  if (!originCheck.ok) {
    return jsonError('ORIGIN_FORBIDDEN', originCheck.reason || 'Forbidden origin.', 403);
  }

  try {
    // Must be authenticated, emailVerified, and ACTIVE SUPPLIER (never auto-approves!)
    const { actor } = await authorize('SUPPLIER_TENDER_READ');
    if (!actor.supplierCompanyId) {
      return jsonError('SUPPLIER_COMPANY_UNLINKED', 'Supplier company not linked.', 403);
    }

    const parsed = claimInviteSchema.safeParse(await req.json());
    if (!parsed.success) {
      return jsonError('VALIDATION_ERROR', 'Invalid invitation token.', 400);
    }

    const tokenHash = crypto
      .createHash('sha256')
      .update(parsed.data.token.trim())
      .digest('hex');

    const db = getAdminDb();
    const tokenRef = db.doc(`invitationTokens/${tokenHash}`);

    const claimed = await db.runTransaction(async (tx) => {
      const tokenSnap = await tx.get(tokenRef);
      if (!tokenSnap.exists) {
        throw new AuthzError(404, 'INVITE_NOT_FOUND', 'Invitation link is invalid.');
      }

      const token = tokenSnap.data()!;
      if (token.revokedAt) {
        throw new AuthzError(410, 'INVITE_REVOKED', 'This invitation link has been revoked.');
      }
      if (token.consumedAt) {
        throw new AuthzError(409, 'INVITE_ALREADY_USED', 'This invitation link has already been claimed.');
      }
      if (Date.now() > Date.parse(String(token.expiresAt || ''))) {
        throw new AuthzError(410, 'INVITE_EXPIRED', 'This invitation link has expired.');
      }
      if (token.tenantId !== actor.tenantId) {
        throw new AuthzError(403, 'INVITE_TENANT_MISMATCH', 'Access denied.');
      }
      if (token.companyId !== actor.supplierCompanyId) {
        throw new AuthzError(
          403,
          'INVITE_COMPANY_MISMATCH',
          'This invitation belongs to a different supplier company.'
        );
      }
      if (String(token.normalizedEmail || '').toLowerCase() !== actor.email.toLowerCase()) {
        throw new AuthzError(
          403,
          'INVITE_EMAIL_MISMATCH',
          'Signed-in email does not match the invited target email.'
        );
      }

      const tenderRef = db.doc(`tenants/${actor.tenantId}/tenders/${token.tenderId}`);
      const partRef = tenderRef.collection('participants').doc(token.companyId);
      const [tSnap, pSnap] = await Promise.all([tx.get(tenderRef), tx.get(partRef)]);

      if (!tSnap.exists || !pSnap.exists) {
        throw new AuthzError(404, 'TENDER_NOT_FOUND', 'Invited tender is unavailable.');
      }

      const tender = tSnap.data() as TenderRecord;
      const part = pSnap.data() as TenderParticipantRecord;
      const now = new Date().toISOString();
      const nextAssigned = part.assignedUserIds.includes(actor.uid)
        ? part.assignedUserIds
        : [...part.assignedUserIds, actor.uid];

      tx.set(
        tokenRef,
        {
          consumedAt: now,
          consumedByUid: actor.uid,
        },
        { merge: true }
      );

      tx.set(
        partRef,
        {
          assignedUserIds: nextAssigned,
        },
        { merge: true }
      );

      tx.set(tenderRef.collection('access').doc(actor.uid), {
        uid: actor.uid,
        tenantId: actor.tenantId,
        tenderId: tender.id,
        companyId: token.companyId,
        enabled: true,
        published: tender.publicationState === 'PUBLISHED',
        deadlineAt: tender.deadlineAt
          ? Timestamp.fromDate(new Date(tender.deadlineAt))
          : Timestamp.fromDate(new Date(0)),
        updatedAt: now,
      });

      return { tenderId: tender.id };
    });

    await writeAuditLog({
      tenantId: actor.tenantId,
      actorUid: actor.uid,
      actorRole: actor.role,
      action: 'INVITATION_TOKEN_CLAIMED',
      targetType: 'tender',
      targetId: claimed.tenderId,
      afterSummary: { companyId: actor.supplierCompanyId, tokenHashPrefix: tokenHash.slice(0, 12) },
    });

    return jsonPrivate({ ok: true, tenderId: claimed.tenderId });
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to claim invitation.', 500);
  }
}
