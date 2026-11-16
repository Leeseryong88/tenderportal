import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, getAdminStorage } from '@/lib/firebase/admin';
import { AuthzError, authorize } from '@/lib/server/authz';
import { jsonError, noStoreHeaders, sanitizeHeaderFilename } from '@/lib/server/security';
import type { StoredFileRecord } from '@/types/domain';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ fileId: string }> }
) {
  try {
    const { actor } = await authorize('FILE_DOWNLOAD');
    const { fileId } = await context.params;
    const db = getAdminDb();

    // User Department has NO file download access anywhere
    if (actor.role === 'USER_DEPARTMENT') {
      return jsonError('FORBIDDEN', 'Access denied.', 403);
    }

    const fileSnap = await db.doc(`tenants/${actor.tenantId}/files/${fileId}`).get();
    if (!fileSnap.exists) {
      // Uniform error to prevent existence probing
      return jsonError('FORBIDDEN', 'Access denied.', 403);
    }

    const file = fileSnap.data() as StoredFileRecord;
    if (file.tenantId !== actor.tenantId) {
      return jsonError('FORBIDDEN', 'Access denied.', 403);
    }

    if (actor.role === 'SUPPLIER') {
      // Re-verify per-tender UID grant + ownership/publication scope
      await authorize('SUPPLIER_TENDER_READ', { tenderId: file.tenderId });

      if (file.ownerScope === 'RFP') {
        if (!file.publishedToSuppliers) {
          return jsonError('FORBIDDEN', 'Access denied.', 403);
        }
      } else if (file.ownerScope === 'SUBMISSION') {
        if (file.companyId !== actor.supplierCompanyId) {
          return jsonError('FORBIDDEN', 'Access denied.', 403);
        }
      } else {
        return jsonError('FORBIDDEN', 'Access denied.', 403);
      }
    }

    const bucket = getAdminStorage().bucket();
    const obj = bucket.file(file.storagePath);
    const [exists] = await obj.exists();
    if (!exists) {
      return jsonError('FILE_NOT_FOUND', 'Stored file object not found.', 404);
    }

    const [buf] = await obj.download();
    const safeAscii = sanitizeHeaderFilename(file.originalName);
    const encodedName = encodeURIComponent(file.originalName);

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        ...noStoreHeaders(),
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodedName}`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Length': String(buf.length),
      },
    });
  } catch (err) {
    if (err instanceof AuthzError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('INTERNAL_ERROR', 'Failed to download file.', 500);
  }
}
