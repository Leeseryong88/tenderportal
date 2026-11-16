import { requirePageRole } from '@/lib/server/pageGuard';
import { SupplierPoolClient } from '@/components/domain/SupplierPoolClient';

export const dynamic = 'force-dynamic';

export default async function DepartmentSuppliersPage() {
  const ctx = await requirePageRole(['USER_DEPARTMENT', 'ADMIN']);
  return (
    <SupplierPoolClient
      role={ctx.role}
      displayName={ctx.displayName}
      email={ctx.email}
      organizationName={ctx.organizationName}
    />
  );
}
