'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/client/api';
import {
  countryDisplayName,
  marketDisplayName,
  normalizeCoverageList,
  resolveSupplierCoverageForMarket,
} from '@/lib/domain/coverage';
import { countryOptions, usStateOptions } from '@/lib/client/selectOptions';
import { PortalShell } from '@/components/layout/PortalShell';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { Modal } from '@/components/ui/Modal';
import { SearchableSelect, type SelectOption } from '@/components/ui/SearchableSelect';
import { StatusPill } from '@/components/ui/StatusPill';
import { SupplierCoverageMap } from '@/components/maps/SupplierCoverageMap';
import type {
  CompanyStatus,
  DeliveryMode,
  LicenseStatus,
  NdaStatus,
  Role,
  SupplierDirectoryDTO,
  SupplierRecord,
} from '@/types/domain';

const CATEGORY_OPTIONS = [
  'PM Services',
  'AOR / Architect Services',
  'GC / Construction',
  'Material Procurement',
  'Other Services',
];

const LICENSE_OPTIONS: LicenseStatus[] = [
  'Current',
  'Renewal Planned',
  'Renewal Pending',
  'Not Required',
  'Not Tracked',
];

const NDA_OPTIONS: NdaStatus[] = ['Not Checked', 'Not Signed', 'Signed', 'Not Required'];

function safeWebsiteHref(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

type SupplierPoolItem = SupplierRecord | SupplierDirectoryDTO;

export function SupplierPoolClient({
  role,
  displayName,
  email,
  organizationName,
}: {
  role: Role;
  displayName: string;
  email: string;
  organizationName: string;
}) {
  const { lang, tr, trv, trError } = useLanguage();
  const { showToast } = useToast();
  const canManage = role === 'ADMIN';

  const [suppliers, setSuppliers] = useState<SupplierPoolItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [fCountry, setFCountry] = useState('ALL');
  const [fCategory, setFCategory] = useState('ALL');
  const [fVendor, setFVendor] = useState('ALL');
  const [fSubdivision, setFSubdivision] = useState('ALL');
  const [fDelivery, setFDelivery] = useState('ALL');
  const [fLicense, setFLicense] = useState('ALL');
  const [fNda, setFNda] = useState('ALL');

  const [searchField, setSearchField] = useState<
    'name' | 'country' | 'type' | 'coverage' | 'availability' | 'license' | 'nda' | 'status'
  >('name');
  const [searchQuery, setSearchQuery] = useState('');

  // Detail & Edit modals
  const [detailSupplier, setDetailSupplier] = useState<SupplierPoolItem | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [editing, setEditing] = useState<SupplierPoolItem | null>(null);

  // Form state
  const [sName, setSName] = useState('');
  const [sCountry, setSCountry] = useState('South Korea');
  const [sCity, setSCity] = useState('');
  const [sCategories, setSCategories] = useState<string[]>(['PM Services']);
  const [sNdaStatus, setSNdaStatus] = useState<NdaStatus>('Not Checked');
  const [sNdaDate, setSNdaDate] = useState('');
  const [sWebsite, setSWebsite] = useState('');
  const [sStatus, setSStatus] = useState<CompanyStatus>('Active');
  const [sLicense, setSLicense] = useState('');
  const [sLicenseStatus, setSLicenseStatus] = useState<LicenseStatus>('Not Required');
  const [sLicenseExpiry, setSLicenseExpiry] = useState('');
  const [sContacts, setSContacts] = useState<
    Array<{ country: string; city: string; name: string; email: string; phone: string }>
  >([]);
  const [sCoverage, setSCoverage] = useState<
    Array<{ market: string; deliveryMode: DeliveryMode }>
  >([]);
  const [previewFocusIdx, setPreviewFocusIdx] = useState(0);
  const [saving, setSaving] = useState(false);

  const loadSuppliers = useCallback(async () => {
    try {
      const endpoint = canManage ? '/api/admin/suppliers' : '/api/department/suppliers';
      const res = await apiFetch<{ suppliers: SupplierPoolItem[] }>(endpoint);
      setSuppliers(res.suppliers);
    } catch (err) {
      showToast(trError(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [canManage, showToast, trError]);

  useEffect(() => {
    void loadSuppliers();
  }, [loadSuppliers]);

  const allOption = useMemo<SelectOption[]>(() => [{ value: 'ALL', label: tr('common.all') }], [tr]);
  const hqCountryOptions = useMemo(() => countryOptions(lang), [lang]);
  const stateOptions = useMemo(() => usStateOptions(lang), [lang]);
  const marketOptions = useMemo(
    () => [
      ...countryOptions(lang, tr('suppliers.countries')),
      ...usStateOptions(lang, tr('suppliers.usStates')),
    ],
    [lang, tr]
  );
  const categoryOptions = useMemo<SelectOption[]>(
    () => CATEGORY_OPTIONS.map((c) => ({ value: c, label: trv('category', c), keywords: c })),
    [trv]
  );
  const vendorOptions = useMemo<SelectOption[]>(
    () => suppliers.map((s) => ({ value: s.id, label: s.name })),
    [suppliers]
  );

  // Filter logic (separates HQ country field from coverage country/subdivision filter)
  const mapBaseSuppliers = useMemo(() => {
    return suppliers.filter((s) => {
      if (fCategory !== 'ALL' && !s.categories.includes(fCategory)) return false;
      if (fVendor !== 'ALL' && s.id !== fVendor) return false;
      if (fLicense !== 'ALL' && s.licenseStatus !== fLicense) return false;
      if (fNda !== 'ALL' && s.ndaStatus !== fNda) return false;
      return true;
    });
  }, [suppliers, fCategory, fVendor, fLicense, fNda]);

  const filteredSuppliers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return mapBaseSuppliers.filter((s) => {
      if (fCountry !== 'ALL') {
        const hit = resolveSupplierCoverageForMarket(s.coverage, { countryCode: fCountry });
        if (!hit) return false;
      }
      if (fSubdivision !== 'ALL') {
        const hit = resolveSupplierCoverageForMarket(s.coverage, {
          subdivisionCode: fSubdivision,
        });
        if (!hit) return false;
      }
      if (fDelivery !== 'ALL') {
        if (!s.coverage.some((c) => c.deliveryMode === fDelivery)) return false;
      }

      if (!q) return true;
      if (searchField === 'name') return s.name.toLowerCase().includes(q);
      if (searchField === 'country') {
        return `${s.countryName} ${countryDisplayName(s.countryCode, s.countryName, 'ko')} ${s.countryCode}`
          .toLowerCase()
          .includes(q);
      }
      if (searchField === 'type') return s.categories.join(' ').toLowerCase().includes(q);
      if (searchField === 'coverage') {
        return s.coverage
          .map(
            (c) =>
              `${c.displayName} ${c.countryCode} ${c.subdivisionCode || ''} ${marketDisplayName(
                c,
                'ko'
              )}`
          )
          .join(' ')
          .toLowerCase()
          .includes(q);
      }
      if (searchField === 'availability') {
        return s.coverage
          .map((c) => `${c.deliveryMode} ${tr(`suppliers.delivery.${c.deliveryMode}`)}`)
          .join(' ')
          .toLowerCase()
          .includes(q);
      }
      if (searchField === 'license') {
        return `${s.license} ${s.licenseStatus}`.toLowerCase().includes(q);
      }
      if (searchField === 'nda') return s.ndaStatus.toLowerCase().includes(q);
      if (searchField === 'status') return s.status.toLowerCase().includes(q);
      return true;
    });
  }, [mapBaseSuppliers, fCountry, fSubdivision, fDelivery, searchField, searchQuery, tr]);

  const coverageCountryOptions = useMemo<SelectOption[]>(() => {
    const map = new Map<string, string>();
    for (const s of suppliers) {
      for (const c of s.coverage) {
        if (c.countryCode && c.countryCode !== 'UNMAPPED') {
          map.set(c.countryCode, countryDisplayName(c.countryCode, c.displayName, lang));
        }
      }
    }
    return [...map.entries()].map(([code, label]) => ({
      value: code,
      label,
      keywords: `${code} ${countryDisplayName(code, label, 'en')} ${countryDisplayName(code, label, 'ko')}`,
    }));
  }, [suppliers, lang]);

  const uniqueHqCountries = useMemo(
    () => new Set(filteredSuppliers.map((s) => s.countryCode)).size,
    [filteredSuppliers]
  );

  const directVendors = useMemo(
    () =>
      filteredSuppliers.filter((s) => s.coverage.some((c) => c.deliveryMode === 'DIRECT')).length,
    [filteredSuppliers]
  );

  const renewalWatch = useMemo(() => {
    const threshold = Date.now() + 90 * 86_400_000;
    return filteredSuppliers.filter(
      (s) => s.licenseExpiry && Date.parse(s.licenseExpiry) <= threshold
    ).length;
  }, [filteredSuppliers]);

  const openCreateModal = () => {
    setEditing(null);
    setSName('');
    setSCountry('South Korea');
    setSCity('');
    setSCategories(['PM Services']);
    setSNdaStatus('Not Checked');
    setSNdaDate('');
    setSWebsite('');
    setSStatus('Active');
    setSLicense('');
    setSLicenseStatus('Not Required');
    setSLicenseExpiry('');
    setSContacts([{ country: 'South Korea', city: '', name: '', email: '', phone: '' }]);
    setSCoverage([{ market: 'South Korea', deliveryMode: 'DIRECT' }]);
    setPreviewFocusIdx(0);
    setShowEditor(true);
  };

  const openEditModal = (s: SupplierPoolItem) => {
    setEditing(s);
    setSName(s.name);
    setSCountry(s.countryName);
    setSCity(s.city);
    setSCategories([...s.categories]);
    setSNdaStatus(s.ndaStatus);
    setSNdaDate(s.ndaSignedDate || '');
    setSWebsite(s.website || '');
    setSStatus(s.status);
    setSLicense(s.license || '');
    setSLicenseStatus(s.licenseStatus);
    setSLicenseExpiry(s.licenseExpiry || '');
    setSContacts(
      s.contacts.length
        ? s.contacts.map((c) => ({
            country: c.countryName,
            city: c.city,
            name: c.name,
            email: c.email,
            phone: c.phone,
          }))
        : [{ country: s.countryName, city: s.city, name: '', email: '', phone: '' }]
    );
    setSCoverage(
      s.coverage.map((c) => ({
        market: c.subdivisionCode || c.displayName,
        deliveryMode: c.deliveryMode,
      }))
    );
    setPreviewFocusIdx(0);
    setShowEditor(true);
  };

  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    setSaving(true);
    try {
      const payload = {
        name: sName,
        country: sCountry,
        city: sCity,
        categories: sCategories,
        ndaStatus: sNdaStatus,
        ndaSignedDate: sNdaDate,
        contacts: sContacts,
        website: sWebsite,
        status: sStatus,
        coverage: sCoverage,
        license: sLicense,
        licenseStatus: sLicenseStatus,
        licenseExpiry: sLicenseExpiry,
      };
      if (editing) {
        await apiFetch(`/api/admin/suppliers/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        showToast(lang === 'ko' ? '협력사 정보를 수정했습니다.' : 'Supplier updated.');
      } else {
        await apiFetch('/api/admin/suppliers', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast(lang === 'ko' ? '협력사를 등록했습니다.' : 'Supplier added to pool.');
      }
      setShowEditor(false);
      await loadSuppliers();
    } catch (err) {
      showToast(trError(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const previewCoverage = useMemo(
    () => normalizeCoverageList(sCoverage),
    [sCoverage]
  );

  const previewFocusedItem = previewCoverage[previewFocusIdx] ?? previewCoverage[0];
  const previewFocusCountry = previewFocusedItem?.countryCode || 'ALL';
  const previewFocusSub = previewFocusedItem?.subdivisionCode || 'ALL';

  return (
    <PortalShell
      role={role}
      displayName={displayName}
      email={email}
      organizationName={organizationName}
      crumbTitle={tr('nav.suppliers')}
    >
      <div className="heading">
        <div>
          <h1>{tr('suppliers.title')}</h1>
          <p>{tr('suppliers.sub')}</p>
        </div>
        {canManage && (
          <button
            type="button"
            className="btn primary"
            onClick={openCreateModal}
            data-testid="add-supplier-btn"
          >
            ＋ {tr('suppliers.add')}
          </button>
        )}
      </div>

      {!canManage && (
        <div className="notice">
          {tr('suppliers.deptNotice')}
        </div>
      )}

      <div className="pool-dashboard-grid">
        <aside className="card pool-filters">
          <div className="panel-title" style={{ marginBottom: 13 }}>
            {tr('suppliers.filters')}
          </div>

          <div className="field">
            <label>{tr('suppliers.serviceCoverage')}</label>
            <SearchableSelect
              ariaLabel={tr('suppliers.serviceCoverage')}
              value={fCountry}
              onChange={(v) => {
                setFCountry(v);
                setFSubdivision('ALL');
              }}
              leadingOptions={allOption}
              options={coverageCountryOptions}
              testId="pool-country-filter"
            />
          </div>

          <div className="field">
            <label>{tr('suppliers.usState')}</label>
            <SearchableSelect
              ariaLabel={tr('suppliers.usState')}
              value={fSubdivision}
              onChange={(v) => {
                setFSubdivision(v);
                if (v !== 'ALL') setFCountry('US');
              }}
              leadingOptions={allOption}
              options={stateOptions}
            />
          </div>

          <div className="field">
            <label>{tr('projects.type')}</label>
            <SearchableSelect
              ariaLabel={tr('projects.type')}
              value={fCategory}
              onChange={setFCategory}
              leadingOptions={allOption}
              options={categoryOptions}
            />
          </div>

          <div className="field">
            <label>{tr('suppliers.company')}</label>
            <SearchableSelect
              ariaLabel={tr('suppliers.company')}
              value={fVendor}
              onChange={setFVendor}
              leadingOptions={allOption}
              options={vendorOptions}
            />
          </div>

          <div className="field">
            <label>{tr('suppliers.deliveryMode')}</label>
            <select value={fDelivery} onChange={(e) => setFDelivery(e.target.value)}>
              <option value="ALL">{tr('common.all')}</option>
              <option value="DIRECT">{tr('suppliers.delivery.DIRECT')}</option>
              <option value="LOCAL_PARTNER">{tr('suppliers.delivery.LOCAL_PARTNER')}</option>
              <option value="UNAVAILABLE">{tr('suppliers.delivery.UNAVAILABLE')}</option>
            </select>
          </div>

          <div className="field">
            <label>{tr('suppliers.licenseStatus')}</label>
            <select value={fLicense} onChange={(e) => setFLicense(e.target.value)}>
              <option value="ALL">{tr('common.all')}</option>
              {LICENSE_OPTIONS.map((x) => (
                <option key={x} value={x}>
                  {trv('license', x)}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>{tr('suppliers.ndaStatus')}</label>
            <select value={fNda} onChange={(e) => setFNda(e.target.value)}>
              <option value="ALL">{tr('common.all')}</option>
              {NDA_OPTIONS.map((x) => (
                <option key={x} value={x}>
                  {trv('nda', x)}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            className="btn"
            style={{ width: '100%' }}
            onClick={() => {
              setFCountry('ALL');
              setFCategory('ALL');
              setFVendor('ALL');
              setFSubdivision('ALL');
              setFDelivery('ALL');
              setFLicense('ALL');
              setFNda('ALL');
              setSearchQuery('');
            }}
          >
            ↻ {tr('suppliers.resetFilters')}
          </button>
        </aside>

        <div className="pool-overview">
          <section className="pool-kpis">
            <div className="card pool-kpi">
              <label>{tr('suppliers.vendorsInView')}</label>
              <strong>{filteredSuppliers.length}</strong>
              <span className="subtle">{tr('suppliers.filteredSub')}</span>
            </div>
            <div className="card pool-kpi">
              <label>{tr('suppliers.countriesCovered')}</label>
              <strong>{uniqueHqCountries}</strong>
              <span className="subtle">{tr('suppliers.hqCountriesSub')}</span>
            </div>
            <div className="card pool-kpi">
              <label>{tr('suppliers.directCoverage')}</label>
              <strong>{directVendors}</strong>
              <span className="subtle">{tr('suppliers.directSub')}</span>
            </div>
            <div className="card pool-kpi">
              <label>{tr('suppliers.renewalWatch')}</label>
              <strong>{renewalWatch}</strong>
              <span className="subtle">{tr('suppliers.within90Days')}</span>
            </div>
          </section>

          <section className="coverage-map-card">
            <div className="panel-head" style={{ padding: 0, marginBottom: 4 }}>
              <div className="panel-title">
                {fCountry === 'US' || fSubdivision.startsWith('US-')
                  ? tr('suppliers.usMapTitle')
                  : tr('suppliers.globalMapTitle')}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {(fCountry !== 'ALL' || fSubdivision !== 'ALL') && (
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => {
                      setFCountry('ALL');
                      setFSubdivision('ALL');
                    }}
                  >
                    {tr('common.worldView')}
                  </button>
                )}
              </div>
            </div>
            <div className="panel-sub" style={{ padding: '2px 0 12px' }}>
              {tr('suppliers.mapSub')}
            </div>

            <SupplierCoverageMap
              suppliers={mapBaseSuppliers}
              selectedCountryCode={fCountry}
              selectedSubdivisionCode={fSubdivision}
              onSelectCountry={(code) => {
                setFCountry((prev) => (prev === code ? 'ALL' : code));
                setFSubdivision('ALL');
              }}
              onSelectSubdivision={(sub) => {
                setFCountry('US');
                setFSubdivision((prev) => (prev === sub ? 'ALL' : sub));
              }}
            />
          </section>

          <section className="card pool-table-card">
            <div className="panel-head" style={{ padding: '11px 3px 10px' }}>
              <div className="panel-title">{tr('suppliers.directory')}</div>
              <span className="subtle">{filteredSuppliers.length}</span>
            </div>

            <div className="pool-directory-search">
              <select
                className="filter"
                aria-label={tr('suppliers.searchField')}
                value={searchField}
                onChange={(e) => setSearchField(e.target.value as typeof searchField)}
              >
                <option value="name">{tr('suppliers.company')}</option>
                <option value="country">{tr('suppliers.hqCountry')}</option>
                <option value="type">{tr('suppliers.companyType')}</option>
                <option value="coverage">{tr('suppliers.serviceCoverage')}</option>
                <option value="availability">{tr('suppliers.deliveryMode')}</option>
                <option value="license">{tr('suppliers.license')}</option>
                <option value="nda">{tr('suppliers.ndaStatus')}</option>
                <option value="status">{tr('suppliers.companyStatus')}</option>
              </select>
              <input
                className="search"
                placeholder={`⌕ ${tr('suppliers.searchPlaceholder')}`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                data-testid="pool-search-input"
              />
            </div>

            <div className="table-wrap">
              {loading ? (
                <div className="empty">{tr('common.loading')}</div>
              ) : filteredSuppliers.length === 0 ? (
                <div className="empty">{tr('common.noResults')}</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>{tr('suppliers.company')}</th>
                      <th>{tr('suppliers.hqCountry')}</th>
                      <th>{tr('suppliers.companyType')}</th>
                      <th>{tr('suppliers.serviceCoverage')}</th>
                      <th>{tr('suppliers.license')}</th>
                      <th>NDA</th>
                      <th>{tr('common.status')}</th>
                      {canManage && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSuppliers.map((s) => (
                      <tr key={s.id} onClick={() => setDetailSupplier(s)}>
                        <td>
                          <span className="pool-record-title">
                            <span className="company-mark">
                              {s.name.slice(0, 1).toUpperCase()}
                            </span>
                            <span>
                              <span className="primary-text">{s.name}</span>
                              <span className="secondary">
                                {[s.contacts[0]?.name, s.contacts[0]?.email].filter(Boolean).join(' · ') ||
                                  '—'}
                              </span>
                            </span>
                          </span>
                        </td>
                        <td>{countryDisplayName(s.countryCode, s.countryName, lang)}</td>
                        <td>
                          <div className="coverage-cell">
                            {s.categories.map((cat) => (
                              <span key={cat} className="pill">
                                {trv('category', cat)}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td>
                          <div className="coverage-cell">
                            {s.coverage.slice(0, 3).map((c) => (
                              <span
                                key={`${c.countryCode}-${c.subdivisionCode}-${c.displayName}`}
                                className={`coverage-tag ${
                                  c.deliveryMode === 'LOCAL_PARTNER'
                                    ? 'local'
                                    : c.deliveryMode === 'UNAVAILABLE'
                                      ? 'none'
                                      : ''
                                }`}
                              >
                                {marketDisplayName(c, lang)}
                              </span>
                            ))}
                            {s.coverage.length > 3 && (
                              <span className="pill">+{s.coverage.length - 3}</span>
                            )}
                          </div>
                        </td>
                        <td className="cell-wrap">
                          {s.license || trv('license', s.licenseStatus)}
                          {s.licenseExpiry && (
                            <span className="secondary">{s.licenseExpiry}</span>
                          )}
                        </td>
                        <td>
                          <StatusPill status={s.ndaStatus} />
                        </td>
                        <td>
                          <StatusPill status={s.status} />
                        </td>
                        {canManage && (
                          <td>
                            <button
                              type="button"
                              className="btn small"
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditModal(s);
                              }}
                            >
                              {tr('suppliers.edit')}
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* Supplier Detail Modal (Role-filtered: NO tender history / notes for USER_DEPARTMENT) */}
      {detailSupplier && (
        <Modal
          title={detailSupplier.name}
          subtitle={`${detailSupplier.city ? `${detailSupplier.city}, ` : ''}${countryDisplayName(
            detailSupplier.countryCode,
            detailSupplier.countryName,
            lang
          )}`}
          onClose={() => setDetailSupplier(null)}
          maxWidth={680}
        >
          <div className="detail-box">
            <div className="detail-row">
              <span>{tr('suppliers.ndaStatus')}</span>
              <StatusPill status={detailSupplier.ndaStatus} />
            </div>
            <div className="detail-row">
              <span>{tr('suppliers.ndaSignedDate')}</span>
              <b>{detailSupplier.ndaSignedDate || '—'}</b>
            </div>
            <div className="detail-row">
              <span>{tr('suppliers.website')}</span>
              <b>
                {(() => {
                  const href = safeWebsiteHref(detailSupplier.website || '');
                  return href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--green)' }}>
                      {detailSupplier.website}
                    </a>
                  ) : (
                    detailSupplier.website || '—'
                  );
                })()}
              </b>
            </div>
            <div className="detail-row">
              <span>{tr('suppliers.license')}</span>
              <b>
                {detailSupplier.license || '—'} · {trv('license', detailSupplier.licenseStatus)}
                {detailSupplier.licenseExpiry ? ` (${detailSupplier.licenseExpiry})` : ''}
              </b>
            </div>
          </div>

          <div className="detail-box">
            <b style={{ fontSize: 13 }}>{tr('suppliers.serviceCoverage')}</b>
            {detailSupplier.coverage.map((c, idx) => (
              <div key={idx} className="detail-row">
                <span>
                  {marketDisplayName(c, lang)}
                  {c.legacyValue && (
                    <small className="secondary">
                      {tr('suppliers.legacyUnmapped')}: {c.legacyValue}
                    </small>
                  )}
                </span>
                <StatusPill status={c.deliveryMode} />
              </div>
            ))}
          </div>

          <div className="detail-box">
            <b style={{ fontSize: 13 }}>{tr('suppliers.contacts')}</b>
            {detailSupplier.contacts.length === 0 ? (
              <div className="subtle" style={{ paddingTop: 6 }}>
                {tr('suppliers.noContacts')}
              </div>
            ) : (
              detailSupplier.contacts.map((c, idx) => (
                <div key={idx} className="detail-row">
                  <span>
                    <b>{c.name || '—'}</b> ({c.city ? `${c.city}, ` : ''}
                    {countryDisplayName(c.countryCode, c.countryName, lang)})
                  </span>
                  <span>
                    {c.email || '—'} · {c.phone || '—'}
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="modal-actions">
            {canManage && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const target = detailSupplier;
                  setDetailSupplier(null);
                  openEditModal(target);
                }}
              >
                {tr('suppliers.edit')}
              </button>
            )}
            <button
              type="button"
              className="btn primary"
              onClick={() => setDetailSupplier(null)}
            >
              {tr('common.close')}
            </button>
          </div>
        </Modal>
      )}

      {/* Admin Add / Edit Supplier Modal */}
      {showEditor && canManage && (
        <Modal
          title={editing ? tr('suppliers.edit') : tr('suppliers.add')}
          subtitle={tr('suppliers.sub')}
          onClose={() => setShowEditor(false)}
          maxWidth={780}
        >
          <form onSubmit={handleSaveSupplier}>
            <div className="form-grid">
              <div className="field full">
                <label>{tr('suppliers.companyName')} *</label>
                <input required value={sName} onChange={(e) => setSName(e.target.value)} />
              </div>

              <div className="field">
                <label>{tr('suppliers.hqCountry')} *</label>
                <SearchableSelect
                  ariaLabel={tr('suppliers.hqCountry')}
                  value={sCountry}
                  onChange={setSCountry}
                  options={hqCountryOptions}
                />
              </div>

              <div className="field">
                <label>{tr('suppliers.hqCity')}</label>
                <input value={sCity} onChange={(e) => setSCity(e.target.value)} />
              </div>

              <div className="field full">
                <label>{tr('suppliers.companyType')} *</label>
                <div style={{ display: 'flex', gap: '8px 14px', flexWrap: 'wrap' }}>
                  {CATEGORY_OPTIONS.map((cat) => (
                    <label
                      key={cat}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500 }}
                    >
                      <input
                        type="checkbox"
                        checked={sCategories.includes(cat)}
                        onChange={() =>
                          setSCategories((prev) =>
                            prev.includes(cat)
                              ? prev.length > 1
                                ? prev.filter((x) => x !== cat)
                                : prev
                              : [...prev, cat]
                          )
                        }
                      />
                      {trv('category', cat)}
                    </label>
                  ))}
                </div>
              </div>

              <div className="field">
                <label>{tr('suppliers.ndaStatus')}</label>
                <select
                  value={sNdaStatus}
                  onChange={(e) => setSNdaStatus(e.target.value as NdaStatus)}
                >
                  {NDA_OPTIONS.map((x) => (
                    <option key={x} value={x}>
                      {trv('nda', x)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>{tr('suppliers.ndaSignedDate')}</label>
                <input
                  type="date"
                  value={sNdaDate}
                  onChange={(e) => setSNdaDate(e.target.value)}
                />
              </div>

              <div className="field">
                <label>{tr('suppliers.website')}</label>
                <input
                  type="url"
                  placeholder="https://"
                  value={sWebsite}
                  onChange={(e) => setSWebsite(e.target.value)}
                />
              </div>

              <div className="field">
                <label>{tr('suppliers.companyStatus')}</label>
                <select
                  value={sStatus}
                  onChange={(e) => setSStatus(e.target.value as CompanyStatus)}
                >
                  <option value="Active">{trv('companyStatus', 'Active')}</option>
                  <option value="Inactive">{trv('companyStatus', 'Inactive')}</option>
                </select>
              </div>

              <div className="field full">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label>{tr('suppliers.serviceCoverage')} *</label>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => {
                      setSCoverage((prev) => {
                        setPreviewFocusIdx(prev.length);
                        return [...prev, { market: 'South Korea', deliveryMode: 'DIRECT' }];
                      });
                    }}
                  >
                    ＋ {tr('suppliers.addCoverage')}
                  </button>
                </div>

                {sCoverage.map((row, idx) => (
                  <div key={idx} className="coverage-editor-row">
                    <SearchableSelect
                      ariaLabel={tr('suppliers.serviceCoverage')}
                      value={row.market}
                      onChange={(val) => {
                        setPreviewFocusIdx(idx);
                        setSCoverage((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, market: val } : r))
                        );
                      }}
                      options={marketOptions}
                    />
                    <select
                      value={row.deliveryMode}
                      onChange={(e) => {
                        const val = e.target.value as DeliveryMode;
                        setSCoverage((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, deliveryMode: val } : r))
                        );
                      }}
                    >
                      <option value="DIRECT">{tr('suppliers.delivery.DIRECT')}</option>
                      <option value="LOCAL_PARTNER">{tr('suppliers.delivery.LOCAL_PARTNER')}</option>
                      <option value="UNAVAILABLE">{tr('suppliers.delivery.UNAVAILABLE')}</option>
                    </select>
                    <button
                      type="button"
                      className="btn small danger"
                      onClick={() =>
                        setSCoverage((prev) =>
                          prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}

                <div style={{ marginTop: 10 }}>
                  <b style={{ fontSize: 13 }}>{tr('suppliers.coveragePreview')}</b>
                  <SupplierCoverageMap
                    compact
                    suppliers={[{ id: 'preview', coverage: previewCoverage }]}
                    selectedCountryCode={previewFocusCountry}
                    selectedSubdivisionCode={previewFocusSub}
                  />
                </div>
              </div>

              <div className="field full" style={{ overflowX: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label>{tr('suppliers.contacts')}</label>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() =>
                      setSContacts((prev) => [
                        ...prev,
                        { country: sCountry, city: '', name: '', email: '', phone: '' },
                      ])
                    }
                  >
                    ＋ {tr('suppliers.addContact')}
                  </button>
                </div>
                {sContacts.map((c, idx) => (
                  <div key={idx} className="supplier-contact-row">
                    <SearchableSelect
                      ariaLabel={tr('common.country')}
                      value={c.country}
                      onChange={(val) =>
                        setSContacts((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, country: val } : r))
                        )
                      }
                      options={hqCountryOptions}
                    />
                    <input
                      placeholder={tr('common.city')}
                      aria-label={tr('common.city')}
                      value={c.city}
                      onChange={(e) =>
                        setSContacts((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, city: e.target.value } : r))
                        )
                      }
                    />
                    <input
                      placeholder={tr('common.name')}
                      aria-label={tr('common.name')}
                      value={c.name}
                      onChange={(e) =>
                        setSContacts((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, name: e.target.value } : r))
                        )
                      }
                    />
                    <input
                      type="email"
                      placeholder={tr('common.email')}
                      aria-label={tr('common.email')}
                      value={c.email}
                      onChange={(e) =>
                        setSContacts((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, email: e.target.value } : r))
                        )
                      }
                    />
                    <input
                      placeholder={tr('common.phone')}
                      aria-label={tr('common.phone')}
                      value={c.phone}
                      onChange={(e) =>
                        setSContacts((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, phone: e.target.value } : r))
                        )
                      }
                    />
                    <button
                      type="button"
                      className="btn small danger"
                      onClick={() =>
                        setSContacts((prev) => prev.filter((_, i) => i !== idx))
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              <div className="field">
                <label>{tr('suppliers.licenseNo')}</label>
                <input value={sLicense} onChange={(e) => setSLicense(e.target.value)} />
              </div>

              <div className="field">
                <label>{tr('suppliers.licenseStatus')}</label>
                <select
                  value={sLicenseStatus}
                  onChange={(e) => setSLicenseStatus(e.target.value as LicenseStatus)}
                >
                  {LICENSE_OPTIONS.map((x) => (
                    <option key={x} value={x}>
                      {trv('license', x)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>{tr('suppliers.licenseExpiry')}</label>
                <input
                  type="date"
                  value={sLicenseExpiry}
                  onChange={(e) => setSLicenseExpiry(e.target.value)}
                />
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setShowEditor(false)}
                disabled={saving}
              >
                {tr('common.cancel')}
              </button>
              <button type="submit" className="btn primary" disabled={saving}>
                {saving ? tr('common.loading') : tr('common.save')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </PortalShell>
  );
}
