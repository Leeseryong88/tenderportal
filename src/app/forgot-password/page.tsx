'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { sendPasswordResetEmail } from 'firebase/auth';
import { getFirebaseClientAuth } from '@/lib/firebase/client';
import { LanguageSwitcher, useLanguage } from '@/components/providers/LanguageProvider';

export default function ForgotPasswordPage() {
  const { tr, trError } = useLanguage();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await sendPasswordResetEmail(getFirebaseClientAuth(), email.trim());
      setSent(true);
    } catch (err) {
      // Do not reveal whether an account exists for this email.
      if ((err as { code?: string })?.code === 'auth/user-not-found') {
        setSent(true);
        return;
      }
      setError(trError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-top">
          <b style={{ letterSpacing: '0.14em', fontSize: 15 }}>IICOMBINED</b>
          <LanguageSwitcher />
        </div>
        <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>{tr('auth.resetPasswordTitle')}</h1>
        {sent ? (
          <div className="notice">
            <b style={{ display: 'block', marginBottom: 4, overflowWrap: 'anywhere' }}>{email}</b>
            {tr('auth.resetSent')}
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
            <div className="field">
              <label>{tr('auth.email')}</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {error && <div className="notice danger">{error}</div>}
            <button type="submit" className="btn primary" disabled={loading}>
              {loading ? tr('common.loading') : tr('auth.resetPasswordBtn')}
            </button>
          </form>
        )}
        <div style={{ marginTop: 16, fontSize: 12, color: 'var(--green)' }}>
          <Link href="/login">← {tr('auth.signIn')}</Link>
        </div>
      </div>
    </div>
  );
}
