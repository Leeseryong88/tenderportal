import { requirePageRole } from '@/lib/server/pageGuard';
import { AdminAuditClient } from '@/components/admin/AdminAuditClient';

export const dynamic = 'force-dynamic';

export default async function AdminAuditPage() {
  const ctx = await requirePageRole(['ADMIN']);
  return (
    <AdminAuditClient
      displayName={ctx.displayName}
      email={ctx.email}
      organizationName={ctx.organizationName}
      displayTimeZone={ctx.displayTimeZone}
    />
  );
}
