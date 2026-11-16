import { NextRequest } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { AuthzError, authorize } from '@/lib/server/authz';
import {
  computeScheduleSources,
  computeTenderStatus,
  normalizeSchedule,
} from '@/lib/domain/schedule';
import { isValidIanaTimeZone, resolveLocalDateTimeInZone } from '@/lib/domain/timezone';
import { writeAuditLog } from '@/lib/server/audit';
import { assertValidOrigin, jsonError, jsonPrivate } from '@/lib/server/security';
import { syncTenderProjections } from '@/lib/server/tenderProjection';
import { tenderUpsertSchema } from '@/lib/validation/schemas';
import type {
  MembershipRecord,
  ProjectRecord,
  StoredFileRecord,
  SubmissionVersionRecord,
  TenderParticipantRecord,
  TenderRecord,
} from '@/types/domain';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ tenderId: string }> }
) {
  try {
    const { actor } = await authorize('ADMIN_TENDERS_READ');
    const { tenderId } = await context.params;
    const db = getAdminDb();

    const tenderSnap = await db.doc(`tenants/${actor.tenantId}/tenders/${tenderId}`).get();
    if (!tenderSnap.exists) {
      return jsonError('NOT_FOUND', 'Tender not found.', 404);
    }
    const tender = tenderSnap.data() as TenderRecord;
    if (tender.tenantId !== actor.tenantId) {
      return jsonError('FORBIDDEN', 'Access denied.', 403);
    }

    const [projSnap, partSnap, filesSnap, supplierUsersSnap] = await Promise.all([
      db.doc(`tenants/${actor.tenantId}/projects/${tender.projectId}`).get(),
      tenderSnap.ref.collection('participants').get(),
      db
        .collection(`tenants/${actor.tenantId}/files`)
        .where('tenderId', '==', tenderId)
        .get(),
      db
        .collection('memberships')
        .where('tenantId', '==', actor.tenantId)
        .where('status', '==', 'ACTIVE')
        .get(),
    ]);

    const project = projSnap.exists ? (projSnap.data() as ProjectRecord) : null;
    const participants = partSnap.docs.map((d) => d.data() as TenderParticipantRecord);
    const files = filesSnap.docs.map((d) => d.data() as StoredFileRecord);

    // Approved supplier users grouped by companyId
    const approvedSupplierUsers: Array<{ uid: string; email: string; supplierCompanyId: string }> = [];
    for (const mDoc of supplierUsersSnap.docs) {
      const m = mDoc.data() as MembershipRecord;
      if (m.role === 'SUPPLIER' && m.supplierCompanyId) {
        const profSnap = await db.doc(`accountProfiles/${m.uid}`).get();
        const email = profSnap.exists ? String(profSnap.data()?.email || '') : '';
        approvedSupplierUsers.push({
          uid: m.uid,
          email,
          supplierCompanyId: m.supplierCompanyId,
        });
      }
    }

    // Load submission version histories per invited company
    const submissionsByCompany: Record<string, SubmissionVersionRecord[]> = {};
    for (const companyId of tender.invitedCompanyIds) {
      const vSnap = await tenderSnap.ref
        .collection(`submissions/${companyId}/versions`)
        .orderBy('versionNumber', 'desc')
        .get();
      if (!vSnap.empty) {
        submissionsByCompany[companyId] = vSnap.docs.map((d) => d.data() as SubmissionVersionRecord);
      }
    }

    return jsonPrivate({
      tender: {
        ...tender,
        computedStatus: computeTenderStatus(tender, Date.now()),
        projectName: project?.name || '—',
        projectLocation: project ? `${project.city}, ${project.countryName}` : '',
        projectSchedule: project?.masterSchedule || null,
      },
      participants,
      files,
      submissionsByCompany,
      approvedSupplierUsers,
    });
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to load tender detail.', 500);
  }
}

export async function PATCH(
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
    const parsed = tenderUpsertSchema.safeParse(await req.json());
    if (!parsed.success) {
      return jsonError('VALIDATION_ERROR', 'Invalid tender update payload.', 400);
    }

    const input = parsed.data;
    const db = getAdminDb();
    const tenderRef = db.doc(`tenants/${actor.tenantId}/tenders/${tenderId}`);
    const existingSnap = await tenderRef.get();
    if (!existingSnap.exists) {
      return jsonError('NOT_FOUND', 'Tender not found.', 404);
    }

    const existing = existingSnap.data() as TenderRecord;
    if (existing.tenantId !== actor.tenantId) {
      return jsonError('FORBIDDEN', 'Access denied.', 403);
    }

    const currentStatus = computeTenderStatus(existing, Date.now());
    if (currentStatus === 'CLOSED') {
      return jsonError('TENDER_CLOSED', 'Closed tenders cannot be edited or reopened.', 400);
    }

    // Prevent reverting a published tender back to DRAFT
    if (existing.publicationState === 'PUBLISHED' && input.action === 'SAVE_DRAFT') {
      return jsonError(
        'CANNOT_REVERT_TO_DRAFT',
        'Published tenders cannot revert to DRAFT. Use Save changes.',
        400
      );
    }

    // If submissions already exist, require explicit warning confirmation + preserve submitted companies
    if (existing.receivedCompanyCount > 0) {
      if (!input.confirmedSubmissionWarning) {
        return jsonError(
          'SUBMISSION_WARNING_CONFIRMATION_REQUIRED',
          '이미 업체가 입찰서류를 제출했습니다. 수정내용에 대해 입찰 참여사에 꼭 안내해주시기 바랍니다.',
          409
        );
      }
      const nextSet = new Set(input.invitedCompanyIds);
      for (const submittedCompanyId of existing.receivedCompanyIds) {
        if (!nextSet.has(submittedCompanyId)) {
          return jsonError(
            'CANNOT_REMOVE_SUBMITTED_SUPPLIER',
            'Cannot remove a supplier that has already submitted tender documents.',
            400
          );
        }
      }
    }

    if (!isValidIanaTimeZone(input.timeZone)) {
      return jsonError('INVALID_TIMEZONE', 'Invalid IANA time zone.', 400);
    }

    const projSnap = await db.doc(`tenants/${actor.tenantId}/projects/${input.projectId}`).get();
    if (!projSnap.exists) {
      return jsonError('NOT_FOUND', 'Project not found.', 404);
    }
    const project = projSnap.data() as ProjectRecord;

    const targetPublish = input.action === 'PUBLISH' || input.action === 'SAVE_PUBLISHED';
    const uniqueBidders = [...new Set(input.invitedCompanyIds)];

    if (targetPublish) {
      if (!input.name.trim()) {
        return jsonError('VALIDATION_ERROR', 'Tender name is required.', 400);
      }
      if (!uniqueBidders.length) {
        return jsonError('VALIDATION_ERROR', 'Select at least one supplier.', 400);
      }
    }

    let deadlineUtc: string | null = existing.deadlineAt;
    if (input.deadlineLocal) {
      const resolved = resolveLocalDateTimeInZone(
        input.deadlineLocal,
        input.timeZone,
        input.dstDisambiguation
      );
      if (!resolved.ok) {
        return jsonError(
          resolved.errorCode || 'INVALID_DEADLINE',
          resolved.errorCode === 'AMBIGUOUS_LOCAL_TIME'
            ? 'Selected local time occurs twice due to DST transition. Choose earlier or later offset.'
            : 'The selected local time is invalid for this time zone or daylight saving transition.',
          400
        );
      }
      deadlineUtc = resolved.utcIso!;
    }

    if (targetPublish && (!deadlineUtc || Date.parse(deadlineUtc) <= Date.now())) {
      return jsonError('DEADLINE_IN_PAST', 'Submission deadline must be in the future.', 400);
    }

    const schedule = normalizeSchedule(input.schedule);
    const scheduleSources = computeScheduleSources(schedule, project.masterSchedule);
    const now = new Date().toISOString();

    const updated: TenderRecord = {
      ...existing,
      projectId: project.id,
      name: input.name.trim(),
      type: input.type,
      publicationState: targetPublish ? 'PUBLISHED' : 'DRAFT',
      deadlineAt: deadlineUtc,
      timeZone: input.timeZone,
      requiredDocuments: input.requiredDocuments,
      description: input.description,
      schedule,
      scheduleSources,
      invitedCompanyIds: uniqueBidders,
      revision: existing.revision + 1,
      lastChangeReason: input.changeReason?.trim() || null,
      publishedAt: targetPublish ? existing.publishedAt || now : null,
      updatedAt: now,
    };

    await tenderRef.set(updated);
    await syncTenderProjections(actor.tenantId, updated, project);

    await writeAuditLog({
      tenantId: actor.tenantId,
      actorUid: actor.uid,
      actorRole: actor.role,
      action: 'TENDER_UPDATED',
      targetType: 'tender',
      targetId: tenderId,
      beforeSummary: {
        revision: existing.revision,
        deadlineAt: existing.deadlineAt,
        publicationState: existing.publicationState,
      },
      afterSummary: {
        revision: updated.revision,
        deadlineAt: updated.deadlineAt,
        publicationState: updated.publicationState,
      },
      reason: updated.lastChangeReason,
    });

    return jsonPrivate({
      tender: {
        ...updated,
        computedStatus: computeTenderStatus(updated, Date.now()),
      },
    });
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to update tender.', 500);
  }
}
