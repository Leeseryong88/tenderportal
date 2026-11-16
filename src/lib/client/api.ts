'use client';

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const SESSION_EXPIRED_CODES = new Set(['UNAUTHENTICATED', 'SESSION_INVALID', 'AUTHZ_VERSION_STALE']);
const PROTECTED_PREFIXES = ['/admin', '/department', '/supplier'];

function redirectToLogin() {
  if (typeof window === 'undefined') return;
  const { pathname, search } = window.location;
  if (!PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return;
  const next = encodeURIComponent(`${pathname}${search}`);
  window.location.assign(`/login?next=${next}&expired=1`);
}

export async function apiFetch<T>(
  url: string,
  options: RequestInit & { reauthToken?: string } = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('X-Requested-With', 'XMLHttpRequest');
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (options.reauthToken) {
    headers.set('X-Reauth-Token', options.reauthToken);
  }

  const res = await fetch(url, {
    ...options,
    headers,
    cache: 'no-store',
    credentials: 'same-origin',
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = payload?.error || {};
    if (res.status === 401 && SESSION_EXPIRED_CODES.has(err.code)) {
      redirectToLogin();
    }
    throw new ApiClientError(
      res.status,
      err.code || 'API_ERROR',
      err.message || `Request failed (${res.status})`
    );
  }

  return payload as T;
}
