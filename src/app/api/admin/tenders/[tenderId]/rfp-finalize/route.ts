import { NextRequest } from 'next/server';
import { getAdminDb, getAdminStorage } from '@/lib/firebase/admin';
import { AuthzError, authorize } from '@/lib/server/authz';
import {
  UNSCANNED_FILE_VERDICT,
  extractExtension,
  isAllowedExtension,
  sha256Hex,
  validateFileMagicBytes,
} from '@/lib/server/fileValidation';
import { writeAuditLog } from '@/lib/server/audit';
import { assertValidOrigin, jsonError, jsonPrivate } from '@/lib/server/security';
import { getTenantSettings } from '@/lib/server/settings';
import { syncTenderProjections } from '@/lib/server/tenderProjection';
import { finalizeRfpSchema } from '@/lib/validation/schemas';
import type { ProjectRecord, StoredFileRecord, TenderRecord } from '@/types/domain';

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
    const parsed = finalizeRfpSchema.safeParse(await req.json());
    if (!parsed.success) {
      return jsonError('VALIDATION_ERROR', 'Invalid finalize RFP payload.', 400);
    }

    const db = getAdminDb();
    const bucket = getAdminStorage().bucket();
    const tenderSnap = await db.doc(`tenants/${actor.tenantId}/tenders/${tenderId}`).get();
    if (!tenderSnap.exists) {
      return jsonError('NOT_FOUND', 'Tender not found.', 404);
    }
    const tender = tenderSnap.data() as TenderRecord;
    const settings = await getTenantSettings(actor.tenantId);

    const finalizedFiles: StoredFileRecord[] = [];
    const nowIso = new Date().toISOString();

    for (const intentId of parsed.data.intentIds) {
      const intentRef = db.doc(`tenants/${actor.tenantId}/uploadIntents/${intentId}`);
      const intentSnap = await intentRef.get();
      if (!intentSnap.exists) {
        return jsonError('INTENT_NOT_FOUND', `Upload intent not found: ${intentId}`, 404);
      }
      const intent = intentSnap.data()!;
      if (
        intent.tenantId !== actor.tenantId ||
        intent.tenderId !== tenderId ||
        intent.uid !== actor.uid ||
        intent.ownerScope !== 'RFP' ||
        intent.consumedAt
      ) {
        return jsonError('INVALID_INTENT', 'Invalid or already consumed upload intent.', 400);
      }

      const stagingFile = bucket.file(intent.stagingPath);
      const [exists] = await stagingFile.exists();
      if (!exists) {
        return jsonError('STAGING_FILE_MISSING', 'Uploaded file not found in staging.', 400);
      }

      const [metadata] = await stagingFile.getMetadata();
      const sizeBytes = Number(metadata.size || 0);
      if (sizeBytes <= 0 || sizeBytes > intent.maxSizeBytes) {
        await stagingFile.delete({ ignoreNotFound: true }).catch(() => {});
        return jsonError('INVALID_FILE_SIZE', 'Uploaded file size exceeds limit.', 400);
      }

      const ext = extractExtension(intent.originalName);
      if (!isAllowedExtension(intent.originalName, settings.allowedExtensions)) {
        await stagingFile.delete({ ignoreNotFound: true }).catch(() => {});
        return jsonError('DISALLOWED_FILE_TYPE', 'File extension is not allowed.', 400);
      }

      const [buf] = await stagingFile.download();
      const magic = validateFileMagicBytes(ext, buf);
      if (!magic.ok) {
        await stagingFile.delete({ ignoreNotFound: true }).catch(() => {});
        return jsonError('INVALID_FILE_CONTENT', `File validation failed: ${magic.reason}`, 400);
      }

      const scan = UNSCANNED_FILE_VERDICT;
      const sha256 = sha256Hex(buf);
      const versionId = 'v1';
      const scopeDir = parsed.data.publishedToSuppliers ? 'rfp' : 'rfp-internal';
      const protectedPath = `protected/${actor.tenantId}/${tenderId}/${scopeDir}/${intent.fileId}/${versionId}`;
      const destFile = bucket.file(protectedPath);

      await destFile.save(buf, {
        contentType: intent.declaredContentType || 'application/octet-stream',
        resumable: false,
        metadata: {
          metadata: {
            tenantId: actor.tenantId,
            tenderId,
            fileId: intent.fileId,
            ownerScope: 'RFP',
            scanStatus: scan.scanStatus,
            publishedToSuppliers: String(parsed.data.publishedToSuppliers),
          },
        },
      });

      const [destMeta] = await destFile.getMetadata();
      await stagingFile.delete({ ignoreNotFound: true }).catch(() => {});

      const fileRecord: StoredFileRecord = {
        id: intent.fileId,
        tenantId: actor.tenantId,
        tenderId,
        companyId: null,
        ownerScope: 'RFP',
        originalName: intent.originalName,
        contentType: intent.declaredContentType || 'application/octet-stream',
        sizeBytes: buf.length,
        sha256,
        storagePath: protectedPath,
        objectGeneration: String(destMeta.generation || ''),
        scanStatus: scan.scanStatus,
        scanDetail: scan.scanDetail,
        publishedToSuppliers: parsed.data.publishedToSuppliers,
        uploadedByUid: actor.uid,
        versionId,
        finalizedAt: nowIso,
      };

      await db.doc(`tenants/${actor.tenantId}/files/${fileRecord.id}`).set(fileRecord);
      await intentRef.set({ consumedAt: nowIso }, { merge: true });
      finalizedFiles.push(fileRecord);
    }

    const projSnap = await db.doc(`tenants/${actor.tenantId}/projects/${tender.projectId}`).get();
    const project = projSnap.exists ? (projSnap.data() as ProjectRecord) : null;
    await syncTenderProjections(actor.tenantId, tender, project);

    await writeAuditLog({
      tenantId: actor.tenantId,
      actorUid: actor.uid,
      actorRole: actor.role,
      action: 'TENDER_RFP_UPLOADED',
      targetType: 'tender',
      targetId: tenderId,
      afterSummary: {
        fileCount: finalizedFiles.length,
        fileIds: finalizedFiles.map((f) => f.id),
      },
    });

    return jsonPrivate({ files: finalizedFiles }, 201);
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to finalize RFP upload.', 500);
  }
}
