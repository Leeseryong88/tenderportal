/**
 * Development & Emulator seed script.
 * SAFETY GUARD: Refuses to run in production or against non-emulator targets
 * unless ALLOW_NON_EMULATOR_SEED=true is explicitly set for a staging project.
 */
import { loadEnvFiles } from './loadEnv';
loadEnvFiles();
import { Timestamp } from 'firebase-admin/firestore';
import { getAdminAuth, getAdminDb, getDefaultTenantId } from '../src/lib/firebase/admin';
import { normalizeCoverageList, normalizeCountryInput, toSupplierDirectoryDTO } from '../src/lib/domain/coverage';
import { emptyProcurementSchedule } from '../src/lib/domain/schedule';
import { DEFAULT_TENANT_SETTINGS } from '../src/lib/server/settings';
import type {
  MembershipRecord,
  ProjectRecord,
  SupplierRecord,
  TenderRecord,
} from '../src/types/domain';

function assertSafeSeedEnvironment() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SAFETY BLOCK: seed-dev.ts cannot run when NODE_ENV=production.');
  }
  const hasEmulator =
    Boolean(process.env.FIRESTORE_EMULATOR_HOST) && Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);
  if (!hasEmulator && process.env.ALLOW_NON_EMULATOR_SEED !== 'true') {
    throw new Error(
      'SAFETY BLOCK: Emulator env vars not detected. Set FIRESTORE_EMULATOR_HOST + FIREBASE_AUTH_EMULATOR_HOST or ALLOW_NON_EMULATOR_SEED=true for staging.'
    );
  }
}

async function ensureUser(params: {
  uid: string;
  email: string;
  password: string;
  displayName: string;
  emailVerified: boolean;
  disabled?: boolean;
}) {
  const auth = getAdminAuth();
  try {
    await auth.getUser(params.uid);
    await auth.updateUser(params.uid, {
      email: params.email,
      password: params.password,
      displayName: params.displayName,
      emailVerified: params.emailVerified,
      disabled: Boolean(params.disabled),
    });
  } catch {
    await auth.createUser({
      uid: params.uid,
      email: params.email,
      password: params.password,
      displayName: params.displayName,
      emailVerified: params.emailVerified,
      disabled: Boolean(params.disabled),
    });
  }
}

async function main() {
  assertSafeSeedEnvironment();
  const db = getAdminDb();
  const auth = getAdminAuth();
  const tenantId = getDefaultTenantId();
  const otherTenantId = 'other-org';
  const now = new Date().toISOString();

  await db.doc(`tenants/${tenantId}/settings/default`).set({
    ...DEFAULT_TENANT_SETTINGS,
    updatedAt: now,
    updatedByUid: 'seed-dev',
  });

  // 1) Suppliers (including Australia & US state coverage for testing)
  const supplierSpecs: Array<{
    id: string;
    name: string;
    country: string;
    city: string;
    categories: string[];
    ndaStatus: SupplierRecord['ndaStatus'];
    licenseStatus: SupplierRecord['licenseStatus'];
    license: string;
    licenseExpiry: string;
    coverage: Array<{ market: string; deliveryMode: 'DIRECT' | 'LOCAL_PARTNER' | 'UNAVAILABLE' }>;
    contactName: string;
    contactEmail: string;
  }> = [
    {
      id: 'sup_alpha',
      name: 'Alpha Studio GmbH',
      country: 'Germany',
      city: 'Berlin',
      categories: ['PM Services', 'GC / Construction'],
      ndaStatus: 'Signed',
      licenseStatus: 'Current',
      license: 'DE-GC-2026-01',
      licenseExpiry: '2027-08-31',
      coverage: [
        { market: 'Germany', deliveryMode: 'DIRECT' },
        { market: 'Italy', deliveryMode: 'DIRECT' },
        { market: 'France', deliveryMode: 'LOCAL_PARTNER' },
        { market: 'Australia', deliveryMode: 'DIRECT' },
      ],
      contactName: 'Lena Fischer',
      contactEmail: 'alpha1@example.test',
    },
    {
      id: 'sup_beta',
      name: 'Beta Build US Inc.',
      country: 'United States',
      city: 'Dallas',
      categories: ['GC / Construction', 'AOR / Architect Services'],
      ndaStatus: 'Not Signed',
      licenseStatus: 'Renewal Planned',
      license: 'US-TX-9981',
      licenseExpiry: '2027-02-28',
      coverage: [
        { market: 'Texas', deliveryMode: 'DIRECT' },
        { market: 'New York', deliveryMode: 'DIRECT' },
        { market: 'California', deliveryMode: 'LOCAL_PARTNER' },
        { market: 'Massachusetts', deliveryMode: 'UNAVAILABLE' },
      ],
      contactName: 'Marcus Reed',
      contactEmail: 'beta1@example.test',
    },
    {
      id: 'sup_gamma',
      name: 'Gamma Pacific Pty Ltd',
      country: 'Australia',
      city: 'Sydney',
      categories: ['PM Services'],
      ndaStatus: 'Not Checked',
      licenseStatus: 'Not Required',
      license: '',
      licenseExpiry: '',
      coverage: [
        { market: 'AU', deliveryMode: 'DIRECT' },
        { market: 'United States', deliveryMode: 'LOCAL_PARTNER' },
      ],
      contactName: 'Chloe Ward',
      contactEmail: 'gamma@example.test',
    },
  ];

  for (const spec of supplierSpecs) {
    const ctry = normalizeCountryInput(spec.country);
    const rec: SupplierRecord = {
      id: spec.id,
      tenantId,
      name: spec.name,
      countryCode: ctry.countryCode,
      countryName: ctry.countryName,
      city: spec.city,
      categories: spec.categories,
      coverage: normalizeCoverageList(spec.coverage),
      contacts: [
        {
          countryCode: ctry.countryCode,
          countryName: ctry.countryName,
          city: spec.city,
          name: spec.contactName,
          email: spec.contactEmail,
          phone: '+1-555-0100',
        },
      ],
      website: 'https://example.test',
      ndaStatus: spec.ndaStatus,
      ndaSignedDate: spec.ndaStatus === 'Signed' ? '2026-06-01' : '',
      license: spec.license,
      licenseStatus: spec.licenseStatus,
      licenseExpiry: spec.licenseExpiry,
      status: 'Active',
      internalNotes: 'INTERNAL ADMIN NOTE - DO NOT EXPOSE TO DEPARTMENT OR SUPPLIER',
      createdAt: now,
      updatedAt: now,
    };

    await db.doc(`tenants/${tenantId}/suppliers/${rec.id}`).set(rec);
    await db
      .doc(`tenants/${tenantId}/supplierDirectory/${rec.id}`)
      .set(toSupplierDirectoryDTO(rec));
  }

  // 2) Projects
  const s1 = emptyProcurementSchedule();
  s1.rfpDistribution = { dateLocal: '2026-11-16', status: 'PLANNED' };
  s1.rfiReceipt = { dateLocal: null, status: 'NOT_APPLICABLE' };
  s1.rfpReceipt = { dateLocal: '2026-11-28', status: 'PLANNED' };

  const projects: ProjectRecord[] = [
    {
      id: 'prj_berlin',
      tenantId,
      code: 'PRJ-2026-014',
      name: 'Berlin Mitte Flagship',
      countryCode: 'DE',
      countryName: 'Germany',
      city: 'Berlin',
      type: 'Maison',
      owner: 'Admin A',
      status: 'In Progress',
      timeZone: 'Europe/Berlin',
      dateLocal: '2026-10-28',
      masterSchedule: s1,
      createdAt: now,
      updatedAt: now,
      createdByUid: 'admin_a',
    },
    {
      id: 'prj_sydney',
      tenantId,
      code: 'PRJ-2026-015',
      name: 'Sydney Galleria',
      countryCode: 'AU',
      countryName: 'Australia',
      city: 'Sydney',
      type: 'Department Store',
      owner: 'Admin A',
      status: 'Planning',
      timeZone: 'Australia/Sydney',
      dateLocal: '2026-11-02',
      masterSchedule: emptyProcurementSchedule(),
      createdAt: now,
      updatedAt: now,
      createdByUid: 'admin_a',
    },
  ];

  for (const p of projects) {
    await db.doc(`tenants/${tenantId}/projects/${p.id}`).set(p);
  }

  // 3) Users covering every test role/state in Section 10
  const accounts: Array<{
    uid: string;
    email: string;
    displayName: string;
    verified: boolean;
    disabled?: boolean;
    membership: MembershipRecord;
  }> = [
    {
      uid: 'admin_a',
      email: 'admin.a@iicombined.test',
      displayName: 'Admin A',
      verified: true,
      membership: {
        uid: 'admin_a',
        tenantId,
        role: 'ADMIN',
        status: 'ACTIVE',
        supplierCompanyId: null,
        authzVersion: 1,
        canManageAdmins: true,
        updatedAt: now,
        updatedByUid: 'seed-dev',
      },
    },
    {
      uid: 'dept_u',
      email: 'dept.u@iicombined.test',
      displayName: 'User Department U',
      verified: true,
      membership: {
        uid: 'dept_u',
        tenantId,
        role: 'USER_DEPARTMENT',
        status: 'ACTIVE',
        supplierCompanyId: null,
        authzVersion: 1,
        canManageAdmins: false,
        updatedAt: now,
        updatedByUid: 'admin_a',
      },
    },
    {
      uid: 'sup_a1',
      email: 'a1@alpha.test',
      displayName: 'Alpha User A1',
      verified: true,
      membership: {
        uid: 'sup_a1',
        tenantId,
        role: 'SUPPLIER',
        status: 'ACTIVE',
        supplierCompanyId: 'sup_alpha',
        authzVersion: 1,
        canManageAdmins: false,
        updatedAt: now,
        updatedByUid: 'admin_a',
      },
    },
    {
      uid: 'sup_a2',
      email: 'a2@alpha.test',
      displayName: 'Alpha User A2',
      verified: true,
      membership: {
        uid: 'sup_a2',
        tenantId,
        role: 'SUPPLIER',
        status: 'ACTIVE',
        supplierCompanyId: 'sup_alpha',
        authzVersion: 1,
        canManageAdmins: false,
        updatedAt: now,
        updatedByUid: 'admin_a',
      },
    },
    {
      uid: 'sup_b1',
      email: 'b1@beta.test',
      displayName: 'Beta User B1',
      verified: true,
      membership: {
        uid: 'sup_b1',
        tenantId,
        role: 'SUPPLIER',
        status: 'ACTIVE',
        supplierCompanyId: 'sup_beta',
        authzVersion: 1,
        canManageAdmins: false,
        updatedAt: now,
        updatedByUid: 'admin_a',
      },
    },
    {
      uid: 'pending_p',
      email: 'pending.p@example.test',
      displayName: 'Pending P',
      verified: true,
      membership: {
        uid: 'pending_p',
        tenantId,
        role: null,
        status: 'PENDING',
        supplierCompanyId: null,
        authzVersion: 1,
        canManageAdmins: false,
        updatedAt: now,
        updatedByUid: null,
      },
    },
    {
      uid: 'disabled_d',
      email: 'disabled.d@example.test',
      displayName: 'Disabled D',
      verified: true,
      disabled: true,
      membership: {
        uid: 'disabled_d',
        tenantId,
        role: 'SUPPLIER',
        status: 'DISABLED',
        supplierCompanyId: 'sup_alpha',
        authzVersion: 2,
        canManageAdmins: false,
        updatedAt: now,
        updatedByUid: 'admin_a',
      },
    },
    {
      uid: 'admin_x',
      email: 'admin.x@other.test',
      displayName: 'Other Tenant Admin X',
      verified: true,
      membership: {
        uid: 'admin_x',
        tenantId: otherTenantId,
        role: 'ADMIN',
        status: 'ACTIVE',
        supplierCompanyId: null,
        authzVersion: 1,
        canManageAdmins: true,
        updatedAt: now,
        updatedByUid: 'seed-dev',
      },
    },
  ];

  const defaultPass = 'TestPass!2026';
  for (const acc of accounts) {
    await ensureUser({
      uid: acc.uid,
      email: acc.email,
      password: defaultPass,
      displayName: acc.displayName,
      emailVerified: acc.verified,
      disabled: acc.disabled,
    });
    await db.doc(`memberships/${acc.uid}`).set(acc.membership);
    await db.doc(`accountProfiles/${acc.uid}`).set({
      uid: acc.uid,
      email: acc.email,
      displayName: acc.displayName,
      phone: '+82-10-0000-0000',
      departmentOrCompany: acc.membership.supplierCompanyId || 'IICOMBINED',
      createdAt: now,
      updatedAt: now,
    });
    await db.doc(`accessRequests/${acc.uid}`).set({
      uid: acc.uid,
      verifiedEmail: acc.email,
      displayName: acc.displayName,
      phone: '+82-10-0000-0000',
      requestedRole: acc.membership.role === 'SUPPLIER' ? 'SUPPLIER' : 'USER_DEPARTMENT',
      requestedCompanyOrDept: acc.membership.supplierCompanyId || 'Procurement',
      status: acc.membership.status,
      decisionByUid: acc.membership.status === 'PENDING' ? null : 'admin_a',
      decisionReason: null,
      decidedAt: acc.membership.status === 'PENDING' ? null : now,
      createdAt: now,
      updatedAt: now,
    });
    await auth.setCustomUserClaims(acc.uid, {
      tenantId: acc.membership.tenantId,
      role: acc.membership.role,
      status: acc.membership.status,
      authzVersion: acc.membership.authzVersion,
    });
  }

  // 4) Two tenders (tnd_1 open for sup_alpha [sup_a1 assigned, sup_a2 NOT assigned] and sup_beta [sup_b1]; tnd_2 closed/other)
  const futureDeadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const pastDeadline = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

  const tender1: TenderRecord = {
    id: 'tnd_berlin_pm',
    tenantId,
    code: 'TND-2026-031',
    projectId: 'prj_berlin',
    name: 'Berlin PM Services Tender',
    type: 'PM Services',
    publicationState: 'PUBLISHED',
    deadlineAt: futureDeadline,
    timeZone: 'Europe/Berlin',
    requiredDocuments: 'Technical Proposal, Commercial Proposal',
    description: 'PM tender for Berlin Mitte Flagship',
    schedule: s1,
    scheduleSources: {
      rfpDistribution: 'INHERITED',
      rfiReceipt: 'INHERITED',
      rfiResponse: 'INHERITED',
      rfpReceipt: 'INHERITED',
      interview: 'INHERITED',
      ptcDistribution: 'INHERITED',
      ptcReceipt: 'INHERITED',
      supplierSelection: 'INHERITED',
    },
    invitedCompanyIds: ['sup_alpha', 'sup_beta'],
    receivedCompanyIds: [],
    receivedCompanyCount: 0,
    revision: 1,
    lastChangeReason: null,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
    createdByUid: 'admin_a',
  };

  const tender2: TenderRecord = {
    id: 'tnd_sydney_gc',
    tenantId,
    code: 'TND-2026-032',
    projectId: 'prj_sydney',
    name: 'Sydney Galleria GC Tender',
    type: 'GC / Construction',
    publicationState: 'PUBLISHED',
    deadlineAt: pastDeadline,
    timeZone: 'Australia/Sydney',
    requiredDocuments: 'Quotation, Schedule',
    description: 'Closed tender in Sydney',
    schedule: emptyProcurementSchedule(),
    scheduleSources: {
      rfpDistribution: 'INHERITED',
      rfiReceipt: 'INHERITED',
      rfiResponse: 'INHERITED',
      rfpReceipt: 'INHERITED',
      interview: 'INHERITED',
      ptcDistribution: 'INHERITED',
      ptcReceipt: 'INHERITED',
      supplierSelection: 'INHERITED',
    },
    invitedCompanyIds: ['sup_beta'],
    receivedCompanyIds: [],
    receivedCompanyCount: 0,
    revision: 1,
    lastChangeReason: null,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
    createdByUid: 'admin_a',
  };

  await db.doc(`tenants/${tenantId}/tenders/${tender1.id}`).set(tender1);
  await db.doc(`tenants/${tenantId}/tenders/${tender2.id}`).set(tender2);

  // Assign sup_a1 to tender1 (NOT sup_a2!) and sup_b1 to tender1 & tender2
  await db.doc(`tenants/${tenantId}/tenders/${tender1.id}/participants/sup_alpha`).set({
    companyId: 'sup_alpha',
    tenantId,
    tenderId: tender1.id,
    invitedAt: now,
    invitedByUid: 'admin_a',
    assignedUserIds: ['sup_a1'],
    hasSubmitted: false,
    latestVersionId: null,
    latestReceiptNumber: null,
    latestSubmittedAt: null,
  });
  await db.doc(`tenants/${tenantId}/tenders/${tender1.id}/participants/sup_beta`).set({
    companyId: 'sup_beta',
    tenantId,
    tenderId: tender1.id,
    invitedAt: now,
    invitedByUid: 'admin_a',
    assignedUserIds: ['sup_b1'],
    hasSubmitted: false,
    latestVersionId: null,
    latestReceiptNumber: null,
    latestSubmittedAt: null,
  });
  await db.doc(`tenants/${tenantId}/tenders/${tender2.id}/participants/sup_beta`).set({
    companyId: 'sup_beta',
    tenantId,
    tenderId: tender2.id,
    invitedAt: now,
    invitedByUid: 'admin_a',
    assignedUserIds: ['sup_b1'],
    hasSubmitted: false,
    latestVersionId: null,
    latestReceiptNumber: null,
    latestSubmittedAt: null,
  });

  // Supplier views + access docs
  for (const [tid, t, comp] of [
    [tender1.id, tender1, 'sup_alpha'],
    [tender1.id, tender1, 'sup_beta'],
    [tender2.id, tender2, 'sup_beta'],
  ] as const) {
    await db.doc(`tenants/${tenantId}/tenders/${tid}/supplierViews/${comp}`).set({
      tenderId: tid,
      tenantId,
      code: t.code,
      projectId: t.projectId,
      projectName: t.projectId === 'prj_berlin' ? 'Berlin Mitte Flagship' : 'Sydney Galleria',
      projectLocation: t.projectId === 'prj_berlin' ? 'Berlin, Germany' : 'Sydney, Australia',
      name: t.name,
      type: t.type,
      deadlineAt: t.deadlineAt,
      timeZone: t.timeZone,
      requiredDocuments: t.requiredDocuments,
      description: t.description,
      schedule: t.schedule,
      published: true,
      publishedAt: now,
      rfpFiles: [],
    });
  }

  await db.doc(`tenants/${tenantId}/tenders/${tender1.id}/access/sup_a1`).set({
    uid: 'sup_a1',
    tenantId,
    tenderId: tender1.id,
    companyId: 'sup_alpha',
    enabled: true,
    published: true,
    deadlineAt: Timestamp.fromDate(new Date(futureDeadline)),
    updatedAt: now,
  });
  await db.doc(`tenants/${tenantId}/tenders/${tender1.id}/access/sup_b1`).set({
    uid: 'sup_b1',
    tenantId,
    tenderId: tender1.id,
    companyId: 'sup_beta',
    enabled: true,
    published: true,
    deadlineAt: Timestamp.fromDate(new Date(futureDeadline)),
    updatedAt: now,
  });
  await db.doc(`tenants/${tenantId}/tenders/${tender2.id}/access/sup_b1`).set({
    uid: 'sup_b1',
    tenantId,
    tenderId: tender2.id,
    companyId: 'sup_beta',
    enabled: true,
    published: true,
    deadlineAt: Timestamp.fromDate(new Date(pastDeadline)),
    updatedAt: now,
  });

  // Cross-tenant isolation fixture in other-org
  await db.doc(`tenants/${otherTenantId}/settings/default`).set({
    ...DEFAULT_TENANT_SETTINGS,
    organizationName: 'Other Org',
    updatedAt: now,
    updatedByUid: 'admin_x',
  });
  await db.doc(`tenants/${otherTenantId}/projects/prj_other`).set({
    id: 'prj_other',
    tenantId: otherTenantId,
    code: 'OTH-001',
    name: 'Confidential Other Tenant Project',
    countryCode: 'US',
    countryName: 'United States',
    city: 'New York',
    type: 'Office',
    owner: 'Admin X',
    status: 'In Progress',
    timeZone: 'America/New_York',
    dateLocal: '2026-11-01',
    masterSchedule: emptyProcurementSchedule(),
    createdAt: now,
    updatedAt: now,
    createdByUid: 'admin_x',
  });

  // Today dashboard task
  const todayLocal = new Date().toISOString().slice(0, 10);
  await db.doc(`tenants/${tenantId}/tasks/task_1`).set({
    id: 'task_1',
    tenantId,
    title: 'Review Berlin PM tender invitation list',
    projectId: 'prj_berlin',
    dateLocal: todayLocal,
    priority: 'High',
    done: false,
    createdByUid: 'admin_a',
    updatedAt: now,
  });

  console.log('[OK] Emulator seed complete. Password for all test accounts:', defaultPass);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
