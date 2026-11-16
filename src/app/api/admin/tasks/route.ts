import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { AuthzError, authorize } from '@/lib/server/authz';
import { assertValidOrigin, jsonError, jsonPrivate } from '@/lib/server/security';
import { taskCreateSchema } from '@/lib/validation/schemas';
import type { DashboardTask } from '@/types/domain';

export async function POST(req: NextRequest) {
  const originCheck = assertValidOrigin(req);
  if (!originCheck.ok) {
    return jsonError('ORIGIN_FORBIDDEN', originCheck.reason || 'Forbidden origin.', 403);
  }

  try {
    const { actor } = await authorize('ADMIN_TASKS_WRITE');
    const body = await req.json();
    const parsed = taskCreateSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError('VALIDATION_ERROR', 'Invalid task input.', 400);
    }

    const db = getAdminDb();
    const id = `tsk_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const task: DashboardTask = {
      id,
      tenantId: actor.tenantId,
      title: parsed.data.title,
      projectId: parsed.data.projectId || null,
      dateLocal: parsed.data.dateLocal,
      priority: parsed.data.priority,
      done: false,
      createdByUid: actor.uid,
      updatedAt: new Date().toISOString(),
    };

    await db.doc(`tenants/${actor.tenantId}/tasks/${id}`).set(task);
    return jsonPrivate({ task }, 201);
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to create task.', 500);
  }
}
