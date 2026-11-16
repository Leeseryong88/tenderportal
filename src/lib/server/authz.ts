import { cookies } from 'next/headers';
import { getAdminAuth, getAdminDb, getDefaultTenantId } from '@/lib/firebase/admin';
import { SESSION_COOKIE_NAME } from '@/lib/server/security';
import type { MembershipRecord, Role, TenderAccessGrant, TenderParticipantRecord } from '@/types/domain';

export type AuthAction =
  | 'ACCOUNT_SELF_READ'
  | 'ADMIN_DASHBOARD_READ'
  | 'ADMIN_TASKS_WRITE'
  | 'ADMIN_PROJECTS_READ'
  | 'ADMIN_PROJECTS_WRITE'
  | 'ADMIN_SUPPLIERS_READ'
  | 'ADMIN_SUPPLIERS_WRITE'
  | 'ADMIN_TENDERS_READ'
  | 'ADMIN_TENDERS_WRITE'
  | 'ADMIN_USERS_READ'
  | 'ADMIN_USERS_WRITE'
  | 'ADMIN_SETTINGS_READ'
  | 'ADMIN_SETTINGS_WRITE'
  | 'ADMIN_AUDIT_READ'
  | 'DEPARTMENT_POOL_READ'
  | 'SUPPLIER_TENDER_READ'
  | 'SUPPLIER_UPLOAD_INTENT'
  | 'SUPPLIER_SUBMIT'
  | 'FILE_DOWNLOAD';

export interface AuthorizedActor {
  uid: string;
  email: string;
  emailVerified: boolean;
  tenantId: string;
  role: Role;
  supplierCompanyId: string | null;
  authzVersion: number;
  canManageAdmins: boolean;
  membership: MembershipRecord;
}

export interface AuthzResource {
  tenantId?: string;
  tenderId?: string;
  companyId?: string;
}

export class AuthzError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function getVerifiedSessionDecoded(sessionCookieValue?: string) {
  let cookieVal = sessionCookieValue;
  if (!cookieVal) {
    const store = await cookies();
    cookieVal = store.get(SESSION_COOKIE_NAME)?.value;
  }
  if (!cookieVal) {
    throw new AuthzError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }

  try {
    // checkRevoked = true ensures revoked refresh tokens/sessions fail immediately
    const decoded = await getAdminAuth().verifySessionCookie(cookieVal, true);
    return decoded;
  } catch {
    throw new AuthzError(401, 'SESSION_INVALID', 'Session is invalid or revoked.');
  }
}

/**
 * 8-step mandatory authorization pipeline:
 * 1) Verify session cookie signature, expiry, project, and revocation
 * 2) Verify emailVerified and membership ACTIVE status
 * 3) Load authoritative tenantId/role/supplierCompanyId/authzVersion from server membership
 * 4) Verify target resource tenantId matches actor tenantId
 * 5) Verify role matches action
 * 6) For SUPPLIER tender actions, verify UID access grant + companyId + participant link
 * 7) Return AuthorizedActor (and verified grant if applicable)
 */
export async function authorize(
  action: AuthAction,
  resource: AuthzResource = {},
  sessionCookieOverride?: string
): Promise<{
  actor: AuthorizedActor;
  grant?: TenderAccessGrant;
  participant?: TenderParticipantRecord;
}> {
  // 1) Session verification
  const decoded = await getVerifiedSessionDecoded(sessionCookieOverride);
  const uid = decoded.uid;

  // 2) Email verification + server membership ledger lookup
  const emailVerified = Boolean(decoded.email_verified);
  const db = getAdminDb();
  const membershipSnap = await db.doc(`memberships/${uid}`).get();

  if (action === 'ACCOUNT_SELF_READ') {
    const membership = membershipSnap.exists
      ? (membershipSnap.data() as MembershipRecord)
      : ({
          uid,
          tenantId: getDefaultTenantId(),
          role: null,
          status: 'PENDING',
          supplierCompanyId: null,
          authzVersion: 1,
          canManageAdmins: false,
          updatedAt: new Date().toISOString(),
          updatedByUid: null,
        } satisfies MembershipRecord);

    return {
      actor: {
        uid,
        email: decoded.email || '',
        emailVerified,
        tenantId: membership.tenantId,
        role: (membership.role || 'USER_DEPARTMENT') as Role,
        supplierCompanyId: membership.supplierCompanyId,
        authzVersion: membership.authzVersion,
        canManageAdmins: Boolean(membership.canManageAdmins),
        membership,
      },
    };
  }

  if (!emailVerified) {
    throw new AuthzError(403, 'EMAIL_NOT_VERIFIED', 'Verified email address required.');
  }

  if (!membershipSnap.exists) {
    throw new AuthzError(403, 'MEMBERSHIP_NOT_FOUND', 'Account membership not found.');
  }

  const membership = membershipSnap.data() as MembershipRecord;
  if (membership.status !== 'ACTIVE' || !membership.role) {
    throw new AuthzError(403, `ACCOUNT_${membership.status}`, 'Account is not active.');
  }

  // Enforce authzVersion check against cookie claims so stale sessions cannot survive role/company changes
  const claimVersion =
    typeof decoded.authzVersion === 'number' ? decoded.authzVersion : undefined;
  if (claimVersion !== undefined && claimVersion !== membership.authzVersion) {
    throw new AuthzError(401, 'AUTHZ_VERSION_STALE', 'Authorization state changed. Please sign in again.');
  }

  // 4) Cross-tenant isolation
  const targetTenantId = resource.tenantId || membership.tenantId;
  if (targetTenantId !== membership.tenantId) {
    throw new AuthzError(403, 'TENANT_MISMATCH', 'Access denied.');
  }

  // 5) Role matrix enforcement
  const role = membership.role;
  const adminOnlyActions: AuthAction[] = [
    'ADMIN_DASHBOARD_READ',
    'ADMIN_TASKS_WRITE',
    'ADMIN_PROJECTS_READ',
    'ADMIN_PROJECTS_WRITE',
    'ADMIN_SUPPLIERS_READ',
    'ADMIN_SUPPLIERS_WRITE',
    'ADMIN_TENDERS_READ',
    'ADMIN_TENDERS_WRITE',
    'ADMIN_USERS_READ',
    'ADMIN_USERS_WRITE',
    'ADMIN_SETTINGS_READ',
    'ADMIN_SETTINGS_WRITE',
    'ADMIN_AUDIT_READ',
  ];

  if (adminOnlyActions.includes(action) && role !== 'ADMIN') {
    throw new AuthzError(403, 'FORBIDDEN', 'Administrator privileges required.');
  }

  if (action === 'DEPARTMENT_POOL_READ' && role !== 'USER_DEPARTMENT' && role !== 'ADMIN') {
    throw new AuthzError(403, 'FORBIDDEN', 'User department or administrator role required.');
  }

  const supplierActions: AuthAction[] = [
    'SUPPLIER_TENDER_READ',
    'SUPPLIER_UPLOAD_INTENT',
    'SUPPLIER_SUBMIT',
  ];

  if (supplierActions.includes(action) && role !== 'SUPPLIER') {
    throw new AuthzError(403, 'FORBIDDEN', 'Supplier role required.');
  }

  const actor: AuthorizedActor = {
    uid,
    email: decoded.email || '',
    emailVerified,
    tenantId: membership.tenantId,
    role,
    supplierCompanyId: membership.supplierCompanyId || null,
    authzVersion: membership.authzVersion,
    canManageAdmins: Boolean(membership.canManageAdmins),
    membership,
  };

  // 6) Supplier tender-specific grant & participant verification
  if (role === 'SUPPLIER' && resource.tenderId) {
    if (!actor.supplierCompanyId) {
      throw new AuthzError(403, 'SUPPLIER_COMPANY_UNLINKED', 'Supplier company is not linked.');
    }
    if (resource.companyId && resource.companyId !== actor.supplierCompanyId) {
      throw new AuthzError(403, 'COMPANY_MISMATCH', 'Access denied.');
    }

    const [grantSnap, participantSnap] = await Promise.all([
      db.doc(`tenants/${actor.tenantId}/tenders/${resource.tenderId}/access/${uid}`).get(),
      db
        .doc(
          `tenants/${actor.tenantId}/tenders/${resource.tenderId}/participants/${actor.supplierCompanyId}`
        )
        .get(),
    ]);

    if (!grantSnap.exists || !participantSnap.exists) {
      throw new AuthzError(403, 'TENDER_ACCESS_DENIED', 'Access denied.');
    }

    const grant = grantSnap.data() as TenderAccessGrant;
    const participant = participantSnap.data() as TenderParticipantRecord;

    if (
      !grant.enabled ||
      !grant.published ||
      grant.companyId !== actor.supplierCompanyId ||
      !participant.assignedUserIds.includes(uid)
    ) {
      throw new AuthzError(403, 'TENDER_ACCESS_DENIED', 'Access denied.');
    }

    return { actor, grant, participant };
  }

  return { actor };
}
