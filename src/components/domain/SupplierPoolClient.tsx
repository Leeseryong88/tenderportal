'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/client/api';
import {
  countryDisplayName,
  getCountryAlpha2List,
  getUsStateList,
  marketDisplayName,
  normalizeCoverageList,
  resolveSupplierCoverageForMarket,
} from '@/lib/domain/coverage';
import { PortalShell } from '@/components/layout/PortalShell';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { Modal } from '@/components/ui/Modal';
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
  const { lang, tr } = useLanguage();
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
      showToast(err instanceof Error ? err.message : 'Failed to load suppliers', 'error');
    } finally {
      setLoading(false);
    }
  }, [canManage, showToast]);

  useEffect(() => {
    void loadSuppliers();
  }, [loadSuppliers]);

  const allCountries = useMemo(() => getCountryAlpha2List(), []);
  const usStates = useMemo(() => getUsStateList(), []);

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

  const uniqueCoverageCountries = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of suppliers) {
      for (const c of s.coverage) {
        if (c.countryCode && c.countryCode !== 'UNMAPPED') {
          map.set(c.countryCode, countryDisplayName(c.countryCode, c.displayName, lang));
        }
      }
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
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
      showToast(err instanceof Error ? err.message : 'Failed to save supplier', 'error');
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
          {lang === 'ko'
            ? '사용자부서는 승인된 협력사 Pool 디렉터리(업체 정보·유형·수행 지역·담당자·면허·NDA 체결상태)만 열람할 수 있습니다.'
            : 'User Department accounts have read-only access to approved Supplier Pool directory fields only.'}
        </div>
      )}

      <div className="pool-dashboard-grid">
        <aside className="card pool-filters">
          <div className="panel-title" style={{ marginBottom: 13 }}>
            {tr('suppliers.filters')}
          </div>

          <div className="field">
            <label>{tr('suppliers.serviceCoverage')}</label>
            <select
              value={fCountry}
              onChange={(e) => {
                setFCountry(e.target.value);
                setFSubdivision('ALL');
              }}
              data-testid="pool-country-filter"
            >
              <option value="ALL">{tr('common.all')}</option>
              {uniqueCoverageCountries.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>U.S. State</label>
            <select
              value={fSubdivision}
              onChange={(e) => {
                const v = e.target.value;
                setFSubdivision(v);
                if (v !== 'ALL') setFCountry('US');
              }}
            >
              <option value="ALL">{tr('common.all')}</option>
              {usStates.map((st) => (
                <option key={st.code} value={st.code}>
                  {lang === 'ko' ? `${st.ko} (${st.abbr})` : `${st.en} (${st.abbr})`}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>{tr('projects.type')}</label>
            <select value={fCategory} onChange={(e) => setFCategory(e.target.value)}>
              <option value="ALL">{tr('common.all')}</option>
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Company</label>
            <select value={fVendor} onChange={(e) => setFVendor(e.target.value)}>
              <option value="ALL">{tr('common.all')}</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Delivery Mode</label>
            <select value={fDelivery} onChange={(e) => setFDelivery(e.target.value)}>
              <option value="ALL">{tr('common.all')}</option>
              <option value="DIRECT">{tr('suppliers.delivery.DIRECT')}</option>
              <option value="LOCAL_PARTNER">{tr('suppliers.delivery.LOCAL_PARTNER')}</option>
              <option value="UNAVAILABLE">{tr('suppliers.delivery.UNAVAILABLE')}</option>
            </select>
          </div>

          <div className="field">
            <label>License</label>
            <select value={fLicense} onChange={(e) => setFLicense(e.target.value)}>
              <option value="ALL">{tr('common.all')}</option>
              {['Current', 'Renewal Planned', 'Renewal Pending', 'Not Required', 'Not Tracked'].map(
                (x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                )
              )}
            </select>
          </div>

          <div className="field">
            <label>{tr('suppliers.ndaStatus')}</label>
            <select value={fNda} onChange={(e) => setFNda(e.target.value)}>
              <option value="ALL">{tr('common.all')}</option>
              {['Not Checked', 'Not Signed', 'Signed', 'Not Required'].map((x) => (
                <option key={x} value={x}>
                  {x}
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
              <span className="subtle">filtered</span>
            </div>
            <div className="card pool-kpi">
              <label>{tr('suppliers.countriesCovered')}</label>
              <strong>{uniqueHqCountries}</strong>
              <span className="subtle">HQ countries</span>
            </div>
            <div className="card pool-kpi">
              <label>{tr('suppliers.directCoverage')}</label>
              <strong>{directVendors}</strong>
              <span className="subtle">Direct</span>
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
                    World view
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
                setFCountry(code);
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
                value={searchField}
                onChange={(e) => setSearchField(e.target.value as typeof searchField)}
              >
                <option value="name">Company</option>
                <option value="country">HQ Country</option>
                <option value="type">Type</option>
                <option value="coverage">Coverage</option>
                <option value="availability">Delivery Mode</option>
                <option value="license">License</option>
                <option value="nda">NDA</option>
                <option value="status">Status</option>
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
                      <th>COMPANY</th>
                      <th>HQ</th>
                      <th>TYPE</th>
                      <th>COVERAGE</th>
                      <th>LICENSE</th>
                      <th>NDA</th>
                      <th>STATUS</th>
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
                                {s.contacts[0]?.name || '—'} · {s.contacts[0]?.email || ''}
                              </span>
                            </span>
                          </span>
                        </td>
                        <td>{countryDisplayName(s.countryCode, s.countryName, lang)}</td>
                        <td>
                          {s.categories.map((cat) => (
                            <span key={cat} className="pill" style={{ marginRight: 4 }}>
                              {cat}
                            </span>
                          ))}
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
                        <td>
                          {s.license || s.licenseStatus}
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
              <span>Website</span>
              <b>{detailSupplier.website || '—'}</b>
            </div>
            <div className="detail-row">
              <span>License</span>
              <b>
                {detailSupplier.license || detailSupplier.licenseStatus}{' '}
                {detailSupplier.licenseExpiry ? `(${detailSupplier.licenseExpiry})` : ''}
              </b>
            </div>
          </div>

          <div className="detail-box">
            <b style={{ fontSize: 12 }}>{tr('suppliers.serviceCoverage')}</b>
            {detailSupplier.coverage.map((c, idx) => (
              <div key={idx} className="detail-row">
                <span>
                  {marketDisplayName(c, lang)}
                  {c.legacyValue && (
                    <small className="secondary">Unmapped legacy: {c.legacyValue}</small>
                  )}
                </span>
                <StatusPill status={c.deliveryMode} />
              </div>
            ))}
          </div>

          <div className="detail-box">
            <b style={{ fontSize: 12 }}>{tr('suppliers.contacts')}</b>
            {detailSupplier.contacts.length === 0 ? (
              <div className="subtle" style={{ paddingTop: 6 }}>
                No contacts recorded.
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
                <label>Company name *</label>
                <input required value={sName} onChange={(e) => setSName(e.target.value)} />
              </div>

              <div className="field">
                <label>Head office country *</label>
                <select value={sCountry} onChange={(e) => setSCountry(e.target.value)}>
                  {allCountries.map((c) => (
                    <option key={c.code} value={c.en}>
                      {lang === 'ko' ? c.ko : c.en}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>Head office city</label>
                <input value={sCity} onChange={(e) => setSCity(e.target.value)} />
              </div>

              <div className="field full">
                <label>Company type *</label>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {CATEGORY_OPTIONS.map((cat) => (
                    <label
                      key={cat}
                      style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}
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
                      {cat}
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
                  {['Not Checked', 'Not Signed', 'Signed', 'Not Required'].map((x) => (
                    <option key={x} value={x}>
                      {x}
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
                <label>Website</label>
                <input
                  type="url"
                  value={sWebsite}
                  onChange={(e) => setSWebsite(e.target.value)}
                />
              </div>

              <div className="field">
                <label>Status</label>
                <select
                  value={sStatus}
                  onChange={(e) => setSStatus(e.target.value as CompanyStatus)}
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
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
                    <select
                      value={row.market}
                      onChange={(e) => {
                        const val = e.target.value;
                        setPreviewFocusIdx(idx);
                        setSCoverage((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, market: val } : r))
                        );
                      }}
                    >
                      <optgroup label="Countries">
                        {allCountries.map((c) => (
                          <option key={c.code} value={c.en}>
                            {lang === 'ko' ? c.ko : c.en}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="U.S. States">
                        {usStates.map((st) => (
                          <option key={st.code} value={st.code}>
                            {lang === 'ko' ? `${st.ko} (${st.abbr})` : `${st.en} (${st.abbr})`}
                          </option>
                        ))}
                      </optgroup>
                    </select>
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
                  <b style={{ fontSize: 11 }}>{tr('suppliers.coveragePreview')}</b>
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
                    <select
                      value={c.country}
                      onChange={(e) =>
                        setSContacts((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, country: e.target.value } : r))
                        )
                      }
                    >
                      {allCountries.map((ct) => (
                        <option key={ct.code} value={ct.en}>
                          {lang === 'ko' ? ct.ko : ct.en}
                        </option>
                      ))}
                    </select>
                    <input
                      placeholder="City"
                      value={c.city}
                      onChange={(e) =>
                        setSContacts((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, city: e.target.value } : r))
                        )
                      }
                    />
                    <input
                      placeholder="Name"
                      value={c.name}
                      onChange={(e) =>
                        setSContacts((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, name: e.target.value } : r))
                        )
                      }
                    />
                    <input
                      type="email"
                      placeholder="Email"
                      value={c.email}
                      onChange={(e) =>
                        setSContacts((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, email: e.target.value } : r))
                        )
                      }
                    />
                    <input
                      placeholder="Phone"
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
                <label>License No.</label>
                <input value={sLicense} onChange={(e) => setSLicense(e.target.value)} />
              </div>

              <div className="field">
                <label>License status</label>
                <select
                  value={sLicenseStatus}
                  onChange={(e) => setSLicenseStatus(e.target.value as LicenseStatus)}
                >
                  {['Current', 'Renewal Planned', 'Renewal Pending', 'Not Required', 'Not Tracked'].map(
                    (x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    )
                  )}
                </select>
              </div>

              <div className="field">
                <label>License expiry</label>
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
