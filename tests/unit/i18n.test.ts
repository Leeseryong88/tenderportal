import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/en';
import { ko } from '@/i18n/ko';
import { errorMessage, tv } from '@/i18n';
import { firebaseAuthErrorKey } from '@/lib/client/authErrors';

describe('i18n helpers', () => {
  it('ko dictionary covers every en key', () => {
    const missing = Object.keys(en).filter((k) => !(k in ko));
    expect(missing).toEqual([]);
  });

  it('translates stored values and falls back to the raw value', () => {
    expect(tv('ko', 'nda', 'Signed')).toBe('체결');
    expect(tv('ko', 'category', 'Custom Vendor Type')).toBe('Custom Vendor Type');
    expect(tv('ko', 'scan', 'PENDING')).toBe('보안 검사 대기');
  });

  it('localizes known API error codes and keeps server text for unknown codes', () => {
    expect(errorMessage('ko', 'TENDER_CLOSED', 'fallback')).toBe('마감된 입찰입니다.');
    expect(errorMessage('ko', 'INVALID_PDF_MAGIC', 'fallback')).toBe(ko['error.INVALID_FILE_CONTENT']);
    expect(errorMessage('ko', 'SOMETHING_NEW', 'server text')).toBe('server text');
  });

  it('maps Firebase Auth errors without leaking account existence', () => {
    expect(firebaseAuthErrorKey({ code: 'auth/user-not-found' })).toBe('auth.err.invalidCredential');
    expect(firebaseAuthErrorKey({ code: 'auth/wrong-password' })).toBe('auth.err.invalidCredential');
    expect(firebaseAuthErrorKey({ code: 'auth/unknown-thing' })).toBe('auth.err.generic');
    expect(firebaseAuthErrorKey(new Error('plain'))).toBeNull();
  });
});
