import { requirePageRole } from '@/lib/server/pageGuard';
import { AdminSettingsClient } from '@/components/admin/AdminSettingsClient';

export const dynamic = 'force-dynamic';

export default async function AdminSettingsPage() {
  const ctx = await requirePageRole(['ADMIN']);
  return (
    <AdminSettingsClient
      displayName={ctx.displayName}
      email={ctx.email}
      organizationName={ctx.organizationName}
    />
  );
}
