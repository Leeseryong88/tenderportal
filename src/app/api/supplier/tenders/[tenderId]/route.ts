import { NextRequest } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { AuthzError, authorize } from '@/lib/server/authz';
import { jsonError, jsonPrivate } from '@/lib/server/security';
import type {
  ProcurementSchedule,
  SubmissionVersionRecord,
  SupplierTenderViewDTO,
} from '@/types/domain';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ tenderId: string }> }
) {
  try {
    const { tenderId } = await context.params;
    const { actor } = await authorize('SUPPLIER_TENDER_READ', { tenderId });
    const companyId = actor.supplierCompanyId!;

    const db = getAdminDb();
    const tenderRef = db.doc(`tenants/${actor.tenantId}/tenders/${tenderId}`);
    const [viewSnap, versionsSnap] = await Promise.all([
      tenderRef.collection('supplierViews').doc(companyId).get(),
      tenderRef
        .collection(`submissions/${companyId}/versions`)
        .orderBy('versionNumber', 'desc')
        .get(),
    ]);

    if (!viewSnap.exists) {
      return jsonError('NOT_FOUND', 'Tender not found.', 404);
    }
    const view = viewSnap.data()!;
    if (!view.published) {
      return jsonError('FORBIDDEN', 'Access denied.', 403);
    }

    const deadlineIso = String(view.deadlineAt || '');
    const dueMs = Date.parse(deadlineIso);
    const isClosed = Number.isFinite(dueMs) && Date.now() >= dueMs;
    const versions = versionsSnap.docs.map((v) => v.data() as SubmissionVersionRecord);
    const latest = versions[0] || null;

    const dto: SupplierTenderViewDTO = {
      tenderId,
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
    };

    return jsonPrivate({ tender: dto });
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to load tender detail.', 500);
  }
}
