import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getBytes, listAll } from 'firebase/storage';

const PROJECT_ID = 'demo-iicombined-tender';

const hasFirestoreEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const hasStorageEmulator = Boolean(process.env.FIREBASE_STORAGE_EMULATOR_HOST);

describe.skipIf(!hasFirestoreEmulator || !hasStorageEmulator)(
  'Firebase Firestore & Storage Security Rules',
  () => {
    let testEnv: RulesTestEnvironment;

    beforeAll(async () => {
      const [fsHost, fsPort] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
      const [stHost, stPort] = (process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199').split(':');

      testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: {
          host: fsHost,
          port: Number(fsPort),
          rules: fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8'),
        },
        storage: {
          host: stHost,
          port: Number(stPort),
          rules: fs.readFileSync(path.resolve(process.cwd(), 'storage.rules'), 'utf8'),
        },
      });

      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        const future = Timestamp.fromMillis(Date.now() + 3600_000);
        const past = Timestamp.fromMillis(Date.now() - 3600_000);

        await setDoc(doc(db, 'memberships/admin_a'), {
          uid: 'admin_a',
          tenantId: 'iicombined',
          role: 'ADMIN',
          status: 'ACTIVE',
          supplierCompanyId: null,
          authzVersion: 1,
        });
        await setDoc(doc(db, 'memberships/dept_u'), {
          uid: 'dept_u',
          tenantId: 'iicombined',
          role: 'USER_DEPARTMENT',
          status: 'ACTIVE',
          supplierCompanyId: null,
          authzVersion: 1,
        });
        await setDoc(doc(db, 'memberships/sup_a1'), {
          uid: 'sup_a1',
          tenantId: 'iicombined',
          role: 'SUPPLIER',
          status: 'ACTIVE',
          supplierCompanyId: 'sup_alpha',
          authzVersion: 1,
        });
        await setDoc(doc(db, 'memberships/sup_a2'), {
          uid: 'sup_a2',
          tenantId: 'iicombined',
          role: 'SUPPLIER',
          status: 'ACTIVE',
          supplierCompanyId: 'sup_alpha',
          authzVersion: 1,
        });
        await setDoc(doc(db, 'memberships/sup_b1'), {
          uid: 'sup_b1',
          tenantId: 'iicombined',
          role: 'SUPPLIER',
          status: 'ACTIVE',
          supplierCompanyId: 'sup_beta',
          authzVersion: 1,
        });
        await setDoc(doc(db, 'memberships/pending_p'), {
          uid: 'pending_p',
          tenantId: 'iicombined',
          role: null,
          status: 'PENDING',
          supplierCompanyId: null,
          authzVersion: 1,
        });

        await setDoc(doc(db, 'tenants/iicombined/tenders/tnd_open/access/sup_a1'), {
          uid: 'sup_a1',
          tenantId: 'iicombined',
          tenderId: 'tnd_open',
          companyId: 'sup_alpha',
          enabled: true,
          published: true,
          deadlineAt: future,
        });
        await setDoc(doc(db, 'tenants/iicombined/tenders/tnd_closed/access/sup_a1'), {
          uid: 'sup_a1',
          tenantId: 'iicombined',
          tenderId: 'tnd_closed',
          companyId: 'sup_alpha',
          enabled: true,
          published: true,
          deadlineAt: past,
        });

        const st = ctx.storage();
        await uploadBytes(
          ref(st, 'protected/iicombined/tnd_open/submissions/sup_beta/v1/f1'),
          new Uint8Array([1, 2, 3]),
          { customMetadata: { scanStatus: 'CLEAN' } }
        );
        await uploadBytes(
          ref(st, 'protected/iicombined/tnd_open/rfp/rfp_clean/v1'),
          new Uint8Array([37, 80, 68, 70]),
          { customMetadata: { scanStatus: 'CLEAN' } }
        );
        await uploadBytes(
          ref(st, 'protected/iicombined/tnd_open/rfp/rfp_pending/v1'),
          new Uint8Array([37, 80, 68, 70]),
          { customMetadata: { scanStatus: 'PENDING' } }
        );
      });
    });

    afterAll(async () => {
      if (testEnv) await testEnv.cleanup();
    });

    it('denies all direct Firestore client reads and writes across roles', async () => {
      const adminDb = testEnv.authenticatedContext('admin_a', { email_verified: true }).firestore();
      const supDb = testEnv.authenticatedContext('sup_a1', { email_verified: true }).firestore();
      const pendingDb = testEnv.authenticatedContext('pending_p', { email_verified: true }).firestore();

      await assertFails(getDoc(doc(adminDb, 'memberships/admin_a')));
      await assertFails(getDoc(doc(supDb, 'tenants/iicombined/tenders/tnd_open/access/sup_a1')));
      await assertFails(
        setDoc(doc(pendingDb, 'memberships/pending_p'), { role: 'ADMIN', status: 'ACTIVE' })
      );
      await assertFails(
        setDoc(doc(supDb, 'tenants/iicombined/tenders/tnd_open/access/sup_a1'), { enabled: true })
      );
    });

    it('enforces Storage staging & protected isolation rules', async () => {
      const supA1 = testEnv
        .authenticatedContext('sup_a1', { email_verified: true })
        .storage();
      const supA2 = testEnv
        .authenticatedContext('sup_a2', { email_verified: true })
        .storage();
      const supB1 = testEnv
        .authenticatedContext('sup_b1', { email_verified: true })
        .storage();
      const unverifiedA1 = testEnv
        .authenticatedContext('sup_a1', { email_verified: false })
        .storage();
      const deptU = testEnv
        .authenticatedContext('dept_u', { email_verified: true })
        .storage();

      // Granted supplier A1 can create staging before deadline
      await assertSucceeds(
        uploadBytes(
          ref(supA1, 'staging/iicombined/tnd_open/sup_alpha/sup_a1/int1/f1'),
          new Uint8Array([37, 80, 68, 70])
        )
      );

      // Overwrite existing staging file is denied
      await assertFails(
        uploadBytes(
          ref(supA1, 'staging/iicombined/tnd_open/sup_alpha/sup_a1/int1/f1'),
          new Uint8Array([37, 80, 68, 70])
        )
      );

      // Unverified email is denied
      await assertFails(
        uploadBytes(
          ref(unverifiedA1, 'staging/iicombined/tnd_open/sup_alpha/sup_a1/int2/f2'),
          new Uint8Array([37, 80, 68, 70])
        )
      );

      // Same-company user A2 without grant is denied
      await assertFails(
        uploadBytes(
          ref(supA2, 'staging/iicombined/tnd_open/sup_alpha/sup_a2/int3/f3'),
          new Uint8Array([37, 80, 68, 70])
        )
      );

      // Closed tender staging upload is denied by Storage Rules request.time < deadlineAt
      await assertFails(
        uploadBytes(
          ref(supA1, 'staging/iicombined/tnd_closed/sup_alpha/sup_a1/int4/f4'),
          new Uint8Array([37, 80, 68, 70])
        )
      );

      // Protected directory list is denied
      await assertFails(listAll(ref(supA1, 'protected/iicombined/tnd_open/submissions/sup_beta')));

      // Reading competitor submission is denied
      await assertFails(
        getBytes(ref(supA1, 'protected/iicombined/tnd_open/submissions/sup_beta/v1/f1'))
      );

      // User department cannot read protected files
      await assertFails(getBytes(ref(deptU, 'protected/iicombined/tnd_open/rfp/rfp_clean/v1')));

      // Granted A1 can read CLEAN published RFP, but NOT PENDING scan RFP
      await assertSucceeds(getBytes(ref(supA1, 'protected/iicombined/tnd_open/rfp/rfp_clean/v1')));
      await assertFails(getBytes(ref(supA1, 'protected/iicombined/tnd_open/rfp/rfp_pending/v1')));

      // Direct client write to protected path is denied
      await assertFails(
        uploadBytes(
          ref(supB1, 'protected/iicombined/tnd_open/submissions/sup_beta/v2/hack'),
          new Uint8Array([1, 2, 3])
        )
      );
    });
  }
);
