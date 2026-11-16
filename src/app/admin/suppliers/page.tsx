import { requirePageRole } from '@/lib/server/pageGuard';
import { SupplierPoolClient } from '@/components/domain/SupplierPoolClient';

export const dynamic = 'force-dynamic';

export default async function AdminSuppliersPage() {
  const ctx = await requirePageRole(['ADMIN']);
  return (
    <SupplierPoolClient
      role="ADMIN"
      displayName={ctx.displayName}
      email={ctx.email}
      organizationName={ctx.organizationName}
    />
  );
}
