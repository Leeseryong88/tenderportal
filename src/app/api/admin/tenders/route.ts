import crypto from 'crypto';
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
  ProjectRecord,
  StoredFileRecord,
  TenderAdminDTO,
  TenderParticipantRecord,
  TenderRecord,
} from '@/types/domain';

export async function GET() {
  try {
    const { actor } = await authorize('ADMIN_TENDERS_READ');
    const db = getAdminDb();
    const tenantId = actor.tenantId;
    const nowMs = Date.now();

    const [tendersSnap, projectsSnap, filesSnap] = await Promise.all([
      db.collection(`tenants/${tenantId}/tenders`).get(),
      db.collection(`tenants/${tenantId}/projects`).get(),
      db.collection(`tenants/${tenantId}/files`).get(),
    ]);

    const projectMap = new Map(
      projectsSnap.docs.map((d) => {
        const p = d.data() as ProjectRecord;
        return [p.id, p];
      })
    );

    const filesByTender = new Map<string, StoredFileRecord[]>();
    for (const fDoc of filesSnap.docs) {
      const f = fDoc.data() as StoredFileRecord;
      const list = filesByTender.get(f.tenderId) || [];
      list.push(f);
      filesByTender.set(f.tenderId, list);
    }

    const tenders: Array<
      TenderAdminDTO & {
        participants: TenderParticipantRecord[];
        rfpFiles: StoredFileRecord[];
        submissionFilesByCompany: Record<string, StoredFileRecord[]>;
      }
    > = [];

    for (const tDoc of tendersSnap.docs) {
      const t = tDoc.data() as TenderRecord;
      const proj = projectMap.get(t.projectId);
      const partSnap = await tDoc.ref.collection('participants').get();
      const participants = partSnap.docs.map((p) => p.data() as TenderParticipantRecord);
      const tFiles = filesByTender.get(t.id) || [];
      const rfpFiles = tFiles.filter((f) => f.ownerScope === 'RFP');
      const submissionFilesByCompany: Record<string, StoredFileRecord[]> = {};
      for (const f of tFiles) {
        if (f.ownerScope === 'SUBMISSION' && f.companyId) {
          submissionFilesByCompany[f.companyId] ??= [];
          submissionFilesByCompany[f.companyId].push(f);
        }
      }

      tenders.push({
        ...t,
        computedStatus: computeTenderStatus(t, nowMs),
        projectName: proj?.name || '—',
        projectLocation: proj ? `${proj.city}, ${proj.countryName}` : '',
        participants,
        rfpFiles,
        submissionFilesByCompany,
      });
    }

    tenders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return jsonPrivate({ tenders });
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to load tenders.', 500);
  }
}

export async function POST(req: NextRequest) {
  const originCheck = assertValidOrigin(req);
  if (!originCheck.ok) {
    return jsonError('ORIGIN_FORBIDDEN', originCheck.reason || 'Forbidden origin.', 403);
  }

  try {
    const { actor } = await authorize('ADMIN_TENDERS_WRITE');
    const parsed = tenderUpsertSchema.safeParse(await req.json());
    if (!parsed.success) {
      return jsonError('VALIDATION_ERROR', 'Invalid tender payload.', 400);
    }

    const input = parsed.data;
    if (input.action === 'SAVE_PUBLISHED') {
      return jsonError('INVALID_ACTION', 'Use PUBLISH or SAVE_DRAFT when creating a tender.', 400);
    }

    if (!isValidIanaTimeZone(input.timeZone)) {
      return jsonError('INVALID_TIMEZONE', 'Invalid IANA time zone.', 400);
    }

    const db = getAdminDb();
    const projSnap = await db.doc(`tenants/${actor.tenantId}/projects/${input.projectId}`).get();
    if (!projSnap.exists) {
      return jsonError('NOT_FOUND', 'Selected project not found.', 404);
    }
    const project = projSnap.data() as ProjectRecord;
    if (project.tenantId !== actor.tenantId) {
      return jsonError('FORBIDDEN', 'Access denied.', 403);
    }

    // Validate invited suppliers belong to the same tenant
    const uniqueBidders = [...new Set(input.invitedCompanyIds)];
    if (input.action === 'PUBLISH') {
      if (!input.name.trim()) {
        return jsonError('VALIDATION_ERROR', 'Tender name is required.', 400);
      }
      if (!uniqueBidders.length) {
        return jsonError('VALIDATION_ERROR', 'Select at least one supplier.', 400);
      }
    }

    for (const cid of uniqueBidders) {
      const sSnap = await db.doc(`tenants/${actor.tenantId}/suppliers/${cid}`).get();
      if (!sSnap.exists) {
        return jsonError('VALIDATION_ERROR', `Invited supplier not found in tenant: ${cid}`, 400);
      }
    }

    let deadlineUtc: string | null = null;
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

    if (input.action === 'PUBLISH') {
      if (!deadlineUtc || Date.parse(deadlineUtc) <= Date.now()) {
        return jsonError('DEADLINE_IN_PAST', 'Submission deadline must be in the future.', 400);
      }
    }

    const schedule = normalizeSchedule(input.schedule);
    const scheduleSources = computeScheduleSources(schedule, project.masterSchedule);

    const id = `tnd_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const year = new Date().getUTCFullYear();
    const code = `TND-${year}-${String(Math.floor(100 + Math.random() * 900))}`;
    const now = new Date().toISOString();
    const publicationState = input.action === 'PUBLISH' ? 'PUBLISHED' : 'DRAFT';

    const tender: TenderRecord = {
      id,
      tenantId: actor.tenantId,
      code,
      projectId: project.id,
      name: input.name.trim(),
      type: input.type,
      publicationState,
      deadlineAt: deadlineUtc,
      timeZone: input.timeZone,
      requiredDocuments: input.requiredDocuments,
      description: input.description,
      schedule,
      scheduleSources,
      invitedCompanyIds: uniqueBidders,
      receivedCompanyIds: [],
      receivedCompanyCount: 0,
      revision: 1,
      lastChangeReason: null,
      publishedAt: publicationState === 'PUBLISHED' ? now : null,
      createdAt: now,
      updatedAt: now,
      createdByUid: actor.uid,
    };

    await db.doc(`tenants/${actor.tenantId}/tenders/${id}`).set(tender);
    await syncTenderProjections(actor.tenantId, tender, project);

    await writeAuditLog({
      tenantId: actor.tenantId,
      actorUid: actor.uid,
      actorRole: actor.role,
      action: publicationState === 'PUBLISHED' ? 'TENDER_PUBLISHED' : 'TENDER_DRAFT_CREATED',
      targetType: 'tender',
      targetId: id,
      afterSummary: {
        name: tender.name,
        publicationState,
        deadlineAt: tender.deadlineAt,
        invitedCount: uniqueBidders.length,
      },
    });

    return jsonPrivate(
      {
        tender: {
          ...tender,
          computedStatus: computeTenderStatus(tender, Date.now()),
        },
      },
      201
    );
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to create tender.', 500);
  }
}
