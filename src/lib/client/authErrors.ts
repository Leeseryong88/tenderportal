import type { I18nKey } from '@/i18n/en';

const FIREBASE_AUTH_ERRORS: Record<string, I18nKey> = {
  'auth/invalid-credential': 'auth.err.invalidCredential',
  'auth/wrong-password': 'auth.err.invalidCredential',
  'auth/user-not-found': 'auth.err.invalidCredential',
  'auth/invalid-login-credentials': 'auth.err.invalidCredential',
  'auth/email-already-in-use': 'auth.err.emailInUse',
  'auth/weak-password': 'auth.err.weakPassword',
  'auth/password-does-not-meet-requirements': 'auth.err.weakPassword',
  'auth/invalid-email': 'auth.err.invalidEmail',
  'auth/missing-email': 'auth.err.invalidEmail',
  'auth/too-many-requests': 'auth.err.tooMany',
  'auth/network-request-failed': 'auth.err.network',
  'auth/user-disabled': 'auth.err.disabled',
  'auth/popup-closed-by-user': 'auth.err.popupClosed',
  'auth/cancelled-popup-request': 'auth.err.popupClosed',
  'auth/user-mismatch': 'auth.err.invalidCredential',
};

const FIREBASE_STORAGE_ERRORS: Record<string, I18nKey> = {
  'storage/unauthorized': 'upload.err.forbidden',
  'storage/unauthenticated': 'error.UNAUTHENTICATED',
  'storage/canceled': 'upload.err.canceled',
  'storage/retry-limit-exceeded': 'auth.err.network',
  'storage/quota-exceeded': 'upload.err.quota',
};

/** Returns the i18n key for a Firebase Auth or Storage error, or null for anything else. */
export function firebaseAuthErrorKey(error: unknown): I18nKey | null {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') return null;
  if (code.startsWith('auth/')) return FIREBASE_AUTH_ERRORS[code] ?? 'auth.err.generic';
  if (code.startsWith('storage/')) return FIREBASE_STORAGE_ERRORS[code] ?? 'upload.err.generic';
  return null;
}
