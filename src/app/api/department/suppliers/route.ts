import { getAdminDb } from '@/lib/firebase/admin';
import { AuthzError, authorize } from '@/lib/server/authz';
import { toSupplierDirectoryDTO } from '@/lib/domain/coverage';
import { jsonError, jsonPrivate } from '@/lib/server/security';
import type { SupplierDirectoryDTO } from '@/types/domain';

export async function GET() {
  try {
    const { actor } = await authorize('DEPARTMENT_POOL_READ');
    const db = getAdminDb();

    // Reads ONLY the restricted supplierDirectory projection (never raw suppliers, tenders, or files)
    const snap = await db.collection(`tenants/${actor.tenantId}/supplierDirectory`).get();
    const suppliers: SupplierDirectoryDTO[] = snap.docs
      .map((d) => toSupplierDirectoryDTO(d.data() as never))
      .sort((a, b) => a.name.localeCompare(b.name));

    return jsonPrivate({ suppliers });
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to load supplier directory.', 500);
  }
}
