'use client';

import React from 'react';
import { TENDER_MILESTONES } from '@/lib/domain/schedule';
import { useLanguage } from '@/components/providers/LanguageProvider';
import type {
  MilestoneKey,
  MilestoneStatus,
  ProcurementSchedule,
  ScheduleSourceMap,
} from '@/types/domain';
import type { I18nKey } from '@/i18n/en';

export function ScheduleEditor({
  schedule,
  onChange,
  projectSchedule,
  scheduleSources,
  onChangeSources,
  mode,
}: {
  schedule: ProcurementSchedule;
  onChange: (next: ProcurementSchedule) => void;
  projectSchedule?: ProcurementSchedule | null;
  scheduleSources?: ScheduleSourceMap;
  onChangeSources?: (next: ScheduleSourceMap) => void;
  mode: 'project' | 'tender';
}) {
  const { tr } = useLanguage();

  const handleDateChange = (key: MilestoneKey, dateValue: string) => {
    const nextEntry = dateValue
      ? { dateLocal: dateValue, status: 'PLANNED' as const }
      : { dateLocal: null, status: 'UNSET' as const };
    const nextSchedule = { ...schedule, [key]: nextEntry };
    onChange(nextSchedule);

    if (mode === 'tender' && scheduleSources && onChangeSources && projectSchedule) {
      const base = projectSchedule[key];
      const isSame = base.status === nextEntry.status && base.dateLocal === nextEntry.dateLocal;
      onChangeSources({
        ...scheduleSources,
        [key]: isSame ? 'INHERITED' : 'OVERRIDE',
      });
    }
  };

  const handleStatusChange = (key: MilestoneKey, nextStatus: MilestoneStatus) => {
    const current = schedule[key];
    // CRITICAL: Selecting UNSET or NOT_APPLICABLE clears dateLocal to null immediately
    const nextEntry =
      nextStatus === 'PLANNED'
        ? { dateLocal: current.dateLocal, status: 'PLANNED' as const }
        : { dateLocal: null, status: nextStatus };

    const nextSchedule = { ...schedule, [key]: nextEntry };
    onChange(nextSchedule);

    if (mode === 'tender' && scheduleSources && onChangeSources && projectSchedule) {
      const base = projectSchedule[key];
      const isSame = base.status === nextEntry.status && base.dateLocal === nextEntry.dateLocal;
      onChangeSources({
        ...scheduleSources,
        [key]: isSame ? 'INHERITED' : 'OVERRIDE',
      });
    }
  };

  const handleRestoreInherited = (key: MilestoneKey) => {
    if (!projectSchedule || !scheduleSources || !onChangeSources) return;
    onChange({
      ...schedule,
      [key]: { ...projectSchedule[key] },
    });
    onChangeSources({
      ...scheduleSources,
      [key]: 'INHERITED',
    });
  };

  return (
    <div className="timeline-editor">
      <div className="timeline-editor-head">
        <b>{mode === 'project' ? tr('projects.schedule') : tr('tenders.schedule')}</b>
        <span>{mode === 'project' ? tr('projects.scheduleHelp') : tr('tenders.scheduleHelp')}</span>
      </div>

      <div className="schedule-fields">
        {TENDER_MILESTONES.map((stage) => {
          const entry = schedule[stage.key] || { dateLocal: null, status: 'UNSET' };
          const source = scheduleSources?.[stage.key];
          const isOverride = mode === 'tender' && source === 'OVERRIDE';

          return (
            <div key={stage.key} className="schedule-row">
              <div className="schedule-row-head">
                <label>{tr(stage.labelKey as I18nKey)}</label>
                {mode === 'tender' && projectSchedule && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span
                      className={`pill ${isOverride ? 'amber' : 'green'}`}
                      style={{ padding: '2px 6px', fontSize: 9 }}
                    >
                      {isOverride ? tr('tenders.override') : tr('tenders.inherited')}
                    </span>
                    {isOverride && (
                      <button
                        type="button"
                        className="btn small"
                        style={{ padding: '2px 6px', fontSize: 9 }}
                        onClick={() => handleRestoreInherited(stage.key)}
                      >
                        {tr('tenders.restoreInherited')}
                      </button>
                    )}
                  </div>
                )}
              </div>

              <input
                type="date"
                aria-label={`${tr(stage.labelKey as I18nKey)} date`}
                value={entry.status === 'PLANNED' && entry.dateLocal ? entry.dateLocal : ''}
                onChange={(e) => handleDateChange(stage.key, e.target.value)}
              />
              <select
                aria-label={`${tr(stage.labelKey as I18nKey)} status`}
                value={entry.status}
                onChange={(e) => handleStatusChange(stage.key, e.target.value as MilestoneStatus)}
              >
                <option value="UNSET">{tr('milestone.status.UNSET')}</option>
                <option value="NOT_APPLICABLE">{tr('milestone.status.NOT_APPLICABLE')}</option>
                <option value="PLANNED">{tr('milestone.status.PLANNED')}</option>
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
