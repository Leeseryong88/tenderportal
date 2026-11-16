import { NextRequest } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin';
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SEC,
  assertValidOrigin,
  jsonError,
  jsonPrivate,
} from '@/lib/server/security';
import { getVerifiedSessionDecoded } from '@/lib/server/authz';
import type { MembershipRecord } from '@/types/domain';
import { z } from 'zod';

const sessionBodySchema = z.object({ idToken: z.string().min(20) }).strict();

export async function POST(req: NextRequest) {
  const originCheck = assertValidOrigin(req);
  if (!originCheck.ok) {
    return jsonError('ORIGIN_FORBIDDEN', originCheck.reason || 'Forbidden origin.', 403);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError('INVALID_JSON', 'Invalid JSON body.', 400);
  }

  const parsed = sessionBodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError('VALIDATION_ERROR', 'Missing or invalid idToken.', 400);
  }

  try {
    const auth = getAdminAuth();
    const decoded = await auth.verifyIdToken(parsed.data.idToken, true);

    // Sync custom claims from authoritative membership if membership exists
    const db = getAdminDb();
    const memSnap = await db.doc(`memberships/${decoded.uid}`).get();
    if (memSnap.exists) {
      const m = memSnap.data() as MembershipRecord;
      if (
        decoded.authzVersion !== m.authzVersion ||
        decoded.role !== m.role ||
        decoded.status !== m.status ||
        decoded.tenantId !== m.tenantId
      ) {
        await auth.setCustomUserClaims(decoded.uid, {
          tenantId: m.tenantId,
          role: m.role,
          status: m.status,
          authzVersion: m.authzVersion,
        });
      }
    }

    const sessionCookie = await auth.createSessionCookie(parsed.data.idToken, {
      expiresIn: SESSION_MAX_AGE_SEC * 1000,
    });

    const res = jsonPrivate({ ok: true, uid: decoded.uid, emailVerified: Boolean(decoded.email_verified) });
    res.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SEC,
    });
    return res;
  } catch {
    return jsonError('INVALID_ID_TOKEN', 'Unable to verify Firebase ID token.', 401);
  }
}

export async function DELETE(req: NextRequest) {
  const originCheck = assertValidOrigin(req);
  if (!originCheck.ok) {
    return jsonError('ORIGIN_FORBIDDEN', originCheck.reason || 'Forbidden origin.', 403);
  }

  try {
    const decoded = await getVerifiedSessionDecoded();
    await getAdminAuth().revokeRefreshTokens(decoded.uid);
  } catch {
    // Ignore if session already expired/missing
  }

  const res = jsonPrivate({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}
