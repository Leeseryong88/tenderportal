'use client';

import React, { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
} from 'firebase/auth';
import { getFirebaseClientAuth } from '@/lib/firebase/client';
import { apiFetch } from '@/lib/client/api';
import { LanguageSwitcher, useLanguage } from '@/components/providers/LanguageProvider';

function safeNextPath(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null;
  return raw;
}

function LoginPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { tr, trError } = useLanguage();
  const sessionExpired = params.get('expired') === '1';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const completeSessionAndRoute = async (idToken: string) => {
    await apiFetch('/api/auth/session', {
      method: 'POST',
      body: JSON.stringify({ idToken }),
    });
    const me = await apiFetch<{
      emailVerified: boolean;
      status: string;
      role: string | null;
      hasAccessRequest: boolean;
    }>('/api/auth/me');

    if (!me.emailVerified) {
      router.replace('/verify-email');
      return;
    }
    if (!me.hasAccessRequest && me.status === 'PENDING') {
      router.replace('/signup?completeProfile=1');
      return;
    }
    if (me.status === 'PENDING') {
      router.replace('/account/pending');
      return;
    }
    if (me.status === 'REJECTED') {
      router.replace('/account/rejected');
      return;
    }
    if (me.status === 'DISABLED') {
      router.replace('/account/disabled');
      return;
    }

    const nextPath = safeNextPath(params.get('next'));
    if (nextPath) {
      router.replace(nextPath);
      return;
    }

    if (me.role === 'ADMIN') router.replace('/admin/dashboard');
    else if (me.role === 'USER_DEPARTMENT') router.replace('/department/suppliers');
    else if (me.role === 'SUPPLIER') router.replace('/supplier/tenders');
    else router.replace('/account/pending');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const auth = getFirebaseClientAuth();
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      const idToken = await cred.user.getIdToken(true);
      await completeSessionAndRoute(idToken);
    } catch (err) {
      setError(trError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError('');
    setLoading(true);
    try {
      const auth = getFirebaseClientAuth();
      const cred = await signInWithPopup(auth, new GoogleAuthProvider());
      const idToken = await cred.user.getIdToken(true);
      await completeSessionAndRoute(idToken);
    } catch (err) {
      setError(trError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-top">
          <div>
            <b style={{ letterSpacing: '0.14em', fontSize: 15 }}>IICOMBINED</b>
            <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.14em', marginTop: 4 }}>
              TENDER PORTAL
            </span>
          </div>
          <LanguageSwitcher />
        </div>

        <h1 style={{ fontSize: 20, margin: '0 0 6px' }}>{tr('auth.loginTitle')}</h1>
        <p className="subtle" style={{ margin: '0 0 18px', fontSize: 12 }}>
          {tr('auth.loginSub')}
        </p>

        {sessionExpired && !error && (
          <div className="notice warn" style={{ margin: '0 0 14px' }}>{tr('error.UNAUTHENTICATED')}</div>
        )}

        <form onSubmit={handleLogin} style={{ display: 'grid', gap: 13 }}>
          <div className="field">
            <label htmlFor="login-email">{tr('auth.email')}</label>
            <input
              id="login-email"
              type="email"
              required
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="login-email"
            />
          </div>
          <div className="field">
            <label htmlFor="login-password">{tr('auth.password')}</label>
            <input
              id="login-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="login-password"
            />
          </div>

          {error && <div className="notice danger" style={{ margin: 0 }}>{error}</div>}

          <button
            type="submit"
            className="btn primary"
            disabled={loading}
            data-testid="login-submit"
          >
            {loading ? tr('common.loading') : tr('auth.signIn')}
          </button>

          {process.env.NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN === 'true' && (
            <button
              type="button"
              className="btn"
              disabled={loading}
              onClick={handleGoogleLogin}
            >
              {tr('auth.googleSignIn')}
            </button>
          )}
        </form>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            justifyContent: 'space-between',
            marginTop: 18,
            paddingTop: 14,
            borderTop: '1px solid var(--line)',
            fontSize: 12,
            color: 'var(--green)',
          }}
        >
          <Link href="/signup">{tr('auth.signupTitle')}</Link>
          <Link href="/forgot-password">{tr('auth.forgotPassword')}</Link>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="auth-page"><div className="auth-card">Loading...</div></div>}>
      <LoginPageInner />
    </Suspense>
  );
}
