import { getAdminDb } from '@/lib/firebase/admin';
import { AuthzError, authorize } from '@/lib/server/authz';
import { jsonError, jsonPrivate } from '@/lib/server/security';
import type {
  ProcurementSchedule,
  SubmissionVersionRecord,
  SupplierTenderViewDTO,
  TenderAccessGrant,
  TenderParticipantRecord,
} from '@/types/domain';

export async function GET() {
  try {
    const { actor } = await authorize('SUPPLIER_TENDER_READ');
    const companyId = actor.supplierCompanyId;
    if (!companyId) {
      return jsonError('SUPPLIER_COMPANY_UNLINKED', 'Supplier company is not linked.', 403);
    }

    const db = getAdminDb();
    const nowMs = Date.now();

    // Query ONLY grants assigned to this exact UID
    const grantsSnap = await db
      .collectionGroup('access')
      .where('uid', '==', actor.uid)
      .where('enabled', '==', true)
      .where('published', '==', true)
      .get();

    const tenders: SupplierTenderViewDTO[] = [];

    for (const grantDoc of grantsSnap.docs) {
      const grant = grantDoc.data() as TenderAccessGrant;
      if (grant.tenantId !== actor.tenantId || grant.companyId !== companyId) {
        continue;
      }

      // Read ONLY supplierViews/{companyId}, participants/{companyId}, and own company submissions
      const tenderRef = db.doc(`tenants/${actor.tenantId}/tenders/${grant.tenderId}`);
      const [viewSnap, partSnap, versionsSnap] = await Promise.all([
        tenderRef.collection('supplierViews').doc(companyId).get(),
        tenderRef.collection('participants').doc(companyId).get(),
        tenderRef
          .collection(`submissions/${companyId}/versions`)
          .orderBy('versionNumber', 'desc')
          .get(),
      ]);

      if (!viewSnap.exists || !partSnap.exists) continue;
      const part = partSnap.data() as TenderParticipantRecord;
      if (!part.assignedUserIds.includes(actor.uid)) continue;

      const view = viewSnap.data()!;
      if (!view.published) continue;

      const deadlineIso = String(view.deadlineAt || '');
      const dueMs = Date.parse(deadlineIso);
      const isClosed = Number.isFinite(dueMs) && nowMs >= dueMs;

      const versions = versionsSnap.docs.map((v) => v.data() as SubmissionVersionRecord);
      const latest = versions[0] || null;

      // STRICT ALLOWLIST DTO: Zero competitor names, counts, emails, or RECEIVING status
      tenders.push({
        tenderId: grant.tenderId,
        code: String(view.code || ''),
        projectId: String(view.projectId || ''),
        projectName: String(view.projectName || ''),
        projectLocation: String(view.projectLocation || ''),
        name: String(view.name || ''),
        type: String(view.type || ''),
        deadlineAt: deadlineIso,
        timeZone: String(view.timeZone || 'UTC'),
        requiredDocuments: String(view.requiredDocuments || ''),
        description: String(view.description || ''),
        schedule: view.schedule as ProcurementSchedule,
        windowState: isClosed ? 'CLOSED' : 'OPEN',
        ownSubmissionState: latest ? 'SUBMITTED' : 'NOT_SUBMITTED',
        latestReceiptNumber: latest?.receiptNumber || null,
        latestSubmittedAt: latest?.acceptedAt || null,
        latestVersionNumber: latest?.versionNumber || null,
        rfpFiles: Array.isArray(view.rfpFiles) ? view.rfpFiles : [],
        ownSubmittedFiles: latest?.files || [],
        submissionHistory: versions.map((v) => ({
          versionId: v.versionId,
          versionNumber: v.versionNumber,
          receiptNumber: v.receiptNumber,
          acceptedAt: v.acceptedAt,
          files: v.files,
        })),
      });
    }

    tenders.sort((a, b) => a.deadlineAt.localeCompare(b.deadlineAt));

    const supSnap = await db.doc(`tenants/${actor.tenantId}/supplierDirectory/${companyId}`).get();
    const companyName = supSnap.exists ? String(supSnap.data()?.name || companyId) : companyId;

    return jsonPrivate({ companyName, tenders });
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to load supplier tenders.', 500);
  }
}
