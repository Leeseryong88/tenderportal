import { describe, expect, it } from 'vitest';
import {
  computeScheduleSources,
  computeTenderStatus,
  emptyProcurementSchedule,
  normalizeMilestoneEntry,
  propagateProjectScheduleToTender,
} from '@/lib/domain/schedule';
import {
  resolveLocalDateTimeInZone,
  dateInTimeZone,
} from '@/lib/domain/timezone';
import {
  normalizeCountryInput,
  normalizeMarketInput,
  resolveSupplierCoverageForMarket,
  toSupplierDirectoryDTO,
} from '@/lib/domain/coverage';
import {
  isAllowedExtension,
  validateFileMagicBytes,
} from '@/lib/server/fileValidation';
import { registerRequestSchema } from '@/lib/validation/schemas';

describe('Procurement schedule & DST timezone domain logic', () => {
  it('clears dateLocal when status is NOT_APPLICABLE or UNSET (no reverting to PLANNED)', () => {
    const na = normalizeMilestoneEntry({ status: 'NOT_APPLICABLE', dateLocal: '2026-12-01' });
    expect(na).toEqual({ status: 'NOT_APPLICABLE', dateLocal: null });

    const unset = normalizeMilestoneEntry({ status: 'UNSET', dateLocal: '2026-12-01' });
    expect(unset).toEqual({ status: 'UNSET', dateLocal: null });

    const planned = normalizeMilestoneEntry({ status: 'PLANNED', dateLocal: '2026-12-01' });
    expect(planned).toEqual({ status: 'PLANNED', dateLocal: '2026-12-01' });
  });

  it('propagates project schedule only to INHERITED tender milestones while preserving OVERRIDE', () => {
    const projSched = emptyProcurementSchedule();
    projSched.rfpDistribution = { status: 'PLANNED', dateLocal: '2026-11-20' };
    projSched.rfiReceipt = { status: 'PLANNED', dateLocal: '2026-11-25' };

    const tenderSched = emptyProcurementSchedule();
    tenderSched.rfpDistribution = { status: 'PLANNED', dateLocal: '2026-11-20' };
    tenderSched.rfiReceipt = { status: 'NOT_APPLICABLE', dateLocal: null }; // overridden in tender

    const sources = computeScheduleSources(tenderSched, projSched);
    expect(sources.rfpDistribution).toBe('INHERITED');
    expect(sources.rfiReceipt).toBe('OVERRIDE');

    const nextProj = { ...projSched, rfpDistribution: { status: 'PLANNED' as const, dateLocal: '2026-11-22' }, rfiReceipt: { status: 'PLANNED' as const, dateLocal: '2026-11-27' } };
    const propagated = propagateProjectScheduleToTender(nextProj, tenderSched, sources);
    expect(propagated.schedule.rfpDistribution.dateLocal).toBe('2026-11-22');
    expect(propagated.schedule.rfiReceipt.status).toBe('NOT_APPLICABLE');
    expect(propagated.schedule.rfiReceipt.dateLocal).toBeNull();
  });

  it('detects spring-forward non-existent local times and fall-back ambiguous DST folds', () => {
    // America/New_York springs forward at 2026-03-08 02:00 -> 02:30 does not exist
    const nonExistent = resolveLocalDateTimeInZone('2026-03-08T02:30', 'America/New_York', 'reject');
    expect(nonExistent.ok).toBe(false);
    expect(nonExistent.errorCode).toBe('NON_EXISTENT_LOCAL_TIME');

    // America/New_York falls back at 2026-11-01 01:30 (occurs twice: EDT -04:00 and EST -05:00)
    const ambig = resolveLocalDateTimeInZone('2026-11-01T01:30', 'America/New_York', 'reject');
    expect(ambig.ok).toBe(false);
    expect(ambig.ambiguous).toBe(true);
    expect(ambig.candidates?.length).toBe(2);

    const earlier = resolveLocalDateTimeInZone('2026-11-01T01:30', 'America/New_York', 'earlier');
    const later = resolveLocalDateTimeInZone('2026-11-01T01:30', 'America/New_York', 'later');
    expect(earlier.ok).toBe(true);
    expect(later.ok).toBe(true);
    expect(Date.parse(later.utcIso!) - Date.parse(earlier.utcIso!)).toBe(3600_000);
  });

  it('computes calendar date differences between overseas tender timezone and Seoul display timezone', () => {
    // 2026-11-20 17:00 in America/New_York is 2026-11-21 07:00 in Asia/Seoul
    const res = resolveLocalDateTimeInZone('2026-11-20T17:00', 'America/New_York');
    expect(res.ok).toBe(true);
    expect(dateInTimeZone(res.utcIso!, 'America/New_York')).toBe('2026-11-20');
    expect(dateInTimeZone(res.utcIso!, 'Asia/Seoul')).toBe('2026-11-21');
  });

  it('derives tender status dynamically from server timestamp', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();

    expect(
      computeTenderStatus({ publicationState: 'DRAFT', deadlineAt: future, receivedCompanyCount: 0 })
    ).toBe('DRAFT');
    expect(
      computeTenderStatus({ publicationState: 'PUBLISHED', deadlineAt: future, receivedCompanyCount: 0 })
    ).toBe('OPEN');
    expect(
      computeTenderStatus({ publicationState: 'PUBLISHED', deadlineAt: future, receivedCompanyCount: 1 })
    ).toBe('RECEIVING');
    expect(
      computeTenderStatus({ publicationState: 'PUBLISHED', deadlineAt: past, receivedCompanyCount: 1 })
    ).toBe('CLOSED');
  });
});

describe('Supplier Pool normalization, specificity, and projection stripping', () => {
  it('standardizes Australia aliases and US states', () => {
    expect(normalizeCountryInput('Australia').countryCode).toBe('AU');
    expect(normalizeCountryInput('AUS').countryCode).toBe('AU');
    expect(normalizeCountryInput('호주').countryCode).toBe('AU');
    expect(normalizeCountryInput('오스트레일리아').countryCode).toBe('AU');

    const tx = normalizeMarketInput('Texas');
    expect(tx.countryCode).toBe('US');
    expect(tx.subdivisionCode).toBe('US-TX');
  });

  it('applies specificity rule: specific US state overrides country-wide US coverage, and country-wide US fills unspecified states', () => {
    const coverage = [
      { countryCode: 'US', subdivisionCode: null, cityName: null, displayName: 'United States', deliveryMode: 'LOCAL_PARTNER' as const },
      { countryCode: 'US', subdivisionCode: 'US-TX', cityName: null, displayName: 'Texas', deliveryMode: 'DIRECT' as const },
      { countryCode: 'US', subdivisionCode: 'US-MA', cityName: null, displayName: 'Massachusetts', deliveryMode: 'UNAVAILABLE' as const },
    ];

    expect(resolveSupplierCoverageForMarket(coverage, { subdivisionCode: 'US-TX' })?.deliveryMode).toBe('DIRECT');
    expect(resolveSupplierCoverageForMarket(coverage, { subdivisionCode: 'US-MA' })?.deliveryMode).toBe('UNAVAILABLE');
    expect(resolveSupplierCoverageForMarket(coverage, { subdivisionCode: 'US-NY' })?.deliveryMode).toBe('LOCAL_PARTNER');
  });

  it('strips internalNotes from SupplierDirectoryDTO for USER_DEPARTMENT', () => {
    const dto = toSupplierDirectoryDTO({
      id: 'sup1',
      tenantId: 'iicombined',
      name: 'Test Co',
      countryCode: 'AU',
      countryName: 'Australia',
      city: 'Sydney',
      categories: ['PM Services'],
      coverage: [],
      contacts: [],
      website: '',
      ndaStatus: 'Signed',
      ndaSignedDate: '2026-01-01',
      license: 'LIC-1',
      licenseStatus: 'Current',
      licenseExpiry: '2027-01-01',
      status: 'Active',
      internalNotes: 'CONFIDENTIAL MARGIN COMMENT',
      createdAt: '',
      updatedAt: '',
    });

    expect((dto as unknown as Record<string, unknown>).internalNotes).toBeUndefined();
  });
});

describe('Security validation & file content checks', () => {
  it('rejects mass assignment of role/approved/supplierCompanyId on signup schema', () => {
    const bad = registerRequestSchema.safeParse({
      displayName: 'Attacker',
      phone: '010-1234-5678',
      requestedRole: 'SUPPLIER',
      requestedCompanyOrDept: 'Fake Co',
      role: 'ADMIN',
      approved: true,
      supplierCompanyId: 'sup_alpha',
    });
    expect(bad.success).toBe(false);

    const adminRole = registerRequestSchema.safeParse({
      displayName: 'Attacker',
      phone: '010-1234-5678',
      requestedRole: 'ADMIN',
      requestedCompanyOrDept: 'Fake Co',
    });
    expect(adminRole.success).toBe(false);
  });

  it('blocks HTML/SVG masquerading and verifies magic bytes', () => {
    expect(isAllowedExtension('payload.svg', ['pdf', 'png'])).toBe(false);
    expect(isAllowedExtension('payload.html', ['pdf', 'png'])).toBe(false);
    expect(isAllowedExtension('quote.pdf', ['pdf', 'png'])).toBe(true);

    const fakePdf = Buffer.from('<html><script>alert(1)</script></html>', 'utf8');
    expect(validateFileMagicBytes('pdf', fakePdf).ok).toBe(false);

    const validPdf = Buffer.from('%PDF-1.7\n1 0 obj\n', 'utf8');
    expect(validateFileMagicBytes('pdf', validPdf).ok).toBe(true);
  });
});
