import type { Firestore } from 'firebase-admin/firestore';
import { getAdminAuth } from '@/lib/firebase/admin';
import type { AuditNames } from '@/lib/audit/format';
import type { AuditLogRecord } from '@/types/domain';

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

/** Resolves display names for the ids referenced by audit logs, so the UI never has to show raw ids. */
export async function buildAuditNameIndex(
  db: Firestore,
  tenantId: string,
  logs: AuditLogRecord[]
): Promise<AuditNames> {
  const users = new Set<string>();
  const tenders = new Set<string>();
  const projects = new Set<string>();
  const suppliers = new Set<string>();
  const files = new Set<string>();

  for (const log of logs) {
    users.add(log.actorUid);
    const after = log.afterSummary || {};
    const before = log.beforeSummary || {};
    const [first, second] = log.targetId.split(':');

    switch (log.targetType) {
      case 'membership':
      case 'accessRequest':
        users.add(log.targetId);
        break;
      case 'tender':
        tenders.add(log.targetId);
        break;
      case 'project':
        projects.add(log.targetId);
        break;
      case 'supplier':
        suppliers.add(log.targetId);
        break;
      case 'file':
        files.add(log.targetId);
        break;
      case 'submissionVersion':
      case 'tenderParticipant':
        if (first) tenders.add(first);
        if (second) suppliers.add(second);
        break;
    }

    for (const summary of [before, after]) {
      const tenderId = str(summary.tenderId);
      if (tenderId) tenders.add(tenderId);
      const companyId = str(summary.companyId);
      if (companyId) suppliers.add(companyId);
      const supplierCompanyId = str(summary.supplierCompanyId);
      if (supplierCompanyId) suppliers.add(supplierCompanyId);
      const assigned = summary.assignedUserIds;
      if (Array.isArray(assigned)) assigned.forEach((u) => typeof u === 'string' && users.add(u));
    }
  }

  async function lookup(
    ids: Set<string>,
    pathFor: (id: string) => string,
    label: (data: Record<string, unknown>) => string | null
  ): Promise<Record<string, string>> {
    const valid = [...ids].filter((id) => id && !id.includes('/'));
    if (!valid.length) return {};
    const snaps = await db.getAll(...valid.map((id) => db.doc(pathFor(id))));
    const out: Record<string, string> = {};
    snaps.forEach((snap, i) => {
      if (!snap.exists) return;
      const name = label(snap.data() as Record<string, unknown>);
      if (name) out[valid[i]!] = name;
    });
    return out;
  }

  const [userNames, tenderNames, projectNames, supplierNames, fileNames] = await Promise.all([
    lookup(users, (id) => `accessRequests/${id}`, (d) => {
      const name = str(d.displayName);
      const email = str(d.verifiedEmail);
      return name && email ? `${name} (${email})` : name || email;
    }),
    lookup(tenders, (id) => `tenants/${tenantId}/tenders/${id}`, (d) => str(d.name) || str(d.code)),
    lookup(projects, (id) => `tenants/${tenantId}/projects/${id}`, (d) => str(d.name)),
    lookup(suppliers, (id) => `tenants/${tenantId}/suppliers/${id}`, (d) => str(d.name)),
    lookup(files, (id) => `tenants/${tenantId}/files/${id}`, (d) => str(d.originalName)),
  ]);

  const missingUids = [...users].filter((uid) => uid && !userNames[uid]).slice(0, 100);
  if (missingUids.length) {
    try {
      const result = await getAdminAuth().getUsers(missingUids.map((uid) => ({ uid })));
      for (const u of result.users) {
        const label = u.displayName && u.email ? `${u.displayName} (${u.email})` : u.displayName || u.email;
        if (label) userNames[u.uid] = label;
      }
    } catch {
      // Names are cosmetic; the UI falls back to a shortened id.
    }
  }

  return {
    users: userNames,
    tenders: tenderNames,
    projects: projectNames,
    suppliers: supplierNames,
    files: fileNames,
  };
}
