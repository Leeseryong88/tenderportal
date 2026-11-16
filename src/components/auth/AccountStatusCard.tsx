'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { getFirebaseClientAuth } from '@/lib/firebase/client';
import { apiFetch } from '@/lib/client/api';
import { LanguageSwitcher, useLanguage } from '@/components/providers/LanguageProvider';

export function AccountStatusCard({
  expectedState,
}: {
  expectedState: 'PENDING' | 'REJECTED' | 'DISABLED';
}) {
  const router = useRouter();
  const { tr } = useLanguage();
  const [info, setInfo] = useState<{
    email: string;
    status: string;
    role: string | null;
    decisionReason: string | null;
  } | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      const me = await apiFetch<{
        email: string;
        emailVerified: boolean;
        status: string;
        role: string | null;
        decisionReason: string | null;
      }>('/api/auth/me');

      if (!me.emailVerified) {
        router.replace('/verify-email');
        return;
      }
      if (me.status === 'ACTIVE') {
        const user = getFirebaseClientAuth().currentUser;
        if (user) {
          const fresh = await user.getIdToken(true);
          await apiFetch('/api/auth/session', {
            method: 'POST',
            body: JSON.stringify({ idToken: fresh }),
          });
        }
        if (me.role === 'ADMIN') router.replace('/admin/dashboard');
        else if (me.role === 'USER_DEPARTMENT') router.replace('/department/suppliers');
        else if (me.role === 'SUPPLIER') router.replace('/supplier/tenders');
        return;
      }
      setInfo(me);
    } catch {
      router.replace('/login');
    }
  }, [router]);

  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  const handleLogout = async () => {
    await apiFetch('/api/auth/session', { method: 'DELETE' }).catch(() => {});
    await signOut(getFirebaseClientAuth()).catch(() => {});
    router.replace('/login');
  };

  const title =
    expectedState === 'PENDING'
      ? tr('auth.pendingTitle')
      : expectedState === 'REJECTED'
        ? tr('auth.rejectedTitle')
        : tr('auth.disabledTitle');

  const desc =
    expectedState === 'PENDING'
      ? tr('auth.pendingDesc')
      : expectedState === 'REJECTED'
        ? tr('auth.rejectedDesc')
        : tr('auth.disabledDesc');

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-top">
          <b style={{ letterSpacing: '0.14em', fontSize: 15 }}>IICOMBINED</b>
          <LanguageSwitcher />
        </div>
        <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>{title}</h1>
        <p className="subtle" style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 16 }}>
          {desc}
        </p>
        {info && (
          <div className="detail-box">
            <div className="detail-row">
              <span>{tr('auth.email')}</span>
              <b>{info.email}</b>
            </div>
            <div className="detail-row">
              <span>{tr('common.status')}</span>
              <b>{info.status}</b>
            </div>
            {info.decisionReason && (
              <div className="detail-row">
                <span>Reason</span>
                <b>{info.decisionReason}</b>
              </div>
            )}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="btn primary" onClick={checkStatus}>
            Refresh status
          </button>
          <button type="button" className="btn" onClick={handleLogout}>
            {tr('app.logout')}
          </button>
        </div>
      </div>
    </div>
  );
}
