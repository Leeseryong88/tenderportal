import { requirePageRole } from '@/lib/server/pageGuard';
import { AdminProjectsClient } from '@/components/admin/AdminProjectsClient';

export const dynamic = 'force-dynamic';

export default async function AdminProjectsPage() {
  const ctx = await requirePageRole(['ADMIN']);
  return (
    <AdminProjectsClient
      displayName={ctx.displayName}
      email={ctx.email}
      organizationName={ctx.organizationName}
    />
  );
}
