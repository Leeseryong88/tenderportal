import type {
  MilestoneEntry,
  MilestoneKey,
  ProcurementSchedule,
  ScheduleSourceMap,
  TenderComputedStatus,
  TenderRecord,
} from '@/types/domain';

export const TENDER_MILESTONES: Array<{ key: MilestoneKey; labelKey: string }> = [
  { key: 'rfpDistribution', labelKey: 'milestone.rfpDistribution' },
  { key: 'rfiReceipt', labelKey: 'milestone.rfiReceipt' },
  { key: 'rfiResponse', labelKey: 'milestone.rfiResponse' },
  { key: 'rfpReceipt', labelKey: 'milestone.rfpReceipt' },
  { key: 'interview', labelKey: 'milestone.interview' },
  { key: 'ptcDistribution', labelKey: 'milestone.ptcDistribution' },
  { key: 'ptcReceipt', labelKey: 'milestone.ptcReceipt' },
  { key: 'supplierSelection', labelKey: 'milestone.supplierSelection' },
];

export function emptyProcurementSchedule(): ProcurementSchedule {
  return {
    rfpDistribution: { dateLocal: null, status: 'UNSET' },
    rfiReceipt: { dateLocal: null, status: 'UNSET' },
    rfiResponse: { dateLocal: null, status: 'UNSET' },
    rfpReceipt: { dateLocal: null, status: 'UNSET' },
    interview: { dateLocal: null, status: 'UNSET' },
    ptcDistribution: { dateLocal: null, status: 'UNSET' },
    ptcReceipt: { dateLocal: null, status: 'UNSET' },
    supplierSelection: { dateLocal: null, status: 'UNSET' },
  };
}

export function defaultInheritedSources(): ScheduleSourceMap {
  return {
    rfpDistribution: 'INHERITED',
    rfiReceipt: 'INHERITED',
    rfiResponse: 'INHERITED',
    rfpReceipt: 'INHERITED',
    interview: 'INHERITED',
    ptcDistribution: 'INHERITED',
    ptcReceipt: 'INHERITED',
    supplierSelection: 'INHERITED',
  };
}

export function normalizeMilestoneEntry(entry?: Partial<MilestoneEntry> | null): MilestoneEntry {
  const status = entry?.status;
  const dateLocal = typeof entry?.dateLocal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.dateLocal)
    ? entry.dateLocal
    : null;

  // CRITICAL: Explicitly preserve NOT_APPLICABLE and UNSET with dateLocal=null
  // so stale dates never revert a stage back to PLANNED.
  if (status === 'NOT_APPLICABLE') {
    return { dateLocal: null, status: 'NOT_APPLICABLE' };
  }
  if (status === 'UNSET') {
    return { dateLocal: null, status: 'UNSET' };
  }
  if (status === 'PLANNED') {
    return dateLocal ? { dateLocal, status: 'PLANNED' } : { dateLocal: null, status: 'UNSET' };
  }
  return dateLocal ? { dateLocal, status: 'PLANNED' } : { dateLocal: null, status: 'UNSET' };
}

export function normalizeSchedule(
  src?: Partial<Record<MilestoneKey, Partial<MilestoneEntry>>> | null
): ProcurementSchedule {
  const out = emptyProcurementSchedule();
  for (const { key } of TENDER_MILESTONES) {
    out[key] = normalizeMilestoneEntry(src?.[key]);
  }
  return out;
}

export function computeScheduleSources(
  tenderSchedule: ProcurementSchedule,
  projectSchedule: ProcurementSchedule
): ScheduleSourceMap {
  const sources = defaultInheritedSources();
  for (const { key } of TENDER_MILESTONES) {
    const t = normalizeMilestoneEntry(tenderSchedule[key]);
    const p = normalizeMilestoneEntry(projectSchedule[key]);
    if (t.status !== p.status || t.dateLocal !== p.dateLocal) {
      sources[key] = 'OVERRIDE';
    } else {
      sources[key] = 'INHERITED';
    }
  }
  return sources;
}

export function propagateProjectScheduleToTender(
  projectSchedule: ProcurementSchedule,
  tenderSchedule: ProcurementSchedule,
  tenderSources: ScheduleSourceMap
): { schedule: ProcurementSchedule; scheduleSources: ScheduleSourceMap } {
  const nextSchedule = normalizeSchedule(tenderSchedule);
  const nextSources: ScheduleSourceMap = { ...tenderSources };
  for (const { key } of TENDER_MILESTONES) {
    if (nextSources[key] !== 'OVERRIDE') {
      nextSchedule[key] = { ...normalizeMilestoneEntry(projectSchedule[key]) };
      nextSources[key] = 'INHERITED';
    }
  }
  return { schedule: nextSchedule, scheduleSources: nextSources };
}

export function computeTenderStatus(
  tender: Pick<TenderRecord, 'publicationState' | 'deadlineAt' | 'receivedCompanyCount'>,
  nowMs: number = Date.now()
): TenderComputedStatus {
  if (tender.publicationState === 'DRAFT') {
    return 'DRAFT';
  }
  if (tender.deadlineAt) {
    const dueMs = Date.parse(tender.deadlineAt);
    if (Number.isFinite(dueMs) && nowMs >= dueMs) {
      return 'CLOSED';
    }
  }
  if ((tender.receivedCompanyCount ?? 0) > 0) {
    return 'RECEIVING';
  }
  return 'OPEN';
}
