import crypto from 'crypto';
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

export async function GET() {
  try {
    const { actor } = await authorize('ADMIN_SUPPLIERS_READ');
    const db = getAdminDb();
    const snap = await db.collection(`tenants/${actor.tenantId}/suppliers`).get();
    const suppliers = snap.docs
      .map((d) => d.data() as SupplierRecord)
      .sort((a, b) => a.name.localeCompare(b.name));
    return jsonPrivate({ suppliers });
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to load suppliers.', 500);
  }
}

export async function POST(req: NextRequest) {
  const originCheck = assertValidOrigin(req);
  if (!originCheck.ok) {
    return jsonError('ORIGIN_FORBIDDEN', originCheck.reason || 'Forbidden origin.', 403);
  }

  try {
    const { actor } = await authorize('ADMIN_SUPPLIERS_WRITE');
    const parsed = supplierUpsertSchema.safeParse(await req.json());
    if (!parsed.success) {
      return jsonError('VALIDATION_ERROR', 'Invalid supplier payload.', 400);
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

    const db = getAdminDb();
    const id = `sup_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const now = new Date().toISOString();

    const supplier: SupplierRecord = {
      id,
      tenantId: actor.tenantId,
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
      internalNotes: parsed.data.internalNotes || '',
      createdAt: now,
      updatedAt: now,
    };

    const batch = db.batch();
    batch.set(db.doc(`tenants/${actor.tenantId}/suppliers/${id}`), supplier);
    batch.set(
      db.doc(`tenants/${actor.tenantId}/supplierDirectory/${id}`),
      toSupplierDirectoryDTO(supplier)
    );
    await batch.commit();

    await writeAuditLog({
      tenantId: actor.tenantId,
      actorUid: actor.uid,
      actorRole: actor.role,
      action: 'SUPPLIER_CREATED',
      targetType: 'supplier',
      targetId: id,
      afterSummary: { name: supplier.name, countryCode: supplier.countryCode },
    });

    return jsonPrivate({ supplier }, 201);
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to create supplier.', 500);
  }
}
