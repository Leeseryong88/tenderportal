import { redirect } from 'next/navigation';
import { getAdminDb } from '@/lib/firebase/admin';
import { AuthzError, authorize } from '@/lib/server/authz';
import { getTenantSettings } from '@/lib/server/settings';
import type { AccountProfile, Role } from '@/types/domain';

export interface PageSessionContext {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  tenantId: string;
  supplierCompanyId: string | null;
  canManageAdmins: boolean;
  organizationName: string;
  displayTimeZone: string;
}

export async function requirePageRole(allowedRoles: Role[]): Promise<PageSessionContext> {
  try {
    const { actor } = await authorize('ACCOUNT_SELF_READ');
    if (!actor.emailVerified) {
      redirect('/verify-email');
    }
    if (actor.membership.status === 'PENDING') {
      redirect('/account/pending');
    }
    if (actor.membership.status === 'REJECTED') {
      redirect('/account/rejected');
    }
    if (actor.membership.status === 'DISABLED') {
      redirect('/account/disabled');
    }
    if (!actor.membership.role || !allowedRoles.includes(actor.membership.role)) {
      if (actor.membership.role === 'ADMIN') redirect('/admin/dashboard');
      if (actor.membership.role === 'USER_DEPARTMENT') redirect('/department/suppliers');
      if (actor.membership.role === 'SUPPLIER') redirect('/supplier/tenders');
      redirect('/login');
    }

    const db = getAdminDb();
    const [profileSnap, settings] = await Promise.all([
      db.doc(`accountProfiles/${actor.uid}`).get(),
      getTenantSettings(actor.tenantId),
    ]);
    const profile = profileSnap.exists ? (profileSnap.data() as AccountProfile) : null;

    return {
      uid: actor.uid,
      email: actor.email,
      displayName: profile?.displayName || actor.email,
      role: actor.membership.role,
      tenantId: actor.tenantId,
      supplierCompanyId: actor.supplierCompanyId,
      canManageAdmins: actor.canManageAdmins,
      organizationName: settings.organizationName,
      displayTimeZone: settings.displayTimeZone,
    };
  } catch (err) {
    if (err instanceof AuthzError) {
      redirect('/login');
    }
    throw err;
  }
}

export async function resolveHomeRedirect(): Promise<string> {
  try {
    const { actor } = await authorize('ACCOUNT_SELF_READ');
    if (!actor.emailVerified) return '/verify-email';
    if (actor.membership.status === 'PENDING') return '/account/pending';
    if (actor.membership.status === 'REJECTED') return '/account/rejected';
    if (actor.membership.status === 'DISABLED') return '/account/disabled';
    if (actor.membership.role === 'ADMIN') return '/admin/dashboard';
    if (actor.membership.role === 'USER_DEPARTMENT') return '/department/suppliers';
    if (actor.membership.role === 'SUPPLIER') return '/supplier/tenders';
    return '/account/pending';
  } catch {
    return '/login';
  }
}
