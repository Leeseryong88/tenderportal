import { requirePageRole } from '@/lib/server/pageGuard';
import { AdminDashboardClient } from '@/components/admin/AdminDashboardClient';

export const dynamic = 'force-dynamic';

export default async function AdminDashboardPage() {
  const ctx = await requirePageRole(['ADMIN']);
  return (
    <AdminDashboardClient
      displayName={ctx.displayName}
      email={ctx.email}
      organizationName={ctx.organizationName}
    />
  );
}
