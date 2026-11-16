import { requirePageRole } from '@/lib/server/pageGuard';
import { AdminUsersClient } from '@/components/admin/AdminUsersClient';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const ctx = await requirePageRole(['ADMIN']);
  return (
    <AdminUsersClient
      displayName={ctx.displayName}
      email={ctx.email}
      organizationName={ctx.organizationName}
    />
  );
}
