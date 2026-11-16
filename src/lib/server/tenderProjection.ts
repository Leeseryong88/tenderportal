import { Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import type {
  FileManifestItem,
  ProjectRecord,
  StoredFileRecord,
  TenderParticipantRecord,
  TenderRecord,
} from '@/types/domain';

/**
 * Synchronizes tender projections after create/update/publish/RFP/assignment changes:
 * - participants/{companyId}
 * - access/{uid} (uses Firestore Timestamp for deadlineAt so Storage Rules `request.time < deadlineAt` works natively)
 * - supplierViews/{companyId} (strictly zero competitor data)
 */
export async function syncTenderProjections(
  tenantId: string,
  tender: TenderRecord,
  project: ProjectRecord | null
): Promise<void> {
  const db = getAdminDb();
  const tenderRef = db.doc(`tenants/${tenantId}/tenders/${tender.id}`);
  const isPublished = tender.publicationState === 'PUBLISHED';
  const deadlineTs = tender.deadlineAt
    ? Timestamp.fromDate(new Date(tender.deadlineAt))
    : Timestamp.fromDate(new Date(0));

  // Load published RFP files for this tender
  const filesSnap = await db
    .collection(`tenants/${tenantId}/files`)
    .where('tenderId', '==', tender.id)
    .get();

  const rfpFiles: FileManifestItem[] = [];
  for (const doc of filesSnap.docs) {
    const f = doc.data() as StoredFileRecord;
    if (f.ownerScope === 'RFP' && f.publishedToSuppliers) {
      rfpFiles.push({
        fileId: f.id,
        originalName: f.originalName,
        contentType: f.contentType,
        sizeBytes: f.sizeBytes,
        sha256: f.sha256,
        scanStatus: f.scanStatus,
        publishedToSuppliers: true,
        uploadedAt: f.finalizedAt,
      });
    }
  }

  // Load existing participants & access docs
  const [existingPartSnap, existingAccessSnap] = await Promise.all([
    tenderRef.collection('participants').get(),
    tenderRef.collection('access').get(),
  ]);

  const invitedSet = new Set(tender.invitedCompanyIds);
  const existingPartMap = new Map<string, TenderParticipantRecord>();
  for (const doc of existingPartSnap.docs) {
    existingPartMap.set(doc.id, doc.data() as TenderParticipantRecord);
  }

  const batch = db.batch();
  const activeAssignedUids = new Map<string, string>(); // uid -> companyId

  for (const companyId of tender.invitedCompanyIds) {
    const existing = existingPartMap.get(companyId);
    const assignedUserIds = existing?.assignedUserIds || [];

    const partData: TenderParticipantRecord = existing
      ? {
          ...existing,
          assignedUserIds,
        }
      : {
          companyId,
          tenantId,
          tenderId: tender.id,
          invitedAt: new Date().toISOString(),
          invitedByUid: tender.createdByUid,
          assignedUserIds: [],
          hasSubmitted: false,
          latestVersionId: null,
          latestReceiptNumber: null,
          latestSubmittedAt: null,
        };

    batch.set(tenderRef.collection('participants').doc(companyId), partData, { merge: true });

    // Strictly isolated supplier view projection (NO competitor fields)
    batch.set(tenderRef.collection('supplierViews').doc(companyId), {
      tenderId: tender.id,
      tenantId,
      code: tender.code,
      projectId: tender.projectId,
      projectName: project?.name || '',
      projectLocation: project ? `${project.city}, ${project.countryName}` : '',
      name: tender.name,
      type: tender.type,
      deadlineAt: tender.deadlineAt,
      timeZone: tender.timeZone,
      requiredDocuments: tender.requiredDocuments,
      description: tender.description,
      schedule: tender.schedule,
      published: isPublished,
      publishedAt: tender.publishedAt,
      rfpFiles,
      updatedAt: new Date().toISOString(),
    });

    for (const uid of assignedUserIds) {
      activeAssignedUids.set(uid, companyId);
    }
  }

  // Revoke uninvited companies that have not submitted
  for (const [companyId, part] of existingPartMap.entries()) {
    if (!invitedSet.has(companyId) && !part.hasSubmitted) {
      batch.delete(tenderRef.collection('participants').doc(companyId));
      batch.delete(tenderRef.collection('supplierViews').doc(companyId));
    }
  }

  // Update active access grants
  for (const [uid, companyId] of activeAssignedUids.entries()) {
    batch.set(tenderRef.collection('access').doc(uid), {
      uid,
      tenantId,
      tenderId: tender.id,
      companyId,
      enabled: true,
      published: isPublished,
      deadlineAt: deadlineTs,
      updatedAt: new Date().toISOString(),
    });
  }

  // Disable stale access docs for users no longer assigned or company uninvited
  for (const doc of existingAccessSnap.docs) {
    const uid = doc.id;
    const expectedCompany = activeAssignedUids.get(uid);
    if (!expectedCompany) {
      batch.set(
        tenderRef.collection('access').doc(uid),
        {
          enabled: false,
          published: false,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }
  }

  await batch.commit();
}

export async function revokeUserTenderGrants(tenantId: string, uid: string): Promise<void> {
  const db = getAdminDb();
  // Query collectionGroup 'access' where uid == uid and enabled == true
  const accessSnap = await db
    .collectionGroup('access')
    .where('uid', '==', uid)
    .where('enabled', '==', true)
    .get();

  if (accessSnap.empty) return;

  const batch = db.batch();
  for (const doc of accessSnap.docs) {
    const data = doc.data();
    if (data.tenantId !== tenantId) continue;
    batch.set(
      doc.ref,
      {
        enabled: false,
        published: false,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    // Also remove from participant.assignedUserIds
    const tenderId = data.tenderId as string;
    const companyId = data.companyId as string;
    if (tenderId && companyId) {
      const partRef = db.doc(`tenants/${tenantId}/tenders/${tenderId}/participants/${companyId}`);
      const partSnap = await partRef.get();
      if (partSnap.exists) {
        const part = partSnap.data() as TenderParticipantRecord;
        batch.set(
          partRef,
          {
            assignedUserIds: (part.assignedUserIds || []).filter((id) => id !== uid),
          },
          { merge: true }
        );
      }
    }
  }

  await batch.commit();
}
