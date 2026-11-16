import { NextRequest } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { AuthzError, authorize } from '@/lib/server/authz';
import { assertValidOrigin, jsonError, jsonPrivate } from '@/lib/server/security';
import type { DashboardTask } from '@/types/domain';
import { z } from 'zod';

const patchTaskSchema = z.object({ done: z.boolean() }).strict();

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ taskId: string }> }
) {
  const originCheck = assertValidOrigin(req);
  if (!originCheck.ok) {
    return jsonError('ORIGIN_FORBIDDEN', originCheck.reason || 'Forbidden origin.', 403);
  }

  try {
    const { actor } = await authorize('ADMIN_TASKS_WRITE');
    const { taskId } = await context.params;
    const parsed = patchTaskSchema.safeParse(await req.json());
    if (!parsed.success) {
      return jsonError('VALIDATION_ERROR', 'Invalid task payload.', 400);
    }

    const db = getAdminDb();
    const ref = db.doc(`tenants/${actor.tenantId}/tasks/${taskId}`);
    const snap = await ref.get();
    if (!snap.exists) {
      return jsonError('NOT_FOUND', 'Task not found.', 404);
    }

    const task = snap.data() as DashboardTask;
    if (task.tenantId !== actor.tenantId) {
      return jsonError('FORBIDDEN', 'Access denied.', 403);
    }

    const updated: DashboardTask = {
      ...task,
      done: parsed.data.done,
      updatedAt: new Date().toISOString(),
    };
    await ref.set(updated);
    return jsonPrivate({ task: updated });
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to update task.', 500);
  }
}
