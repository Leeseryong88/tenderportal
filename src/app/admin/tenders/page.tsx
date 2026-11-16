import { requirePageRole } from '@/lib/server/pageGuard';
import { AdminTendersClient } from '@/components/admin/AdminTendersClient';

export const dynamic = 'force-dynamic';

export default async function AdminTendersPage() {
  const ctx = await requirePageRole(['ADMIN']);
  return (
    <AdminTendersClient
      displayName={ctx.displayName}
      email={ctx.email}
      organizationName={ctx.organizationName}
    />
  );
}
