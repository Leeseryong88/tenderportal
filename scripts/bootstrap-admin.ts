/**
 * Operator-only CLI script to bootstrap the initial tenant owner ADMIN.
 * Never exposed as a public web API.
 *
 * Usage:
 *   npx tsx scripts/bootstrap-admin.ts --email admin@iicombined.com --tenant iicombined
 *   npx tsx scripts/bootstrap-admin.ts --uid <firebaseUid> --tenant iicombined
 */
import { loadEnvFiles } from './loadEnv';
loadEnvFiles();
import { getAdminAuth, getAdminDb, getDefaultTenantId } from '../src/lib/firebase/admin';
import { writeAuditLog } from '../src/lib/server/audit';
import type { MembershipRecord } from '../src/types/domain';

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

async function main() {
  const uidArg = getArg('--uid');
  const emailArg = getArg('--email');
  const tenantId = getArg('--tenant') || getDefaultTenantId();
  const forceVerified = process.argv.includes('--verify-email-for-emulator');

  if (!uidArg && !emailArg) {
    console.error('Error: Provide --uid <uid> or --email <email>.');
    process.exit(1);
  }

  const auth = getAdminAuth();
  const db = getAdminDb();

  const user = uidArg
    ? await auth.getUser(uidArg)
    : await auth.getUserByEmail(emailArg!.trim().toLowerCase());

  if (!user.emailVerified) {
    if (forceVerified && process.env.FIREBASE_AUTH_EMULATOR_HOST) {
      await auth.updateUser(user.uid, { emailVerified: true });
    } else {
      console.error(
        `Error: User ${user.uid} (${user.email}) has not verified their email address.`
      );
      process.exit(1);
    }
  }

  const membershipRef = db.doc(`memberships/${user.uid}`);
  const existingSnap = await membershipRef.get();
  const prevVersion = existingSnap.exists
    ? Number((existingSnap.data() as MembershipRecord).authzVersion || 0)
    : 0;
  const nextVersion = prevVersion + 1;
  const now = new Date().toISOString();

  const nextMembership: MembershipRecord = {
    uid: user.uid,
    tenantId,
    role: 'ADMIN',
    status: 'ACTIVE',
    supplierCompanyId: null,
    authzVersion: nextVersion,
    canManageAdmins: true,
    updatedAt: now,
    updatedByUid: 'OPERATOR_BOOTSTRAP',
  };

  await membershipRef.set(nextMembership);
  await db.doc(`accessRequests/${user.uid}`).set(
    {
      uid: user.uid,
      verifiedEmail: user.email || '',
      displayName: user.displayName || 'System Owner',
      phone: '',
      requestedRole: 'USER_DEPARTMENT',
      requestedCompanyOrDept: tenantId,
      status: 'ACTIVE',
      decisionByUid: 'OPERATOR_BOOTSTRAP',
      decisionReason: 'Initial tenant owner bootstrap',
      decidedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  await auth.setCustomUserClaims(user.uid, {
    tenantId,
    role: 'ADMIN',
    status: 'ACTIVE',
    authzVersion: nextVersion,
  });
  await auth.revokeRefreshTokens(user.uid);

  await writeAuditLog({
    tenantId,
    actorUid: user.uid,
    actorRole: 'SYSTEM_BOOTSTRAP',
    action: 'BOOTSTRAP_OWNER_ADMIN',
    targetType: 'membership',
    targetId: user.uid,
    beforeSummary: existingSnap.exists ? (existingSnap.data() as Record<string, unknown>) : null,
    afterSummary: nextMembership as unknown as Record<string, unknown>,
    reason: 'Operator CLI bootstrap',
  });

  console.log(
    `[OK] Bootstrapped owner ADMIN: uid=${user.uid}, email=${user.email}, tenant=${tenantId}, authzVersion=${nextVersion}`
  );
}

main().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
