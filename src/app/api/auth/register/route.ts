import { NextRequest } from 'next/server';
import { getAdminAuth, getAdminDb, getDefaultTenantId } from '@/lib/firebase/admin';
import { assertValidOrigin, jsonError, jsonPrivate, SESSION_COOKIE_NAME } from '@/lib/server/security';
import { registerRequestSchema } from '@/lib/validation/schemas';
import { writeAuditLog } from '@/lib/server/audit';
import type { AccessRequestRecord, AccountProfile, MembershipRecord } from '@/types/domain';

export async function POST(req: NextRequest) {
  const originCheck = assertValidOrigin(req);
  if (!originCheck.ok) {
    return jsonError('ORIGIN_FORBIDDEN', originCheck.reason || 'Forbidden origin.', 403);
  }

  // Authenticate caller via Bearer token (signup step) or Session Cookie
  let uid = '';
  let email = '';
  let emailVerified = false;

  const authHeader = req.headers.get('authorization');
  const auth = getAdminAuth();
  try {
    if (authHeader?.startsWith('Bearer ')) {
      const decoded = await auth.verifyIdToken(authHeader.slice(7).trim(), true);
      uid = decoded.uid;
      email = decoded.email || '';
      emailVerified = Boolean(decoded.email_verified);
    } else {
      const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
      if (!cookie) return jsonError('UNAUTHENTICATED', 'Authentication required.', 401);
      const decoded = await auth.verifySessionCookie(cookie, true);
      uid = decoded.uid;
      email = decoded.email || '';
      emailVerified = Boolean(decoded.email_verified);
    }
  } catch {
    return jsonError('UNAUTHENTICATED', 'Invalid authentication credentials.', 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError('INVALID_JSON', 'Invalid JSON body.', 400);
  }

  // Strict schema rejects role=ADMIN, approved=true, supplierCompanyId, etc.
  const parsed = registerRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError('VALIDATION_ERROR', 'Invalid registration fields.', 400);
  }

  const db = getAdminDb();
  const tenantId = getDefaultTenantId();
  const now = new Date().toISOString();

  const membershipRef = db.doc(`memberships/${uid}`);
  const profileRef = db.doc(`accountProfiles/${uid}`);
  const requestRef = db.doc(`accessRequests/${uid}`);

  const result = await db.runTransaction(async (tx) => {
    const existingMem = await tx.get(membershipRef);
    const existingReq = await tx.get(requestRef);

    // Update profile fields only (never role/status)
    const profile: AccountProfile = {
      uid,
      email: email.toLowerCase(),
      displayName: parsed.data.displayName,
      phone: parsed.data.phone,
      departmentOrCompany: parsed.data.requestedCompanyOrDept,
      createdAt: existingReq.exists ? (existingReq.data() as AccessRequestRecord).createdAt : now,
      updatedAt: now,
    };
    tx.set(profileRef, profile, { merge: true });

    if (existingMem.exists) {
      // Do NOT overwrite an already-created membership (ACTIVE/REJECTED/DISABLED/PENDING)
      const current = existingMem.data() as MembershipRecord;
      return { alreadyRegistered: true, membership: current };
    }

    // Create initial PENDING membership with NO role & NO supplierCompanyId
    const newMembership: MembershipRecord = {
      uid,
      tenantId,
      role: null,
      status: 'PENDING',
      supplierCompanyId: null,
      authzVersion: 1,
      canManageAdmins: false,
      updatedAt: now,
      updatedByUid: null,
    };

    const accessReq: AccessRequestRecord = {
      uid,
      verifiedEmail: email.toLowerCase(),
      displayName: parsed.data.displayName,
      phone: parsed.data.phone,
      requestedRole: parsed.data.requestedRole,
      requestedCompanyOrDept: parsed.data.requestedCompanyOrDept,
      status: 'PENDING',
      decisionByUid: null,
      decisionReason: null,
      decidedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    tx.set(membershipRef, newMembership);
    tx.set(requestRef, accessReq);
    return { alreadyRegistered: false, membership: newMembership };
  });

  if (!result.alreadyRegistered) {
    await writeAuditLog({
      tenantId,
      actorUid: uid,
      actorRole: 'USER_DEPARTMENT',
      action: 'ACCESS_REQUEST_SUBMITTED',
      targetType: 'accessRequest',
      targetId: uid,
      afterSummary: {
        requestedRole: parsed.data.requestedRole,
        requestedCompanyOrDept: parsed.data.requestedCompanyOrDept,
        emailVerified,
      },
    });
  }

  return jsonPrivate({
    ok: true,
    status: result.membership.status,
    role: result.membership.role,
    emailVerified,
  });
}
