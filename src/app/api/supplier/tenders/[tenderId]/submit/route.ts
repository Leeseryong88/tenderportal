import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { getAdminDb, getAdminStorage } from '@/lib/firebase/admin';
import { AuthzError, authorize } from '@/lib/server/authz';
import { computeTenderStatus } from '@/lib/domain/schedule';
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
import { finalizeSubmissionSchema } from '@/lib/validation/schemas';
import type {
  FileManifestItem,
  StoredFileRecord,
  SubmissionVersionRecord,
  TenderAccessGrant,
  TenderParticipantRecord,
  TenderRecord,
} from '@/types/domain';

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
    const { actor } = await authorize('SUPPLIER_SUBMIT', { tenderId });
    const companyId = actor.supplierCompanyId!;

    const parsed = finalizeSubmissionSchema.safeParse(await req.json());
    if (!parsed.success) {
      return jsonError('VALIDATION_ERROR', 'Invalid submission finalize payload.', 400);
    }

    const db = getAdminDb();
    const bucket = getAdminStorage().bucket();
    const tenantId = actor.tenantId;
    const settings = await getTenantSettings(tenantId);

    if (parsed.data.intentIds.length > settings.maxFilesPerSubmission) {
      return jsonError(
        'TOO_MANY_FILES',
        `Maximum ${settings.maxFilesPerSubmission} files allowed per submission.`,
        400
      );
    }

    // Check idempotency key first before touching Storage
    const idempRef = db.doc(
      `tenants/${tenantId}/tenders/${tenderId}/submissions/${companyId}/idempotency/${parsed.data.idempotencyKey}`
    );
    const idempSnap = await idempRef.get();
    if (idempSnap.exists) {
      const existingVersionId = String(idempSnap.data()?.versionId || '');
      if (existingVersionId) {
        const verSnap = await db
          .doc(
            `tenants/${tenantId}/tenders/${tenderId}/submissions/${companyId}/versions/${existingVersionId}`
          )
          .get();
        if (verSnap.exists) {
          return jsonPrivate({
            submission: verSnap.data() as SubmissionVersionRecord,
            idempotentReplay: true,
          });
        }
      }
    }

    // Pre-check tender deadline before downloading/verifying Storage staging objects
    const tenderRef = db.doc(`tenants/${tenantId}/tenders/${tenderId}`);
    const preTenderSnap = await tenderRef.get();
    if (!preTenderSnap.exists) {
      return jsonError('NOT_FOUND', 'Tender not found.', 404);
    }
    const preTender = preTenderSnap.data() as TenderRecord;
    if (
      preTender.publicationState !== 'PUBLISHED' ||
      computeTenderStatus(preTender, Date.now()) === 'CLOSED'
    ) {
      return jsonError('TENDER_CLOSED', 'This tender is closed. Submissions are disabled.', 403);
    }

    const versionId = `ver_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const copiedProtectedPaths: string[] = [];
    const verifiedStagingPaths: string[] = [];
    const preparedFiles: Array<{
      record: Omit<StoredFileRecord, 'finalizedAt'>;
      manifest: FileManifestItem;
      intentId: string;
    }> = [];

    try {
      for (const intentId of [...new Set(parsed.data.intentIds)]) {
        const intentRef = db.doc(`tenants/${tenantId}/uploadIntents/${intentId}`);
        const intentSnap = await intentRef.get();
        if (!intentSnap.exists) {
          throw new AuthzError(404, 'INTENT_NOT_FOUND', `Upload intent not found: ${intentId}`);
        }
        const intent = intentSnap.data()!;
        if (
          intent.tenantId !== tenantId ||
          intent.tenderId !== tenderId ||
          intent.companyId !== companyId ||
          intent.uid !== actor.uid ||
          intent.ownerScope !== 'SUBMISSION' ||
          intent.consumedAt
        ) {
          throw new AuthzError(400, 'INVALID_INTENT', 'Invalid or already used upload intent.');
        }
        if (Date.now() > Date.parse(intent.expiresAt)) {
          throw new AuthzError(400, 'INTENT_EXPIRED', 'Upload intent expired. Please upload again.');
        }

        const stagingFile = bucket.file(intent.stagingPath);
        const [exists] = await stagingFile.exists();
        if (!exists) {
          throw new AuthzError(400, 'STAGING_FILE_MISSING', 'Uploaded file missing from staging.');
        }

        const [meta] = await stagingFile.getMetadata();
        const sizeBytes = Number(meta.size || 0);
        if (sizeBytes <= 0 || sizeBytes > intent.maxSizeBytes) {
          await stagingFile.delete({ ignoreNotFound: true }).catch(() => {});
          throw new AuthzError(400, 'INVALID_FILE_SIZE', 'Uploaded file size violates policy.');
        }

        const ext = extractExtension(intent.originalName);
        if (!isAllowedExtension(intent.originalName, settings.allowedExtensions)) {
          await stagingFile.delete({ ignoreNotFound: true }).catch(() => {});
          throw new AuthzError(400, 'DISALLOWED_FILE_TYPE', 'File extension is not permitted.');
        }

        const [buf] = await stagingFile.download();
        const magic = validateFileMagicBytes(ext, buf);
        if (!magic.ok) {
          await stagingFile.delete({ ignoreNotFound: true }).catch(() => {});
          throw new AuthzError(
            400,
            'INVALID_FILE_CONTENT',
            `File content validation failed (${magic.reason}).`
          );
        }

        const scan = UNSCANNED_FILE_VERDICT;
        const sha256 = sha256Hex(buf);
        const protectedPath = `protected/${tenantId}/${tenderId}/submissions/${companyId}/${versionId}/${intent.fileId}`;
        const destFile = bucket.file(protectedPath);

        await destFile.save(buf, {
          contentType: intent.declaredContentType || 'application/octet-stream',
          resumable: false,
          metadata: {
            metadata: {
              tenantId,
              tenderId,
              companyId,
              fileId: intent.fileId,
              versionId,
              ownerScope: 'SUBMISSION',
              scanStatus: scan.scanStatus,
              submittedByUid: actor.uid,
            },
          },
        });

        const [destMeta] = await destFile.getMetadata();
        copiedProtectedPaths.push(protectedPath);
        verifiedStagingPaths.push(intent.stagingPath);

        const record: Omit<StoredFileRecord, 'finalizedAt'> = {
          id: intent.fileId,
          tenantId,
          tenderId,
          companyId,
          ownerScope: 'SUBMISSION',
          originalName: intent.originalName,
          contentType: intent.declaredContentType || 'application/octet-stream',
          sizeBytes: buf.length,
          sha256,
          storagePath: protectedPath,
          objectGeneration: String(destMeta.generation || ''),
          scanStatus: scan.scanStatus,
          scanDetail: scan.scanDetail,
          publishedToSuppliers: false,
          uploadedByUid: actor.uid,
          versionId,
        };

        preparedFiles.push({
          record,
          manifest: {
            fileId: record.id,
            originalName: record.originalName,
            contentType: record.contentType,
            sizeBytes: record.sizeBytes,
            sha256: record.sha256,
            scanStatus: record.scanStatus,
            uploadedAt: '', // filled inside transaction with server acceptedAt
          },
          intentId,
        });
      }

      // Atomic Firestore Transaction: re-verify deadline, grant, membership, idempotency
      const submissionResult = await db.runTransaction(async (tx) => {
        const [tSnap, pSnap, gSnap, iSnap, existingVersionsSnap] = await Promise.all([
          tx.get(tenderRef),
          tx.get(tenderRef.collection('participants').doc(companyId)),
          tx.get(tenderRef.collection('access').doc(actor.uid)),
          tx.get(idempRef),
          tx.get(
            tenderRef
              .collection(`submissions/${companyId}/versions`)
              .orderBy('versionNumber', 'desc')
              .limit(1)
          ),
        ]);

        if (iSnap.exists) {
          const existingVerId = String(iSnap.data()?.versionId || '');
          const vSnap = await tx.get(
            tenderRef.collection(`submissions/${companyId}/versions`).doc(existingVerId)
          );
          if (vSnap.exists) {
            return {
              replay: true,
              version: vSnap.data() as SubmissionVersionRecord,
            };
          }
        }

        if (!tSnap.exists || !pSnap.exists || !gSnap.exists) {
          throw new AuthzError(403, 'TENDER_ACCESS_DENIED', 'Access denied.');
        }

        const tender = tSnap.data() as TenderRecord;
        const participant = pSnap.data() as TenderParticipantRecord;
        const grant = gSnap.data() as TenderAccessGrant;

        if (!grant.enabled || !grant.published || !participant.assignedUserIds.includes(actor.uid)) {
          throw new AuthzError(403, 'TENDER_ACCESS_DENIED', 'Access denied.');
        }

        // Authoritative server deadline enforcement inside transaction
        const txNowMs = Date.now();
        if (
          tender.publicationState !== 'PUBLISHED' ||
          computeTenderStatus(tender, txNowMs) === 'CLOSED'
        ) {
          throw new AuthzError(
            403,
            'TENDER_CLOSED_BEFORE_FINALIZE',
            'Submission deadline passed before finalization completed.'
          );
        }

        const acceptedAt = new Date(txNowMs).toISOString();
        const prevVersionNum = existingVersionsSnap.empty
          ? 0
          : Number((existingVersionsSnap.docs[0].data() as SubmissionVersionRecord).versionNumber || 0);
        const versionNumber = prevVersionNum + 1;
        const receiptNumber = `RCP-${tender.code}-${companyId.slice(-4).toUpperCase()}-V${versionNumber}-${crypto
          .randomBytes(2)
          .toString('hex')
          .toUpperCase()}`;

        const manifests: FileManifestItem[] = preparedFiles.map((pf) => ({
          ...pf.manifest,
          uploadedAt: acceptedAt,
        }));

        const versionDoc: SubmissionVersionRecord = {
          versionId,
          versionNumber,
          receiptNumber,
          tenantId,
          tenderId,
          companyId,
          submittedByUid: actor.uid,
          acceptedAt,
          idempotencyKey: parsed.data.idempotencyKey,
          files: manifests,
        };

        tx.set(
          tenderRef.collection(`submissions/${companyId}/versions`).doc(versionId),
          versionDoc
        );
        tx.set(idempRef, {
          idempotencyKey: parsed.data.idempotencyKey,
          versionId,
          createdAt: acceptedAt,
        });

        for (const pf of preparedFiles) {
          tx.set(db.doc(`tenants/${tenantId}/files/${pf.record.id}`), {
            ...pf.record,
            finalizedAt: acceptedAt,
          });
          tx.set(
            db.doc(`tenants/${tenantId}/uploadIntents/${pf.intentId}`),
            { consumedAt: acceptedAt },
            { merge: true }
          );
        }

        const nextReceivedIds = tender.receivedCompanyIds.includes(companyId)
          ? tender.receivedCompanyIds
          : [...tender.receivedCompanyIds, companyId];

        tx.set(
          tenderRef,
          {
            receivedCompanyIds: nextReceivedIds,
            receivedCompanyCount: nextReceivedIds.length,
            updatedAt: acceptedAt,
          },
          { merge: true }
        );

        tx.set(
          tenderRef.collection('participants').doc(companyId),
          {
            hasSubmitted: true,
            latestVersionId: versionId,
            latestReceiptNumber: receiptNumber,
            latestSubmittedAt: acceptedAt,
          },
          { merge: true }
        );

        return { replay: false, version: versionDoc };
      });

      if (submissionResult.replay) {
        // Clean up unused copied protected files from replay race
        await Promise.all(
          copiedProtectedPaths.map((p) => bucket.file(p).delete({ ignoreNotFound: true }).catch(() => {}))
        );
        return jsonPrivate({ submission: submissionResult.version, idempotentReplay: true });
      }

      // Clean up staging objects after successful transaction commit
      await Promise.all(
        verifiedStagingPaths.map((p) => bucket.file(p).delete({ ignoreNotFound: true }).catch(() => {}))
      );

      await writeAuditLog({
        tenantId,
        actorUid: actor.uid,
        actorRole: actor.role,
        action: 'SUPPLIER_SUBMISSION_FINALIZED',
        targetType: 'submissionVersion',
        targetId: `${tenderId}:${companyId}:${submissionResult.version.versionId}`,
        afterSummary: {
          versionNumber: submissionResult.version.versionNumber,
          receiptNumber: submissionResult.version.receiptNumber,
          fileCount: submissionResult.version.files.length,
        },
      });

      return jsonPrivate({ submission: submissionResult.version }, 201);
    } catch (innerErr) {
      // Orphan cleanup on failure
      await Promise.all(
        copiedProtectedPaths.map((p) => bucket.file(p).delete({ ignoreNotFound: true }).catch(() => {}))
      );
      throw innerErr;
    }
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to finalize submission.', 500);
  }
}
