import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { AuthzError, authorize } from '@/lib/server/authz';
import { writeAuditLog } from '@/lib/server/audit';
import { assertValidOrigin, jsonError, jsonPrivate } from '@/lib/server/security';
import { getTenantSettings } from '@/lib/server/settings';
import { createInviteLinkSchema } from '@/lib/validation/schemas';
import type { TenderRecord } from '@/types/domain';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ tenderId: string }> }
) {
  try {
    const { actor } = await authorize('ADMIN_TENDERS_READ');
    const { tenderId } = await context.params;
    const db = getAdminDb();

    const snap = await db
      .collection('invitationTokens')
      .where('tenantId', '==', actor.tenantId)
      .where('tenderId', '==', tenderId)
      .get();

    const invitations = snap.docs
      .map((d) => {
        const data = d.data();
        return {
          tokenHash: data.tokenHash,
          companyId: data.companyId,
          normalizedEmail: data.normalizedEmail,
          expiresAt: data.expiresAt,
          createdAt: data.createdAt,
          consumedAt: data.consumedAt || null,
          revokedAt: data.revokedAt || null,
        };
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    return jsonPrivate({ invitations });
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to list invitations.', 500);
  }
}

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
    const parsed = createInviteLinkSchema.safeParse(await req.json());
    if (!parsed.success) {
      return jsonError('VALIDATION_ERROR', 'Invalid invitation request.', 400);
    }

    const db = getAdminDb();
    const tenderSnap = await db.doc(`tenants/${actor.tenantId}/tenders/${tenderId}`).get();
    if (!tenderSnap.exists) {
      return jsonError('NOT_FOUND', 'Tender not found.', 404);
    }
    const tender = tenderSnap.data() as TenderRecord;
    if (!tender.invitedCompanyIds.includes(parsed.data.companyId)) {
      return jsonError('COMPANY_NOT_INVITED', 'Company is not invited to this tender.', 400);
    }

    const settings = await getTenantSettings(actor.tenantId);
    const days = parsed.data.expiryDays ?? settings.inviteExpiryDays ?? 14;

    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const normalizedEmail = parsed.data.targetEmail.trim().toLowerCase();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + days * 86_400_000).toISOString();

    await db.doc(`invitationTokens/${tokenHash}`).set({
      tokenHash,
      tenantId: actor.tenantId,
      tenderId,
      companyId: parsed.data.companyId,
      normalizedEmail,
      expiresAt,
      createdByUid: actor.uid,
      createdAt: now.toISOString(),
      consumedAt: null,
      consumedByUid: null,
      revokedAt: null,
      revokedByUid: null,
    });

    await writeAuditLog({
      tenantId: actor.tenantId,
      actorUid: actor.uid,
      actorRole: actor.role,
      action: 'INVITATION_TOKEN_CREATED',
      targetType: 'invitationToken',
      targetId: tokenHash.slice(0, 12),
      afterSummary: {
        tenderId,
        companyId: parsed.data.companyId,
        normalizedEmail,
        expiresAt,
      },
    });

    const baseUrl =
      process.env.APP_BASE_URL || req.nextUrl.origin;

    return jsonPrivate(
      {
        tokenHash,
        inviteUrl: `${baseUrl.replace(/\/+$/, '')}/invite?token=${rawToken}`,
        normalizedEmail,
        expiresAt,
      },
      201
    );
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to create invitation token.', 500);
  }
}
