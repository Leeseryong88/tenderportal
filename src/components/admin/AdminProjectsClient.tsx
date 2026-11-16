'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/client/api';
import { emptyProcurementSchedule } from '@/lib/domain/schedule';
import { getSupportedTimeZones, timeZoneForLocation } from '@/lib/domain/timezone';
import { countryDisplayName } from '@/lib/domain/coverage';
import { countryOptions } from '@/lib/client/selectOptions';
import { PortalShell } from '@/components/layout/PortalShell';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { Modal } from '@/components/ui/Modal';
import { SearchableSelect, type SelectOption } from '@/components/ui/SearchableSelect';
import { StatusPill } from '@/components/ui/StatusPill';
import { ScheduleEditor } from '@/components/domain/ScheduleEditor';
import type { ProcurementSchedule, ProjectRecord, ProjectStatus } from '@/types/domain';

const CORE_PROJECT_TYPES = [
  'Department Store',
  'FS',
  'Maison',
  'Retail Store',
  'Building Construction',
  'Major Renovation',
  'Office',
  'Other',
];

export function AdminProjectsClient({
  displayName,
  email,
  organizationName,
}: {
  displayName: string;
  email: string;
  organizationName: string;
}) {
  const { lang, tr, trv, trError } = useLanguage();
  const { showToast } = useToast();

  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [countryFilter, setCountryFilter] = useState('ALL');
  const [editing, setEditing] = useState<ProjectRecord | null>(null);
  const [showModal, setShowModal] = useState(false);

  // Modal form state
  const [name, setName] = useState('');
  const [country, setCountry] = useState('South Korea');
  const [city, setCity] = useState('Seoul');
  const [type, setType] = useState('Maison');
  const [owner, setOwner] = useState(displayName);
  const [status, setStatus] = useState<ProjectStatus>('Planning');
  const [timeZone, setTimeZone] = useState('Asia/Seoul');
  const [schedule, setSchedule] = useState<ProcurementSchedule>(emptyProcurementSchedule());
  const [saving, setSaving] = useState(false);

  const loadProjects = useCallback(async () => {
    try {
      const res = await apiFetch<{ projects: ProjectRecord[] }>('/api/admin/projects');
      setProjects(res.projects);
    } catch (err) {
      showToast(trError(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, trError]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const openCreateModal = () => {
    setEditing(null);
    setName('');
    setCountry('South Korea');
    setCity('Seoul');
    setType('Maison');
    setOwner(displayName);
    setStatus('Planning');
    setTimeZone('Asia/Seoul');
    setSchedule(emptyProcurementSchedule());
    setShowModal(true);
  };

  const openEditModal = (p: ProjectRecord) => {
    setEditing(p);
    setName(p.name);
    setCountry(p.countryName);
    setCity(p.city);
    setType(p.type);
    setOwner(p.owner);
    setStatus(p.status);
    setTimeZone(p.timeZone || timeZoneForLocation(p.countryName, p.city));
    setSchedule(p.masterSchedule || emptyProcurementSchedule());
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await apiFetch(`/api/admin/projects/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name,
            country,
            city,
            type,
            owner,
            status,
            timeZone,
            masterSchedule: schedule,
          }),
        });
        showToast(tr('projects.updated'));
      } else {
        await apiFetch('/api/admin/projects', {
          method: 'POST',
          body: JSON.stringify({
            name,
            country,
            city,
            type,
            owner,
            status,
            timeZone,
            masterSchedule: schedule,
          }),
        });
        showToast(tr('projects.created'));
      }
      setShowModal(false);
      await loadProjects();
    } catch (err) {
      showToast(trError(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const availableCountries = useMemo<SelectOption[]>(() => {
    const map = new Map<string, SelectOption>();
    for (const p of projects) {
      if (p.countryCode) {
        map.set(p.countryCode, {
          value: p.countryCode,
          label: countryDisplayName(p.countryCode, p.countryName, lang),
          keywords: `${p.countryCode} ${p.countryName} ${countryDisplayName(p.countryCode, p.countryName, 'ko')}`,
        });
      }
    }
    return [...map.values()];
  }, [projects, lang]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((p) => {
      if (countryFilter !== 'ALL' && p.countryCode !== countryFilter) return false;
      if (!q) return true;
      const haystack = `${p.name} ${p.countryName} ${countryDisplayName(
        p.countryCode,
        p.countryName,
        'ko'
      )} ${p.city} ${p.owner} ${p.code} ${p.type}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [projects, search, countryFilter]);

  const typeOptions = useMemo<SelectOption[]>(() => {
    const types =
      editing && editing.type && !CORE_PROJECT_TYPES.includes(editing.type)
        ? [...CORE_PROJECT_TYPES, editing.type]
        : CORE_PROJECT_TYPES;
    return types.map((tOpt) => ({ value: tOpt, label: trv('projectType', tOpt), keywords: tOpt }));
  }, [editing, trv]);

  const allCountryOptions = useMemo(() => countryOptions(lang), [lang]);
  const timeZones = useMemo(() => getSupportedTimeZones(), []);

  return (
    <PortalShell
      role="ADMIN"
      displayName={displayName}
      email={email}
      organizationName={organizationName}
      crumbTitle={tr('nav.projects')}
    >
      <div className="heading">
        <div>
          <h1>{tr('projects.title')}</h1>
          <p>{tr('projects.sub')}</p>
        </div>
        <button
          type="button"
          className="btn primary"
          onClick={openCreateModal}
          data-testid="new-project-btn"
        >
          ＋ {tr('projects.new')}
        </button>
      </div>

      <div className="toolbar">
        <input
          className="search"
          placeholder={`⌕ ${tr('projects.searchPlaceholder')}`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="project-search"
        />
        <SearchableSelect
          className="filter"
          ariaLabel={tr('projects.country')}
          value={countryFilter}
          onChange={setCountryFilter}
          leadingOptions={[{ value: 'ALL', label: tr('projects.allCountries') }]}
          options={availableCountries}
          testId="project-country-filter"
        />
        <div className="grow" />
        <span className="subtle">{tr('projects.countUnit', { count: filtered.length })}</span>
      </div>

      <div className="card table-card">
        <div className="table-wrap">
          {loading ? (
            <div className="empty">{tr('common.loading')}</div>
          ) : filtered.length === 0 ? (
            <div className="empty">{tr('common.noResults')}</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{tr('projects.name')}</th>
                  <th>{tr('projects.country')} / {tr('projects.city')}</th>
                  <th>{tr('projects.type')}</th>
                  <th>{tr('projects.timeZone')}</th>
                  <th>{tr('projects.owner')}</th>
                  <th>{tr('projects.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <span className="primary-text">{p.name}</span>
                      <span className="secondary">
                        {p.code} · {p.dateLocal}
                      </span>
                    </td>
                    <td className="cell-wrap">
                      {[p.city, countryDisplayName(p.countryCode, p.countryName, lang)].filter(Boolean).join(', ')}
                    </td>
                    <td>{trv('projectType', p.type)}</td>
                    <td>
                      <span className="subtle">{p.timeZone}</span>
                    </td>
                    <td className="cell-wrap">{p.owner}</td>
                    <td>
                      <StatusPill status={p.status} />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => openEditModal(p)}
                      >
                        {tr('projects.edit')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showModal && (
        <Modal
          title={editing ? tr('projects.edit') : tr('projects.new')}
          subtitle={tr('projects.sub')}
          onClose={() => setShowModal(false)}
          maxWidth={740}
        >
          <form onSubmit={handleSave}>
            <div className="form-grid">
              <div className="field full">
                <label>{tr('projects.name')} *</label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  data-testid="project-name-input"
                />
              </div>

              <div className="field">
                <label>{tr('projects.country')} *</label>
                <SearchableSelect
                  ariaLabel={tr('projects.country')}
                  value={country}
                  onChange={(nextC) => {
                    setCountry(nextC);
                    setTimeZone(timeZoneForLocation(nextC, city));
                  }}
                  options={allCountryOptions}
                />
              </div>

              <div className="field">
                <label>{tr('projects.city')} *</label>
                <input
                  required
                  value={city}
                  onChange={(e) => {
                    const nextCity = e.target.value;
                    setCity(nextCity);
                    setTimeZone(timeZoneForLocation(country, nextCity));
                  }}
                />
              </div>

              <div className="field">
                <label>{tr('projects.type')}</label>
                <SearchableSelect
                  ariaLabel={tr('projects.type')}
                  value={type}
                  onChange={setType}
                  options={typeOptions}
                />
              </div>

              <div className="field">
                <label>{tr('projects.owner')} *</label>
                <input required value={owner} onChange={(e) => setOwner(e.target.value)} />
              </div>

              <div className="field">
                <label>{tr('projects.status')}</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ProjectStatus)}
                >
                  <option value="Planning">{trv('projectStatus', 'Planning')}</option>
                  <option value="In Progress">{trv('projectStatus', 'In Progress')}</option>
                  <option value="Completed">{trv('projectStatus', 'Completed')}</option>
                </select>
              </div>

              <div className="field">
                <label>{tr('projects.timeZone')} *</label>
                <input
                  list="project-tz-list"
                  required
                  value={timeZone}
                  onChange={(e) => setTimeZone(e.target.value)}
                />
                <datalist id="project-tz-list">
                  {timeZones.map((tz) => (
                    <option key={tz} value={tz} />
                  ))}
                </datalist>
              </div>

              <div className="field full">
                <ScheduleEditor
                  mode="project"
                  schedule={schedule}
                  onChange={setSchedule}
                />
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setShowModal(false)}
                disabled={saving}
              >
                {tr('common.cancel')}
              </button>
              <button type="submit" className="btn primary" disabled={saving} data-testid="project-save-btn">
                {saving ? tr('common.loading') : tr('common.save')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </PortalShell>
  );
}
