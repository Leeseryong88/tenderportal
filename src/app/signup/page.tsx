'use client';

import React, { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  updateProfile,
} from 'firebase/auth';
import { getFirebaseClientAuth } from '@/lib/firebase/client';
import { apiFetch } from '@/lib/client/api';
import { LanguageSwitcher, useLanguage } from '@/components/providers/LanguageProvider';
import type { RequestedRole } from '@/types/domain';

function SignupPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const isGoogleProfileCompletion = params.get('completeProfile') === '1';
  const { tr, trError } = useLanguage();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [requestedRole, setRequestedRole] = useState<RequestedRole>('SUPPLIER');
  const [requestedCompanyOrDept, setRequestedCompanyOrDept] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const auth = getFirebaseClientAuth();
      let user = auth.currentUser;

      if (!isGoogleProfileCompletion) {
        // A previous attempt may have created the Auth user before the access request failed;
        // reuse it so a retry does not hit "email already in use".
        const alreadyCreated =
          user && user.email && user.email.toLowerCase() === email.trim().toLowerCase();
        if (!alreadyCreated || !user) {
          const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
          user = cred.user;
          await updateProfile(user, { displayName: displayName.trim() });
          await sendEmailVerification(user).catch(() => {});
        }
      } else if (!user) {
        throw new Error(tr('error.UNAUTHENTICATED'));
      }

      const idToken = await user.getIdToken(true);
      await apiFetch('/api/auth/register', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          displayName: displayName.trim() || user.displayName || user.email,
          phone: phone.trim(),
          requestedRole,
          requestedCompanyOrDept: requestedCompanyOrDept.trim(),
        }),
      });

      await apiFetch('/api/auth/session', {
        method: 'POST',
        body: JSON.stringify({ idToken }),
      });

      if (!user.emailVerified) {
        router.replace('/verify-email');
      } else {
        router.replace('/account/pending');
      }
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

        <h1 style={{ fontSize: 20, margin: '0 0 6px' }}>{tr('auth.signupTitle')}</h1>
        <p className="subtle" style={{ margin: '0 0 18px', fontSize: 12 }}>
          {tr('auth.signupSub')}
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
          <div className="field">
            <label>{tr('auth.displayName')} *</label>
            <input
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              data-testid="signup-name"
            />
          </div>

          {!isGoogleProfileCompletion && (
            <>
              <div className="field">
                <label>{tr('auth.email')} *</label>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  data-testid="signup-email"
                />
              </div>
              <div className="field">
                <label>{tr('auth.password')} *</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  data-testid="signup-password"
                />
                <small className="subtle">{tr('auth.passwordHint')}</small>
              </div>
            </>
          )}

          <div className="field">
            <label>{tr('auth.phone')} *</label>
            <input
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              data-testid="signup-phone"
            />
          </div>

          <div className="field">
            <label>{tr('auth.requestedRole')} *</label>
            <select
              value={requestedRole}
              onChange={(e) => setRequestedRole(e.target.value as RequestedRole)}
              data-testid="signup-role"
            >
              <option value="SUPPLIER">{tr('role.SUPPLIER')}</option>
              <option value="USER_DEPARTMENT">{tr('role.USER_DEPARTMENT')}</option>
            </select>
            <small className="subtle">{tr('auth.roleHint')}</small>
          </div>

          <div className="field">
            <label>{tr('auth.requestedCompany')} *</label>
            <input
              required
              value={requestedCompanyOrDept}
              onChange={(e) => setRequestedCompanyOrDept(e.target.value)}
              data-testid="signup-company"
            />
          </div>

          {error && <div className="notice danger" style={{ margin: 0 }}>{error}</div>}

          <button
            type="submit"
            className="btn primary"
            disabled={loading}
            data-testid="signup-submit"
          >
            {loading ? tr('common.loading') : tr('auth.signUp')}
          </button>
        </form>

        <div
          style={{
            marginTop: 18,
            paddingTop: 14,
            borderTop: '1px solid var(--line)',
            fontSize: 12,
            color: 'var(--green)',
          }}
        >
          <Link href="/login">← {tr('auth.signIn')}</Link>
        </div>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="auth-page"><div className="auth-card">Loading...</div></div>}>
      <SignupPageInner />
    </Suspense>
  );
}
