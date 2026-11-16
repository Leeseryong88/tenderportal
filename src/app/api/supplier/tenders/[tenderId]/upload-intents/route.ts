import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { AuthzError, authorize } from '@/lib/server/authz';
import { computeTenderStatus } from '@/lib/domain/schedule';
import { isAllowedExtension, sanitizeOriginalFilename } from '@/lib/server/fileValidation';
import { assertValidOrigin, jsonError, jsonPrivate } from '@/lib/server/security';
import { getTenantSettings } from '@/lib/server/settings';
import { uploadIntentSchema } from '@/lib/validation/schemas';
import type { TenderRecord } from '@/types/domain';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ tenderId: string }> }
) {
  const originCheck = assertValidOrigin(req);
  if (!originCheck.ok) {
    return jsonError('ORIGIN_FORBIDDEN', originCheck.reason || 'Forbidden origin.', 403);
  }

  try {
    const { tenderId } = await context.params;
    const { actor } = await authorize('SUPPLIER_UPLOAD_INTENT', { tenderId });
    const companyId = actor.supplierCompanyId!;

    const parsed = uploadIntentSchema.safeParse(await req.json());
    if (!parsed.success) {
      return jsonError('VALIDATION_ERROR', 'Invalid upload intent.', 400);
    }

    const db = getAdminDb();
    const tenderSnap = await db.doc(`tenants/${actor.tenantId}/tenders/${tenderId}`).get();
    if (!tenderSnap.exists) {
      return jsonError('NOT_FOUND', 'Tender not found.', 404);
    }
    const tender = tenderSnap.data() as TenderRecord;

    if (computeTenderStatus(tender, Date.now()) === 'CLOSED' || tender.publicationState !== 'PUBLISHED') {
      return jsonError('TENDER_CLOSED', 'This tender is closed. Uploads are disabled.', 403);
    }

    const settings = await getTenantSettings(actor.tenantId);
    const maxBytes = settings.maxFileSizeMb * 1024 * 1024;
    if (parsed.data.sizeBytes > maxBytes) {
      return jsonError(
        'FILE_TOO_LARGE',
        `File exceeds the ${settings.maxFileSizeMb} MB limit.`,
        400
      );
    }

    const cleanName = sanitizeOriginalFilename(parsed.data.originalName);
    if (!isAllowedExtension(cleanName, settings.allowedExtensions)) {
      return jsonError('DISALLOWED_FILE_TYPE', 'This file extension is not permitted.', 400);
    }

    const intentId = `int_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const fileId = `fil_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const stagingPath = `staging/${actor.tenantId}/${tenderId}/${companyId}/${actor.uid}/${intentId}/${fileId}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 20 * 60_000).toISOString();

    await db.doc(`tenants/${actor.tenantId}/uploadIntents/${intentId}`).set({
      id: intentId,
      tenantId: actor.tenantId,
      tenderId,
      companyId,
      uid: actor.uid,
      ownerScope: 'SUBMISSION',
      originalName: cleanName,
      declaredContentType: parsed.data.contentType,
      declaredSizeBytes: parsed.data.sizeBytes,
      maxSizeBytes: maxBytes,
      stagingPath,
      fileId,
      expiresAt,
      consumedAt: null,
      createdAt: now.toISOString(),
    });

    return jsonPrivate({ intentId, fileId, stagingPath, expiresAt, maxSizeBytes: maxBytes }, 201);
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to create upload intent.', 500);
  }
}
