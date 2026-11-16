'use client';

import React, { useState } from 'react';
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
} from 'firebase/auth';
import { getFirebaseClientAuth } from '@/lib/firebase/client';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { Modal } from './Modal';

export function ReauthModal({
  onCancel,
  onSuccess,
}: {
  onCancel: () => void;
  onSuccess: (freshIdToken: string) => void;
}) {
  const { tr, trError } = useLanguage();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handlePasswordReauth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const auth = getFirebaseClientAuth();
      const user = auth.currentUser;
      if (!user || !user.email) {
        throw new Error(tr('error.UNAUTHENTICATED'));
      }
      const cred = EmailAuthProvider.credential(user.email, password);
      await reauthenticateWithCredential(user, cred);
      const token = await user.getIdToken(true);
      onSuccess(token);
    } catch (err) {
      setError(trError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleReauth = async () => {
    setError('');
    setLoading(true);
    try {
      const auth = getFirebaseClientAuth();
      const user = auth.currentUser;
      if (!user) throw new Error(tr('error.UNAUTHENTICATED'));
      await reauthenticateWithPopup(user, new GoogleAuthProvider());
      const token = await user.getIdToken(true);
      onSuccess(token);
    } catch (err) {
      setError(trError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title={tr('auth.reauthTitle')} subtitle={tr('auth.reauthDesc')} onClose={onCancel} maxWidth={440}>
      <form onSubmit={handlePasswordReauth}>
        <div className="field">
          <label>{tr('auth.password')}</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            data-testid="reauth-password"
          />
        </div>
        {error && <div className="notice danger">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={loading}>
            {tr('common.cancel')}
          </button>
          {process.env.NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN === 'true' && (
            <button type="button" className="btn" onClick={handleGoogleReauth} disabled={loading}>
              Google
            </button>
          )}
          <button type="submit" className="btn primary" disabled={loading} data-testid="reauth-submit">
            {loading ? tr('common.loading') : tr('auth.reauthConfirm')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
