'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/client/api';
import { LanguageSwitcher, useLanguage } from '@/components/providers/LanguageProvider';

function InviteLandingInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { lang } = useLanguage();

  const [token, setToken] = useState<string>('');
  const [state, setState] = useState<'loading' | 'unauthenticated' | 'pending' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const raw = params.get('token') || '';
    if (raw) {
      setToken(raw);
      try {
        sessionStorage.setItem('pendingInviteToken', raw);
      } catch {
        // Ignore
      }
      // Immediately strip token from browser URL so it does not linger in history/Referer
      if (typeof window !== 'undefined') {
        window.history.replaceState({}, '', '/invite');
      }
    } else {
      try {
        const stored = sessionStorage.getItem('pendingInviteToken') || '';
        if (stored) setToken(stored);
      } catch {
        // Ignore
      }
    }
  }, [params]);

  useEffect(() => {
    const checkAndClaim = async () => {
      const effectiveToken =
        token ||
        (typeof window !== 'undefined' ? sessionStorage.getItem('pendingInviteToken') || '' : '');

      if (!effectiveToken) {
        setState('error');
        setErrorMsg(
          lang === 'ko'
            ? '유효한 초청 토큰이 없습니다.'
            : 'No invitation token provided.'
        );
        return;
      }

      try {
        const me = await apiFetch<{
          emailVerified: boolean;
          status: string;
          role: string | null;
        }>('/api/auth/me');

        if (!me.emailVerified || me.status !== 'ACTIVE' || me.role !== 'SUPPLIER') {
          setState('pending');
          return;
        }

        const claimed = await apiFetch<{ ok: boolean; tenderId: string }>('/api/invitations/claim', {
          method: 'POST',
          body: JSON.stringify({ token: effectiveToken }),
        });

        try {
          sessionStorage.removeItem('pendingInviteToken');
        } catch {
          // Ignore
        }

        setState('ready');
        router.replace(`/supplier/tenders/${claimed.tenderId}`);
      } catch (err) {
        const status = (err as { status?: number })?.status;
        if (status === 401) {
          setState('unauthenticated');
          return;
        }
        setState('error');
        setErrorMsg(err instanceof Error ? err.message : 'Invitation verification failed.');
      }
    };

    void checkAndClaim();
  }, [token, router, lang]);

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-top">
          <b style={{ letterSpacing: '0.14em', fontSize: 15 }}>IICOMBINED</b>
          <LanguageSwitcher />
        </div>

        {/* NEVER expose project name, tender name, or company name before verification & claim */}
        <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>
          {lang === 'ko' ? '입찰 초청 확인' : 'Tender Invitation Verification'}
        </h1>

        {state === 'loading' && (
          <p className="subtle">
            {lang === 'ko'
              ? '초청 권한을 확인하고 있습니다...'
              : 'Verifying your invitation access...'}
          </p>
        )}

        {state === 'unauthenticated' && (
          <div>
            <p className="subtle" style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 16 }}>
              {lang === 'ko'
                ? '초청된 입찰 내용을 확인하려면 먼저 초청받은 이메일 계정으로 로그인하거나 회원가입 후 관리자 승인을 완료해야 합니다.'
                : 'To view this invitation, please sign in with the invited email account or sign up and complete administrator approval.'}
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <Link href="/login?next=/invite" className="btn primary">
                {lang === 'ko' ? '로그인' : 'Sign in'}
              </Link>
              <Link href="/signup" className="btn">
                {lang === 'ko' ? '이용 신청' : 'Request access'}
              </Link>
            </div>
          </div>
        )}

        {state === 'pending' && (
          <div className="notice warn">
            {lang === 'ko'
              ? '이메일 인증, 관리자 승인 및 협력사 계정 연결이 완료된 후 초청을 수락할 수 있습니다.'
              : 'Email verification, administrator approval, and supplier company linkage are required before claiming this invitation.'}
          </div>
        )}

        {state === 'error' && <div className="notice danger">{errorMsg}</div>}
      </div>
    </div>
  );
}

export default function InvitePage() {
  return (
    <Suspense fallback={<div className="auth-page"><div className="auth-card">Loading...</div></div>}>
      <InviteLandingInner />
    </Suspense>
  );
}
