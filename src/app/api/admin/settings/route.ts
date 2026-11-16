import { NextRequest } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { AuthzError, authorize } from '@/lib/server/authz';
import { isValidIanaTimeZone } from '@/lib/domain/timezone';
import { writeAuditLog } from '@/lib/server/audit';
import { assertValidOrigin, jsonError, jsonPrivate } from '@/lib/server/security';
import { getTenantSettings } from '@/lib/server/settings';
import { updateSettingsSchema } from '@/lib/validation/schemas';
import type { TenantSettings } from '@/types/domain';

export async function GET() {
  try {
    const { actor } = await authorize('ADMIN_SETTINGS_READ');
    const settings = await getTenantSettings(actor.tenantId);
    return jsonPrivate({
      settings,
      runtimeReadiness: {
        appCheckRequired: process.env.REQUIRE_APP_CHECK === 'true',
        emulatorMode: Boolean(process.env.FIRESTORE_EMULATOR_HOST),
      },
    });
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to load settings.', 500);
  }
}

export async function PATCH(req: NextRequest) {
  const originCheck = assertValidOrigin(req);
  if (!originCheck.ok) {
    return jsonError('ORIGIN_FORBIDDEN', originCheck.reason || 'Forbidden origin.', 403);
  }

  try {
    const { actor } = await authorize('ADMIN_SETTINGS_WRITE');
    const parsed = updateSettingsSchema.safeParse(await req.json());
    if (!parsed.success) {
      return jsonError('VALIDATION_ERROR', 'Invalid settings payload.', 400);
    }

    if (!isValidIanaTimeZone(parsed.data.displayTimeZone)) {
      return jsonError('INVALID_TIMEZONE', 'Invalid display IANA time zone.', 400);
    }

    const db = getAdminDb();
    const prev = await getTenantSettings(actor.tenantId);
    const next: TenantSettings = {
      ...parsed.data,
      allowedExtensions: parsed.data.allowedExtensions.map((x) => x.toLowerCase().replace(/^\./, '')),
      updatedAt: new Date().toISOString(),
      updatedByUid: actor.uid,
    };

    await db.doc(`tenants/${actor.tenantId}/settings/default`).set(next);

    await writeAuditLog({
      tenantId: actor.tenantId,
      actorUid: actor.uid,
      actorRole: actor.role,
      action: 'TENANT_SETTINGS_UPDATED',
      targetType: 'settings',
      targetId: 'default',
      beforeSummary: {
        maxFileSizeMb: prev.maxFileSizeMb,
        displayTimeZone: prev.displayTimeZone,
      },
      afterSummary: {
        maxFileSizeMb: next.maxFileSizeMb,
        displayTimeZone: next.displayTimeZone,
      },
    });

    return jsonPrivate({ settings: next });
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to update settings.', 500);
  }
}
