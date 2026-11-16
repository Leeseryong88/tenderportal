'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { sendEmailVerification, signOut } from 'firebase/auth';
import { getFirebaseClientAuth } from '@/lib/firebase/client';
import { apiFetch } from '@/lib/client/api';
import { LanguageSwitcher, useLanguage } from '@/components/providers/LanguageProvider';
import { useToast } from '@/components/providers/ToastProvider';

export default function VerifyEmailPage() {
  const router = useRouter();
  const { tr } = useLanguage();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  const handleResend = async () => {
    setBusy(true);
    try {
      const user = getFirebaseClientAuth().currentUser;
      if (!user) throw new Error('Please sign in again.');
      await sendEmailVerification(user);
      showToast('Verification email sent.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to send verification email.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleCheck = async () => {
    setBusy(true);
    try {
      const user = getFirebaseClientAuth().currentUser;
      if (!user) {
        router.replace('/login');
        return;
      }
      await user.reload();
      const freshToken = await user.getIdToken(true);
      await apiFetch('/api/auth/session', {
        method: 'POST',
        body: JSON.stringify({ idToken: freshToken }),
      });
      const me = await apiFetch<{ emailVerified: boolean; status: string; role: string | null }>(
        '/api/auth/me'
      );
      if (!me.emailVerified) {
        showToast('Email is not verified yet.', 'error');
        return;
      }
      if (me.status === 'ACTIVE' && me.role === 'ADMIN') router.replace('/admin/dashboard');
      else if (me.status === 'ACTIVE' && me.role === 'USER_DEPARTMENT')
        router.replace('/department/suppliers');
      else if (me.status === 'ACTIVE' && me.role === 'SUPPLIER') router.replace('/supplier/tenders');
      else router.replace('/account/pending');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Verification check failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    await apiFetch('/api/auth/session', { method: 'DELETE' }).catch(() => {});
    await signOut(getFirebaseClientAuth()).catch(() => {});
    router.replace('/login');
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-top">
          <b style={{ letterSpacing: '0.14em', fontSize: 15 }}>IICOMBINED</b>
          <LanguageSwitcher />
        </div>
        <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>{tr('auth.verifyEmailTitle')}</h1>
        <p className="subtle" style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 18 }}>
          {tr('auth.verifyEmailDesc')}
        </p>
        <div style={{ display: 'grid', gap: 10 }}>
          <button type="button" className="btn primary" disabled={busy} onClick={handleCheck}>
            {tr('auth.checkVerification')}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={handleResend}>
            {tr('auth.resendVerification')}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={handleLogout}>
            {tr('app.logout')}
          </button>
        </div>
      </div>
    </div>
  );
}
