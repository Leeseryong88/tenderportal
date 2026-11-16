import { getAdminDb } from '@/lib/firebase/admin';
import { AuthzError, authorize } from '@/lib/server/authz';
import { jsonError, jsonPrivate } from '@/lib/server/security';
import { getTenantSettings } from '@/lib/server/settings';
import type { AccessRequestRecord, AccountProfile } from '@/types/domain';

export async function GET() {
  try {
    const { actor } = await authorize('ACCOUNT_SELF_READ');
    const db = getAdminDb();

    const [profileSnap, requestSnap, settings] = await Promise.all([
      db.doc(`accountProfiles/${actor.uid}`).get(),
      db.doc(`accessRequests/${actor.uid}`).get(),
      getTenantSettings(actor.tenantId),
    ]);

    const profile = profileSnap.exists ? (profileSnap.data() as AccountProfile) : null;
    const reqDoc = requestSnap.exists ? (requestSnap.data() as AccessRequestRecord) : null;

    return jsonPrivate({
      uid: actor.uid,
      email: actor.email,
      emailVerified: actor.emailVerified,
      tenantId: actor.tenantId,
      status: actor.membership.status,
      role: actor.membership.role,
      supplierCompanyId: actor.membership.supplierCompanyId,
      canManageAdmins: actor.canManageAdmins,
      displayName: profile?.displayName || actor.email,
      departmentOrCompany: profile?.departmentOrCompany || '',
      decisionReason: reqDoc?.decisionReason || null,
      hasAccessRequest: requestSnap.exists,
      settings: {
        organizationName: settings.organizationName,
        displayTimeZone: settings.displayTimeZone,
        defaultLanguage: settings.defaultLanguage,
      },
    });
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to load account.', 500);
  }
}
