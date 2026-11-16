import { requirePageRole } from '@/lib/server/pageGuard';
import { SupplierTenderDetailClient } from '@/components/supplier/SupplierTenderDetailClient';

export const dynamic = 'force-dynamic';

export default async function SupplierTenderDetailPage({
  params,
}: {
  params: Promise<{ tenderId: string }>;
}) {
  const ctx = await requirePageRole(['SUPPLIER']);
  const { tenderId } = await params;
  return (
    <SupplierTenderDetailClient
      tenderId={tenderId}
      displayName={ctx.displayName}
      email={ctx.email}
      organizationName={ctx.organizationName}
    />
  );
}
