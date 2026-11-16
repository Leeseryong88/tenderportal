import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { AuthzError, authorize } from '@/lib/server/authz';
import { normalizeCountryInput } from '@/lib/domain/coverage';
import { normalizeSchedule } from '@/lib/domain/schedule';
import { isValidIanaTimeZone, timeZoneForLocation } from '@/lib/domain/timezone';
import { writeAuditLog } from '@/lib/server/audit';
import { assertValidOrigin, jsonError, jsonPrivate } from '@/lib/server/security';
import { projectUpsertSchema } from '@/lib/validation/schemas';
import type { ProjectRecord } from '@/types/domain';

export async function GET() {
  try {
    const { actor } = await authorize('ADMIN_PROJECTS_READ');
    const db = getAdminDb();
    const snap = await db.collection(`tenants/${actor.tenantId}/projects`).get();
    const projects = snap.docs
      .map((d) => d.data() as ProjectRecord)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return jsonPrivate({ projects });
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to load projects.', 500);
  }
}

export async function POST(req: NextRequest) {
  const originCheck = assertValidOrigin(req);
  if (!originCheck.ok) {
    return jsonError('ORIGIN_FORBIDDEN', originCheck.reason || 'Forbidden origin.', 403);
  }

  try {
    const { actor } = await authorize('ADMIN_PROJECTS_WRITE');
    const parsed = projectUpsertSchema.safeParse(await req.json());
    if (!parsed.success) {
      return jsonError('VALIDATION_ERROR', 'Invalid project payload.', 400);
    }

    const ctry = normalizeCountryInput(parsed.data.country);
    const timeZone =
      parsed.data.timeZone && isValidIanaTimeZone(parsed.data.timeZone)
        ? parsed.data.timeZone
        : timeZoneForLocation(ctry.countryName, parsed.data.city);

    const db = getAdminDb();
    const id = `prj_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const year = new Date().getUTCFullYear();
    const code = `PRJ-${year}-${String(Math.floor(100 + Math.random() * 900))}`;
    const now = new Date().toISOString();

    const project: ProjectRecord = {
      id,
      tenantId: actor.tenantId,
      code,
      name: parsed.data.name,
      countryCode: ctry.countryCode,
      countryName: ctry.countryName,
      city: parsed.data.city,
      type: parsed.data.type,
      owner: parsed.data.owner,
      status: parsed.data.status,
      timeZone,
      dateLocal: now.slice(0, 10),
      masterSchedule: normalizeSchedule(parsed.data.masterSchedule),
      createdAt: now,
      updatedAt: now,
      createdByUid: actor.uid,
    };

    await db.doc(`tenants/${actor.tenantId}/projects/${id}`).set(project);
    await writeAuditLog({
      tenantId: actor.tenantId,
      actorUid: actor.uid,
      actorRole: actor.role,
      action: 'PROJECT_CREATED',
      targetType: 'project',
      targetId: id,
      afterSummary: { name: project.name, countryCode: project.countryCode, status: project.status },
    });

    return jsonPrivate({ project }, 201);
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to create project.', 500);
  }
}
