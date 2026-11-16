import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin';
import { AuthzError, authorize } from '@/lib/server/authz';
import { jsonError, jsonPrivate } from '@/lib/server/security';
import type { AccessRequestRecord, MembershipRecord } from '@/types/domain';

export async function GET() {
  try {
    const { actor } = await authorize('ADMIN_USERS_READ');
    const db = getAdminDb();
    const auth = getAdminAuth();

    const [memSnap, reqSnap] = await Promise.all([
      db.collection('memberships').where('tenantId', '==', actor.tenantId).get(),
      db.collection('accessRequests').get(),
    ]);

    const reqMap = new Map<string, AccessRequestRecord>();
    for (const d of reqSnap.docs) {
      reqMap.set(d.id, d.data() as AccessRequestRecord);
    }

    const users = await Promise.all(
      memSnap.docs.map(async (d) => {
        const m = d.data() as MembershipRecord;
        const r = reqMap.get(m.uid);
        let emailVerified = false;
        let email = r?.verifiedEmail || '';
        try {
          const authUser = await auth.getUser(m.uid);
          emailVerified = authUser.emailVerified;
          email = authUser.email || email;
        } catch {
          // User may not exist in Auth
        }

        return {
          uid: m.uid,
          email,
          emailVerified,
          displayName: r?.displayName || email || m.uid,
          phone: r?.phone || '',
          requestedRole: r?.requestedRole || null,
          requestedCompanyOrDept: r?.requestedCompanyOrDept || '',
          status: m.status,
          role: m.role,
          supplierCompanyId: m.supplierCompanyId,
          authzVersion: m.authzVersion,
          canManageAdmins: m.canManageAdmins,
          decisionReason: r?.decisionReason || null,
          decidedAt: r?.decidedAt || null,
          createdAt: r?.createdAt || m.updatedAt,
          updatedAt: m.updatedAt,
        };
      })
    );

    users.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return jsonPrivate({ users, actorCanManageAdmins: actor.canManageAdmins });
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to list users.', 500);
  }
}
