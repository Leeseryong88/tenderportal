/**
 * Operator recovery / revocation CLI script.
 * Revokes tokens, disables membership, and revokes all active tender access grants.
 *
 * Usage:
 *   npx tsx scripts/revoke-user.ts --uid <uid> --tenant iicombined --reason "Emergency revoke"
 */
import { loadEnvFiles } from './loadEnv';
loadEnvFiles();
import { getAdminAuth, getAdminDb, getDefaultTenantId } from '../src/lib/firebase/admin';
import { writeAuditLog } from '../src/lib/server/audit';
import { revokeUserTenderGrants } from '../src/lib/server/tenderProjection';
import type { MembershipRecord } from '../src/types/domain';

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

async function main() {
  const uid = getArg('--uid');
  const tenantId = getArg('--tenant') || getDefaultTenantId();
  const reason = getArg('--reason') || 'Operator emergency revocation';

  if (!uid) {
    console.error('Error: --uid <uid> is required.');
    process.exit(1);
  }

  const db = getAdminDb();
  const auth = getAdminAuth();
  const membershipRef = db.doc(`memberships/${uid}`);
  const snap = await membershipRef.get();
  if (!snap.exists) {
    console.error('Membership not found for uid:', uid);
    process.exit(1);
  }

  const current = snap.data() as MembershipRecord;
  if (current.role === 'ADMIN' && current.status === 'ACTIVE') {
    const activeAdmins = await db
      .collection('memberships')
      .where('tenantId', '==', tenantId)
      .where('role', '==', 'ADMIN')
      .where('status', '==', 'ACTIVE')
      .get();
    if (activeAdmins.size <= 1) {
      console.error('Blocked: Cannot disable the last active ADMIN in tenant.');
      process.exit(1);
    }
  }

  // 1) Revoke grants first
  await revokeUserTenderGrants(tenantId, uid);

  // 2) Bump authzVersion and set DISABLED
  const nextVersion = (current.authzVersion || 1) + 1;
  const now = new Date().toISOString();
  await membershipRef.set(
    {
      ...current,
      status: 'DISABLED',
      authzVersion: nextVersion,
      updatedAt: now,
      updatedByUid: 'OPERATOR_CLI',
    },
    { merge: true }
  );

  // 3) Revoke Auth refresh tokens and disable Firebase Auth account
  await auth.setCustomUserClaims(uid, {
    tenantId,
    role: current.role,
    status: 'DISABLED',
    authzVersion: nextVersion,
  });
  await auth.revokeRefreshTokens(uid);
  await auth.updateUser(uid, { disabled: true });

  await writeAuditLog({
    tenantId,
    actorUid: 'OPERATOR_CLI',
    actorRole: 'SYSTEM_BOOTSTRAP',
    action: 'OPERATOR_REVOKE_USER',
    targetType: 'membership',
    targetId: uid,
    beforeSummary: current as unknown as Record<string, unknown>,
    afterSummary: { status: 'DISABLED', authzVersion: nextVersion },
    reason,
  });

  console.log(`[OK] Revoked user ${uid} (authzVersion=${nextVersion}).`);
}

main().catch((err) => {
  console.error('Revoke failed:', err);
  process.exit(1);
});
