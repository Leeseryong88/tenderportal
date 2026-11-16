import { NextRequest } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { AuthzError, authorize } from '@/lib/server/authz';
import {
  normalizeCountryInput,
  normalizeCoverageList,
  toSupplierDirectoryDTO,
} from '@/lib/domain/coverage';
import { writeAuditLog } from '@/lib/server/audit';
import { assertValidOrigin, jsonError, jsonPrivate } from '@/lib/server/security';
import { supplierUpsertSchema } from '@/lib/validation/schemas';
import type { SupplierRecord } from '@/types/domain';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ supplierId: string }> }
) {
  const originCheck = assertValidOrigin(req);
  if (!originCheck.ok) {
    return jsonError('ORIGIN_FORBIDDEN', originCheck.reason || 'Forbidden origin.', 403);
  }

  try {
    const { actor } = await authorize('ADMIN_SUPPLIERS_WRITE');
    const { supplierId } = await context.params;
    const parsed = supplierUpsertSchema.safeParse(await req.json());
    if (!parsed.success) {
      return jsonError('VALIDATION_ERROR', 'Invalid supplier payload.', 400);
    }

    const db = getAdminDb();
    const ref = db.doc(`tenants/${actor.tenantId}/suppliers/${supplierId}`);
    const snap = await ref.get();
    if (!snap.exists) {
      return jsonError('NOT_FOUND', 'Supplier not found.', 404);
    }

    const existing = snap.data() as SupplierRecord;
    if (existing.tenantId !== actor.tenantId) {
      return jsonError('FORBIDDEN', 'Access denied.', 403);
    }

    const ctry = normalizeCountryInput(parsed.data.country);
    const coverage = normalizeCoverageList(parsed.data.coverage);
    if (!coverage.length) {
      return jsonError('VALIDATION_ERROR', 'At least one coverage market is required.', 400);
    }

    const contacts = parsed.data.contacts
      .filter((c) => c.country || c.city || c.name || c.email || c.phone)
      .map((c) => {
        const cc = normalizeCountryInput(c.country);
        return {
          countryCode: cc.countryCode,
          countryName: cc.countryName,
          city: c.city,
          name: c.name,
          email: c.email,
          phone: c.phone,
        };
      });

    const updated: SupplierRecord = {
      ...existing,
      name: parsed.data.name,
      countryCode: ctry.countryCode,
      countryName: ctry.countryName,
      city: parsed.data.city,
      categories: parsed.data.categories,
      coverage,
      contacts,
      website: parsed.data.website,
      ndaStatus: parsed.data.ndaStatus,
      ndaSignedDate: parsed.data.ndaSignedDate,
      license: parsed.data.license,
      licenseStatus: parsed.data.licenseStatus,
      licenseExpiry: parsed.data.licenseExpiry,
      status: parsed.data.status,
      internalNotes: parsed.data.internalNotes ?? existing.internalNotes ?? '',
      updatedAt: new Date().toISOString(),
    };

    const batch = db.batch();
    batch.set(ref, updated);
    batch.set(
      db.doc(`tenants/${actor.tenantId}/supplierDirectory/${supplierId}`),
      toSupplierDirectoryDTO(updated)
    );
    await batch.commit();

    await writeAuditLog({
      tenantId: actor.tenantId,
      actorUid: actor.uid,
      actorRole: actor.role,
      action: 'SUPPLIER_UPDATED',
      targetType: 'supplier',
      targetId: supplierId,
      beforeSummary: { name: existing.name, ndaStatus: existing.ndaStatus },
      afterSummary: { name: updated.name, ndaStatus: updated.ndaStatus },
    });

    return jsonPrivate({ supplier: updated });
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to update supplier.', 500);
  }
}
