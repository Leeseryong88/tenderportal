import { NextRequest } from 'next/server';
import { getAdminDb, getAdminStorage } from '@/lib/firebase/admin';
import { AuthzError, authorize } from '@/lib/server/authz';
import { writeAuditLog } from '@/lib/server/audit';
import { assertValidOrigin, jsonError, jsonPrivate } from '@/lib/server/security';
import { syncTenderProjections } from '@/lib/server/tenderProjection';
import { toggleRfpVisibilitySchema } from '@/lib/validation/schemas';
import type { ProjectRecord, StoredFileRecord, TenderRecord } from '@/types/domain';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ tenderId: string; fileId: string }> }
) {
  const originCheck = assertValidOrigin(req);
  if (!originCheck.ok) {
    return jsonError('ORIGIN_FORBIDDEN', originCheck.reason || 'Forbidden origin.', 403);
  }

  try {
    const { actor } = await authorize('ADMIN_TENDERS_WRITE');
    const { tenderId, fileId } = await context.params;
    const parsed = toggleRfpVisibilitySchema.safeParse(await req.json());
    if (!parsed.success) {
      return jsonError('VALIDATION_ERROR', 'Invalid payload.', 400);
    }

    const db = getAdminDb();
    const fileRef = db.doc(`tenants/${actor.tenantId}/files/${fileId}`);
    const fileSnap = await fileRef.get();
    if (!fileSnap.exists) {
      return jsonError('NOT_FOUND', 'File not found.', 404);
    }

    const file = fileSnap.data() as StoredFileRecord;
    if (
      file.tenantId !== actor.tenantId ||
      file.tenderId !== tenderId ||
      file.ownerScope !== 'RFP'
    ) {
      return jsonError('FORBIDDEN', 'Access denied.', 403);
    }

    const nextScope = parsed.data.publishedToSuppliers ? 'rfp' : 'rfp-internal';
    const nextPath = `protected/${actor.tenantId}/${tenderId}/${nextScope}/${file.id}/${file.versionId || 'v1'}`;

    if (nextPath !== file.storagePath) {
      const bucket = getAdminStorage().bucket();
      const src = bucket.file(file.storagePath);
      const [exists] = await src.exists();
      if (exists) {
        const [buf] = await src.download();
        const dest = bucket.file(nextPath);
        await dest.save(buf, {
          contentType: file.contentType,
          resumable: false,
          metadata: {
            metadata: {
              tenantId: actor.tenantId,
              tenderId,
              fileId: file.id,
              ownerScope: 'RFP',
              scanStatus: file.scanStatus,
              publishedToSuppliers: String(parsed.data.publishedToSuppliers),
            },
          },
        });
        await src.delete({ ignoreNotFound: true }).catch(() => {});
      }
    }

    const updated: StoredFileRecord = {
      ...file,
      storagePath: nextPath,
      publishedToSuppliers: parsed.data.publishedToSuppliers,
    };
    await fileRef.set(updated);

    const tenderSnap = await db.doc(`tenants/${actor.tenantId}/tenders/${tenderId}`).get();
    if (tenderSnap.exists) {
      const tender = tenderSnap.data() as TenderRecord;
      const projSnap = await db.doc(`tenants/${actor.tenantId}/projects/${tender.projectId}`).get();
      await syncTenderProjections(
        actor.tenantId,
        tender,
        projSnap.exists ? (projSnap.data() as ProjectRecord) : null
      );
    }

    await writeAuditLog({
      tenantId: actor.tenantId,
      actorUid: actor.uid,
      actorRole: actor.role,
      action: 'TENDER_RFP_VISIBILITY_CHANGED',
      targetType: 'file',
      targetId: fileId,
      beforeSummary: { publishedToSuppliers: file.publishedToSuppliers },
      afterSummary: { publishedToSuppliers: updated.publishedToSuppliers },
    });

    return jsonPrivate({ file: updated });
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to update RFP visibility.', 500);
  }
}
