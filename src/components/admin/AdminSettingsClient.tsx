'use client';

import React, { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/client/api';
import { getSupportedTimeZones } from '@/lib/domain/timezone';
import { PortalShell } from '@/components/layout/PortalShell';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useToast } from '@/components/providers/ToastProvider';
import type { TenantSettings } from '@/types/domain';

export function AdminSettingsClient({
  displayName,
  email,
  organizationName,
}: {
  displayName: string;
  email: string;
  organizationName: string;
}) {
  const { lang, tr } = useLanguage();
  const { showToast } = useToast();

  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [readiness, setReadiness] = useState<{
    malwareScannerMode: string;
    appCheckRequired: boolean;
    emulatorMode: boolean;
  } | null>(null);
  const [extText, setExtText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void apiFetch<{
      settings: TenantSettings;
      runtimeReadiness: {
        malwareScannerMode: string;
        appCheckRequired: boolean;
        emulatorMode: boolean;
      };
    }>('/api/admin/settings')
      .then((res) => {
        setSettings(res.settings);
        setReadiness(res.runtimeReadiness);
        setExtText(res.settings.allowedExtensions.join(', '));
      })
      .catch((err) => showToast(err instanceof Error ? err.message : 'Failed to load settings', 'error'));
  }, [showToast]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    try {
      const allowedExtensions = extText
        .split(',')
        .map((x) => x.trim().toLowerCase().replace(/^\./, ''))
        .filter(Boolean);
      const res = await apiFetch<{ settings: TenantSettings }>('/api/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          organizationName: settings.organizationName,
          displayTimeZone: settings.displayTimeZone,
          defaultLanguage: settings.defaultLanguage,
          maxFileSizeMb: Number(settings.maxFileSizeMb),
          maxFilesPerSubmission: Number(settings.maxFilesPerSubmission),
          allowedExtensions,
          inviteExpiryDays: Number(settings.inviteExpiryDays),
        }),
      });
      setSettings(res.settings);
      showToast(lang === 'ko' ? '설정을 저장했습니다.' : 'Settings saved.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PortalShell
      role="ADMIN"
      displayName={displayName}
      email={email}
      organizationName={organizationName}
      crumbTitle={tr('nav.settings')}
    >
      <div className="heading">
        <div>
          <h1>{tr('nav.settings')}</h1>
          <p>
            {lang === 'ko'
              ? '운영 조직 표시 설정, 파일 업로드 제한(기술 기본값) 및 초청 유효기간을 관리합니다.'
              : 'Configure organization display defaults, technical file upload limits, and invitation expiry.'}
          </p>
        </div>
      </div>

      {readiness && (
        <div className={`notice ${readiness.malwareScannerMode === 'local_signature_dev' ? 'warn' : ''}`}>
          <b>Runtime Security Readiness:</b> Malware scanner mode ={' '}
          <code>{readiness.malwareScannerMode}</code> · App Check enforced ={' '}
          <code>{String(readiness.appCheckRequired)}</code> · Emulator mode ={' '}
          <code>{String(readiness.emulatorMode)}</code>
          <br />
          {lang === 'ko'
            ? 'API 키나 Service Account 비공개 키 등 인프라 비밀값은 웹 설정 화면에 저장하지 않으며 환경변수로 관리합니다.'
            : 'Infrastructure secrets (service account keys) are never stored in web settings and must be configured via environment variables.'}
        </div>
      )}

      {settings && (
        <form className="card panel" onSubmit={handleSave}>
          <div className="form-grid">
            <div className="field">
              <label>Organization Name</label>
              <input
                required
                value={settings.organizationName}
                onChange={(e) =>
                  setSettings({ ...settings, organizationName: e.target.value })
                }
              />
            </div>

            <div className="field">
              <label>Display Time Zone (IANA)</label>
              <input
                list="settings-tz-list"
                required
                value={settings.displayTimeZone}
                onChange={(e) =>
                  setSettings({ ...settings, displayTimeZone: e.target.value })
                }
              />
              <datalist id="settings-tz-list">
                {getSupportedTimeZones().map((tz) => (
                  <option key={tz} value={tz} />
                ))}
              </datalist>
            </div>

            <div className="field">
              <label>Default Language</label>
              <select
                value={settings.defaultLanguage}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    defaultLanguage: e.target.value as 'en' | 'ko',
                  })
                }
              >
                <option value="ko">한국어 (ko)</option>
                <option value="en">English (en)</option>
              </select>
            </div>

            <div className="field">
              <label>Invite Link Expiry (days)</label>
              <input
                type="number"
                min={1}
                max={90}
                value={settings.inviteExpiryDays}
                onChange={(e) =>
                  setSettings({ ...settings, inviteExpiryDays: Number(e.target.value) })
                }
              />
            </div>

            <div className="field">
              <label>Max File Size (MB, technical default: 50MB)</label>
              <input
                type="number"
                min={1}
                max={100}
                value={settings.maxFileSizeMb}
                onChange={(e) =>
                  setSettings({ ...settings, maxFileSizeMb: Number(e.target.value) })
                }
              />
            </div>

            <div className="field">
              <label>Max Files Per Submission</label>
              <input
                type="number"
                min={1}
                max={30}
                value={settings.maxFilesPerSubmission}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    maxFilesPerSubmission: Number(e.target.value),
                  })
                }
              />
            </div>

            <div className="field full">
              <label>Allowed File Extensions (comma-separated)</label>
              <input value={extText} onChange={(e) => setExtText(e.target.value)} />
            </div>
          </div>

          <div className="modal-actions">
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? tr('common.loading') : tr('common.save')}
            </button>
          </div>
        </form>
      )}
    </PortalShell>
  );
}
