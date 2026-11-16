import { requirePageRole } from '@/lib/server/pageGuard';
import { SupplierTendersClient } from '@/components/supplier/SupplierTendersClient';

export const dynamic = 'force-dynamic';

export default async function SupplierTendersPage() {
  const ctx = await requirePageRole(['SUPPLIER']);
  return (
    <SupplierTendersClient
      displayName={ctx.displayName}
      email={ctx.email}
      organizationName={ctx.organizationName}
    />
  );
}
