import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth } from '@/lib/firebase/admin';

export const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || '__session';
export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 5; // 5 days
export const REAUTH_MAX_AGE_SEC = 300; // 5 minutes

export function noStoreHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'private, no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
    Vary: 'Cookie',
  };
}

export function jsonPrivate<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: noStoreHeaders(),
  });
}

export function jsonError(code: string, message: string, status = 400): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: noStoreHeaders() }
  );
}

function allowedOriginsList(): string[] {
  const raw =
    process.env.ALLOWED_ORIGINS ||
    process.env.APP_BASE_URL ||
    'http://localhost:3000,http://127.0.0.1:3000';
  return raw
    .split(',')
    .map((x) => x.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

export function assertValidOrigin(req: NextRequest): { ok: boolean; reason?: string } {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return { ok: true };
  }

  const allowed = allowedOriginsList();
  const origin = req.headers.get('origin')?.replace(/\/+$/, '');
  const referer = req.headers.get('referer');
  const requestHost = req.headers.get('host');
  const isDevSameHost =
    process.env.NODE_ENV !== 'production' &&
    Boolean(requestHost) &&
    Boolean(origin) &&
    (origin === `http://${requestHost}` || origin === `https://${requestHost}`);

  if (origin) {
    if (!allowed.includes(origin) && !isDevSameHost) {
      return { ok: false, reason: 'ORIGIN_NOT_ALLOWED' };
    }
  } else if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      const isDevRefSameHost =
        process.env.NODE_ENV !== 'production' &&
        Boolean(requestHost) &&
        (refOrigin === `http://${requestHost}` || refOrigin === `https://${requestHost}`);
      if (!allowed.includes(refOrigin) && !isDevRefSameHost) {
        return { ok: false, reason: 'REFERER_NOT_ALLOWED' };
      }
    } catch {
      return { ok: false, reason: 'INVALID_REFERER' };
    }
  } else if (process.env.NODE_ENV === 'production') {
    return { ok: false, reason: 'MISSING_ORIGIN' };
  }

  // Require explicit AJAX/JSON CSRF defense header on mutating API calls
  const xRequestedWith = req.headers.get('x-requested-with');
  const contentType = req.headers.get('content-type') || '';
  if (xRequestedWith !== 'XMLHttpRequest' && !contentType.includes('application/json')) {
    return { ok: false, reason: 'CSRF_HEADER_REQUIRED' };
  }

  return { ok: true };
}

export async function verifyRecentReauth(
  req: NextRequest,
  expectedUid: string
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const reauthToken = req.headers.get('x-reauth-token');
  if (!reauthToken) {
    return {
      ok: false,
      code: 'REAUTH_REQUIRED',
      message: 'Recent re-authentication is required for this sensitive operation.',
    };
  }

  try {
    const decoded = await getAdminAuth().verifyIdToken(reauthToken, true);
    if (decoded.uid !== expectedUid) {
      return { ok: false, code: 'REAUTH_UID_MISMATCH', message: 'Re-authentication user mismatch.' };
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const authTime = Number(decoded.auth_time || 0);
    if (!authTime || nowSec - authTime > REAUTH_MAX_AGE_SEC) {
      return {
        ok: false,
        code: 'REAUTH_EXPIRED',
        message: 'Re-authentication expired. Please confirm your credentials again.',
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, code: 'REAUTH_INVALID', message: 'Invalid re-authentication token.' };
  }
}

export function sanitizeHeaderFilename(name: string): string {
  const base = String(name || 'download').replace(/[\r\n"\\]/g, '_');
  const ascii = base.replace(/[^\x20-\x7E]/g, '_');
  return ascii || 'download';
}
