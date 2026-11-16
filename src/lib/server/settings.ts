import { getAdminDb } from '@/lib/firebase/admin';
import type { TenantSettings } from '@/types/domain';

export const DEFAULT_TENANT_SETTINGS: TenantSettings = {
  organizationName: 'IICOMBINED',
  displayTimeZone: 'Asia/Seoul',
  defaultLanguage: 'ko',
  maxFileSizeMb: 50,
  maxFilesPerSubmission: 15,
  allowedExtensions: [
    'pdf',
    'doc',
    'docx',
    'xls',
    'xlsx',
    'ppt',
    'pptx',
    'zip',
    'png',
    'jpg',
    'jpeg',
    'dwg',
    'dxf',
  ],
  inviteExpiryDays: 14,
  updatedAt: new Date(0).toISOString(),
  updatedByUid: null,
};

export async function getTenantSettings(tenantId: string): Promise<TenantSettings> {
  const db = getAdminDb();
  const snap = await db.doc(`tenants/${tenantId}/settings/default`).get();
  if (!snap.exists) {
    return { ...DEFAULT_TENANT_SETTINGS };
  }
  return {
    ...DEFAULT_TENANT_SETTINGS,
    ...(snap.data() as Partial<TenantSettings>),
  };
}
