'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ref, uploadBytesResumable } from 'firebase/storage';
import { getAuthenticatedStorage, stagingPathUid } from '@/lib/firebase/client';
import { apiFetch } from '@/lib/client/api';
import {
  computeScheduleSources,
  defaultInheritedSources,
  emptyProcurementSchedule,
  TENDER_MILESTONES,
} from '@/lib/domain/schedule';
import {
  formatDateTimeInZone,
  getSupportedTimeZones,
  resolveLocalDateTimeInZone,
  timeZoneForLocation,
  timeZoneOffsetLabel,
  utcToLocalDateTimeInput,
  type DstDisambiguation,
} from '@/lib/domain/timezone';
import { marketDisplayName } from '@/lib/domain/coverage';
import { PortalShell } from '@/components/layout/PortalShell';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DownloadButton } from '@/components/ui/DownloadButton';
import { Modal } from '@/components/ui/Modal';
import { SearchableSelect, type SelectOption } from '@/components/ui/SearchableSelect';
import { StatusPill } from '@/components/ui/StatusPill';
import { compareLabels, matchesSearch } from '@/lib/text/collate';
import { ScheduleEditor } from '@/components/domain/ScheduleEditor';
import type {
  ProcurementSchedule,
  ProjectRecord,
  ScheduleSourceMap,
  StoredFileRecord,
  SubmissionVersionRecord,
  SupplierRecord,
  TenderAdminDTO,
  TenderParticipantRecord,
} from '@/types/domain';
import type { I18nKey } from '@/i18n/en';

type TenderListRow = TenderAdminDTO & {
  participants: TenderParticipantRecord[];
  rfpFiles: StoredFileRecord[];
  submissionFilesByCompany: Record<string, StoredFileRecord[]>;
};

interface TenderDetailPayload {
  tender: TenderAdminDTO & { projectSchedule: ProcurementSchedule | null };
  participants: TenderParticipantRecord[];
  files: StoredFileRecord[];
  submissionsByCompany: Record<string, SubmissionVersionRecord[]>;
  approvedSupplierUsers: Array<{ uid: string; email: string; supplierCompanyId: string }>;
}

interface InvitationRecord {
  tokenHash: string;
  companyId: string;
  normalizedEmail: string;
  expiresAt: string;
  createdAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
}

const TENDER_TYPES = [
  'PM Services',
  'AOR / Architect Services',
  'GC / Construction',
  'Material Procurement',
  'Other Services',
];

function supplierTypeCode(s: SupplierRecord): string {
  const cats = s.categories.join(' ');
  if (/PM|Project Management/i.test(cats)) return '[PM]';
  if (/AOR|Architect/i.test(cats)) return '[AOR]';
  if (/GC|Construction/i.test(cats)) return '[GC]';
  if (/Material|Procurement/i.test(cats)) return '[MAT]';
  return '[Other]';
}

export function AdminTendersClient({
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

  const [tab, setTab] = useState<'list' | 'submissions'>('list');
  const [tenders, setTenders] = useState<TenderListRow[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Create / Edit modal state
  const [showEditor, setShowEditor] = useState(false);
  const [editingTender, setEditingTender] = useState<TenderListRow | null>(null);
  const [confirmedSubWarn, setConfirmedSubWarn] = useState(false);
  const [warnTarget, setWarnTarget] = useState<TenderListRow | null>(null);

  const [fName, setFName] = useState('');
  const [fProjectId, setFProjectId] = useState('');
  const [fType, setFType] = useState(TENDER_TYPES[0]);
  const [fDeadlineLocal, setFDeadlineLocal] = useState('');
  const [fTimeZone, setFTimeZone] = useState('Asia/Seoul');
  const [fDstChoice, setFDstChoice] = useState<DstDisambiguation>('reject');
  const [fSchedule, setFSchedule] = useState<ProcurementSchedule>(emptyProcurementSchedule());
  const [fSources, setFSources] = useState<ScheduleSourceMap>(defaultInheritedSources());
  const [fBidders, setFBidders] = useState<string[]>([]);
  const [bidderSearch, setBidderSearch] = useState('');
  const [fRequired, setFRequired] = useState('Technical Proposal, Commercial Proposal');
  const [fDesc, setFDesc] = useState('');
  const [fChangeReason, setFChangeReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);

  // Detail modal state
  const [detailData, setDetailData] = useState<TenderDetailPayload | null>(null);
  const [detailInvites, setDetailInvites] = useState<InvitationRecord[]>([]);
  const [rfpProgress, setRfpProgress] = useState<number | null>(null);
  const [inviteEmailByCompany, setInviteEmailByCompany] = useState<Record<string, string>>({});
  const [generatedLink, setGeneratedLink] = useState<string>('');
  const [submissionModal, setSubmissionModal] = useState<{
    tender: TenderListRow;
    companyId: string;
    versions: SubmissionVersionRecord[];
  } | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [tRes, pRes, sRes] = await Promise.all([
        apiFetch<{ tenders: TenderListRow[] }>('/api/admin/tenders'),
        apiFetch<{ projects: ProjectRecord[] }>('/api/admin/projects'),
        apiFetch<{ suppliers: SupplierRecord[] }>('/api/admin/suppliers'),
      ]);
      setTenders(tRes.tenders);
      setProjects(pRes.projects);
      setSuppliers(sRes.suppliers);
    } catch (err) {
      showToast(trError(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, trError]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const supplierMap = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const timeZones = useMemo(() => getSupportedTimeZones(), []);
  const projectOptions = useMemo<SelectOption[]>(
    () => projects.map((p) => ({ value: p.id, label: p.name, keywords: `${p.code} ${p.city}` })),
    [projects]
  );
  const typeOptions = useMemo<SelectOption[]>(
    () => TENDER_TYPES.map((opt) => ({ value: opt, label: trv('category', opt), keywords: opt })),
    [trv]
  );
  const sortedBidders = useMemo(() => {
    const compare = compareLabels(lang);
    return [...suppliers].sort((a, b) => compare(a.name, b.name));
  }, [suppliers, lang]);

  const dstResolution = useMemo(() => {
    if (!fDeadlineLocal || !fTimeZone) return null;
    return resolveLocalDateTimeInZone(fDeadlineLocal, fTimeZone, fDstChoice);
  }, [fDeadlineLocal, fTimeZone, fDstChoice]);

  const openCreateModal = () => {
    if (!projects.length || !suppliers.length) {
      showToast(tr('tenders.needProjectSupplier'), 'error');
      return;
    }
    const firstProj = projects[0];
    setEditingTender(null);
    setConfirmedSubWarn(false);
    setFName('');
    setFProjectId(firstProj.id);
    setFType(TENDER_TYPES[0]);
    setFDeadlineLocal('');
    setFTimeZone(firstProj.timeZone || timeZoneForLocation(firstProj.countryName, firstProj.city));
    setFDstChoice('reject');
    setFSchedule(firstProj.masterSchedule || emptyProcurementSchedule());
    setFSources(defaultInheritedSources());
    setFBidders([]);
    setBidderSearch('');
    setFRequired('Technical Proposal, Commercial Proposal');
    setFDesc('');
    setFChangeReason('');
    setFormError('');
    setShowEditor(true);
  };

  const openEditDirectly = (t: TenderListRow, withSubWarnConfirmed: boolean) => {
    setEditingTender(t);
    setConfirmedSubWarn(withSubWarnConfirmed);
    setFName(t.name);
    setFProjectId(t.projectId);
    setFType(t.type);
    setFTimeZone(t.timeZone || 'Asia/Seoul');
    setFDeadlineLocal(t.deadlineAt ? utcToLocalDateTimeInput(t.deadlineAt, t.timeZone) : '');
    setFDstChoice('reject');
    setFSchedule(t.schedule || emptyProcurementSchedule());
    setFSources(t.scheduleSources || defaultInheritedSources());
    setFBidders([...t.invitedCompanyIds]);
    setBidderSearch('');
    setFRequired(t.requiredDocuments);
    setFDesc(t.description);
    setFChangeReason('');
    setFormError('');
    setShowEditor(true);
  };

  const requestEditTender = (t: TenderListRow) => {
    if (t.receivedCompanyCount > 0) {
      setWarnTarget(t);
      return;
    }
    openEditDirectly(t, false);
  };

  const handleProjectChange = (pid: string) => {
    setFProjectId(pid);
    const p = projectMap.get(pid);
    if (!p) return;
    setFTimeZone(p.timeZone || timeZoneForLocation(p.countryName, p.city));
    if (!editingTender) {
      setFSchedule(p.masterSchedule || emptyProcurementSchedule());
      setFSources(defaultInheritedSources());
    } else {
      setFSources(computeScheduleSources(fSchedule, p.masterSchedule));
    }
  };

  const validateTenderForm = (action: 'SAVE_DRAFT' | 'PUBLISH' | 'SAVE_PUBLISHED'): string => {
    if (!fName.trim()) return tr('tenders.needName');
    if (action === 'SAVE_DRAFT') return '';
    if (fBidders.length === 0) return tr('tenders.needBidders');
    if (!fDeadlineLocal) return tr('tenders.needDeadline');
    if (dstResolution && !dstResolution.ok) {
      if (dstResolution.errorCode === 'NON_EXISTENT_LOCAL_TIME') return tr('tenders.dstGap');
      if (dstResolution.ambiguous) return tr('tenders.dstAmbiguous');
    }
    if (dstResolution?.ok && dstResolution.utcIso && Date.parse(dstResolution.utcIso) <= Date.now()) {
      return tr('tenders.needFutureDeadline');
    }
    return '';
  };

  const submitTenderForm = async (action: 'SAVE_DRAFT' | 'PUBLISH' | 'SAVE_PUBLISHED') => {
    const problem = validateTenderForm(action);
    setFormError(problem);
    if (problem) return;
    setSaving(true);
    try {
      const payload = {
        name: fName,
        projectId: fProjectId,
        type: fType,
        action,
        deadlineLocal: fDeadlineLocal,
        timeZone: fTimeZone,
        dstDisambiguation: fDstChoice,
        schedule: fSchedule,
        invitedCompanyIds: fBidders,
        requiredDocuments: fRequired,
        description: fDesc,
        changeReason: fChangeReason || undefined,
        confirmedSubmissionWarning: confirmedSubWarn,
      };

      if (editingTender) {
        await apiFetch(`/api/admin/tenders/${editingTender.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        showToast(action === 'SAVE_DRAFT' ? tr('tenders.savedDraft') : tr('tenders.savedChanges'));
      } else {
        await apiFetch('/api/admin/tenders', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast(action === 'SAVE_DRAFT' ? tr('tenders.savedDraft') : tr('tenders.savedPublished'));
      }
      setShowEditor(false);
      await loadAll();
    } catch (err) {
      const message = trError(err);
      setFormError(message);
      showToast(message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const openDetailModal = async (tenderId: string) => {
    try {
      setGeneratedLink('');
      const [detail, invRes] = await Promise.all([
        apiFetch<TenderDetailPayload>(`/api/admin/tenders/${tenderId}`),
        apiFetch<{ invitations: InvitationRecord[] }>(`/api/admin/tenders/${tenderId}/invitations`),
      ]);
      setDetailData(detail);
      setDetailInvites(invRes.invitations);
    } catch (err) {
      showToast(trError(err), 'error');
    }
  };

  const openSubmissionsModal = async (t: TenderListRow, companyId: string) => {
    try {
      const detail = await apiFetch<TenderDetailPayload>(`/api/admin/tenders/${t.id}`);
      setSubmissionModal({
        tender: t,
        companyId,
        versions: detail.submissionsByCompany[companyId] || [],
      });
    } catch (err) {
      showToast(trError(err), 'error');
    }
  };

  const handleRfpUpload = async (files: File[]) => {
    if (!files.length || !detailData) return;
    const tenderId = detailData.tender.id;
    const intentIds: string[] = [];

    try {
      for (const file of files) {
        const intent = await apiFetch<{
          intentId: string;
          fileId: string;
          stagingPath: string;
        }>(`/api/admin/tenders/${tenderId}/rfp-intents`, {
          method: 'POST',
          body: JSON.stringify({
            originalName: file.name,
            contentType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
          }),
        });

        const storage = await getAuthenticatedStorage(stagingPathUid(intent.stagingPath));
        await new Promise<void>((resolve, reject) => {
          const task = uploadBytesResumable(ref(storage, intent.stagingPath), file);
          task.on(
            'state_changed',
            (snap) => {
              setRfpProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
            },
            reject,
            () => resolve()
          );
        });

        intentIds.push(intent.intentId);
      }

      await apiFetch(`/api/admin/tenders/${tenderId}/rfp-finalize`, {
        method: 'POST',
        body: JSON.stringify({ intentIds, publishedToSuppliers: true }),
      });

      setRfpProgress(null);
      showToast(tr('tenders.rfpUploaded'));
      await openDetailModal(tenderId);
      await loadAll();
    } catch (err) {
      setRfpProgress(null);
      showToast(trError(err), 'error');
    }
  };

  const handleToggleRfpVisibility = async (file: StoredFileRecord) => {
    if (!detailData) return;
    try {
      await apiFetch(`/api/admin/tenders/${detailData.tender.id}/files/${file.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ publishedToSuppliers: !file.publishedToSuppliers }),
      });
      await openDetailModal(detailData.tender.id);
    } catch (err) {
      showToast(trError(err), 'error');
    }
  };

  const handleAssignUserToggle = async (
    companyId: string,
    currentAssigned: string[],
    uid: string
  ) => {
    if (!detailData) return;
    const next = currentAssigned.includes(uid)
      ? currentAssigned.filter((x) => x !== uid)
      : [...currentAssigned, uid];
    try {
      await apiFetch(`/api/admin/tenders/${detailData.tender.id}/assign-users`, {
        method: 'POST',
        body: JSON.stringify({ companyId, assignedUserIds: next }),
      });
      await openDetailModal(detailData.tender.id);
      showToast(tr('tenders.assignUpdated'));
    } catch (err) {
      showToast(trError(err), 'error');
    }
  };

  const handleCreateInvite = async (companyId: string) => {
    if (!detailData) return;
    const targetEmail = (inviteEmailByCompany[companyId] || '').trim();
    if (!targetEmail) {
      showToast(tr('tenders.needInviteEmail'), 'error');
      return;
    }
    try {
      const res = await apiFetch<{ inviteUrl: string }>(
        `/api/admin/tenders/${detailData.tender.id}/invitations`,
        {
          method: 'POST',
          body: JSON.stringify({ companyId, targetEmail }),
        }
      );
      setGeneratedLink(res.inviteUrl);
      await navigator.clipboard?.writeText(res.inviteUrl).catch(() => {});
      setInviteEmailByCompany((prev) => ({ ...prev, [companyId]: '' }));
      showToast(tr('tenders.inviteCreated'));
      await openDetailModal(detailData.tender.id);
    } catch (err) {
      showToast(trError(err), 'error');
    }
  };

  const handleRevokeInvite = async (tokenHash: string) => {
    if (!detailData) return;
    try {
      await apiFetch(
        `/api/admin/tenders/${detailData.tender.id}/invitations/${tokenHash}`,
        { method: 'DELETE' }
      );
      showToast(tr('tenders.inviteRevokedToast'));
      await openDetailModal(detailData.tender.id);
    } catch (err) {
      showToast(trError(err), 'error');
    }
  };

  const filteredTenders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tenders.filter((t) => {
      if (statusFilter && t.computedStatus !== statusFilter) return false;
      if (!q) return true;
      const bidderNames = t.invitedCompanyIds
        .map((id) => supplierMap.get(id)?.name || '')
        .join(' ');
      return `${t.name} ${t.projectName} ${t.type} ${t.code} ${bidderNames}`
        .toLowerCase()
        .includes(q);
    });
  }, [tenders, search, statusFilter, supplierMap]);

  const currentProjectForEditor = projectMap.get(fProjectId) || null;

  return (
    <PortalShell
      role="ADMIN"
      displayName={displayName}
      email={email}
      organizationName={organizationName}
      crumbTitle={tr('nav.tenders')}
    >
      <div className="heading">
        <div>
          <h1>{tr('tenders.title')}</h1>
          <p>{tab === 'submissions' ? tr('tenders.subSubmissions') : tr('tenders.sub')}</p>
        </div>
        <button
          type="button"
          className="btn primary"
          onClick={openCreateModal}
          data-testid="create-tender-btn"
        >
          ＋ {tr('tenders.create')}
        </button>
      </div>

      <div className="tender-tabs">
        <button
          type="button"
          className={tab === 'list' ? 'active' : ''}
          onClick={() => setTab('list')}
        >
          {tr('tenders.tabList')}
        </button>
        <button
          type="button"
          className={tab === 'submissions' ? 'active' : ''}
          onClick={() => setTab('submissions')}
        >
          {tr('tenders.tabSubmissions')}
        </button>
      </div>

      {tab === 'list' ? (
        <>
          <div className="toolbar">
            <input
              className="search"
              placeholder={`⌕ ${tr('tenders.searchPlaceholder')}`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="tender-search"
            />
            <select
              className="filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              data-testid="tender-status-filter"
            >
              <option value="">{tr('tenders.allStatuses')}</option>
              <option value="OPEN">{tr('tenders.status.OPEN')}</option>
              <option value="RECEIVING">{tr('tenders.status.RECEIVING')}</option>
              <option value="DRAFT">{tr('tenders.status.DRAFT')}</option>
              <option value="CLOSED">{tr('tenders.status.CLOSED')}</option>
            </select>
            <div className="grow" />
            <span className="subtle">
              {filteredTenders.length} {tr('dashboard.tendersUnit')}
            </span>
          </div>

          <div className="card table-card">
            <div className="table-wrap">
              {loading ? (
                <div className="empty">{tr('common.loading')}</div>
              ) : filteredTenders.length === 0 ? (
                <div className="empty">{tr('common.noResults')}</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>{tr('tenders.name')}</th>
                      <th>{tr('tenders.project')}</th>
                      <th>{tr('tenders.type')}</th>
                      <th>{tr('tenders.deadline')}</th>
                      <th>{tr('tenders.invitedSuppliers')}</th>
                      <th>{tr('tenders.tabSubmissions')}</th>
                      <th>{tr('common.status')}</th>
                      <th>{tr('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTenders.map((t) => (
                      <tr key={t.id}>
                        <td>
                          <span className="primary-text">{t.name || tr('common.untitled')}</span>
                          <span className="secondary">
                            {t.code} · rev.{t.revision}
                          </span>
                        </td>
                        <td className="cell-wrap">{t.projectName}</td>
                        <td className="cell-wrap">{trv('category', t.type)}</td>
                        <td>{formatDateTimeInZone(t.deadlineAt, t.timeZone, lang)}</td>
                        <td>{t.invitedCompanyIds.length}</td>
                        <td>
                          {t.receivedCompanyCount} / {t.invitedCompanyIds.length}
                        </td>
                        <td>
                          <StatusPill status={t.computedStatus} />
                        </td>
                        <td>
                          <div className="row-actions" style={{ justifyContent: 'flex-start' }}>
                            <button
                              type="button"
                              className="btn small"
                              onClick={() => openDetailModal(t.id)}
                              data-testid={`tender-open-${t.id}`}
                            >
                              {tr('tenders.open')}
                            </button>
                            {t.computedStatus !== 'CLOSED' && (
                              <button
                                type="button"
                                className="btn small"
                                onClick={() => requestEditTender(t)}
                                data-testid={`tender-edit-${t.id}`}
                              >
                                {t.computedStatus === 'DRAFT'
                                  ? tr('tenders.editDraft')
                                  : tr('tenders.edit')}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="notice">
            {tr('tenders.adminOnlyNotice')}
          </div>
          <div className="card table-card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{tr('tenders.name')}</th>
                    <th>{tr('suppliers.title')}</th>
                    <th>{tr('common.status')}</th>
                    <th>{tr('supplierPortal.receipt')}</th>
                    <th>{tr('supplierPortal.acceptedAt')}</th>
                    <th>{tr('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {tenders.flatMap((t) =>
                    t.invitedCompanyIds.map((companyId) => {
                      const sup = supplierMap.get(companyId);
                      const part = t.participants.find((p) => p.companyId === companyId);
                      const submitted = Boolean(part?.hasSubmitted);
                      return (
                        <tr key={`${t.id}-${companyId}`}>
                          <td>
                            <span className="primary-text">{t.name || t.code}</span>
                            <span className="secondary">
                              {t.code} · {t.projectName}
                            </span>
                          </td>
                          <td className="cell-wrap">{sup?.name || companyId}</td>
                          <td>
                            <StatusPill status={submitted ? 'SUBMITTED' : 'NOT_SUBMITTED'} />
                          </td>
                          <td>{part?.latestReceiptNumber || '—'}</td>
                          <td>
                            {part?.latestSubmittedAt
                              ? formatDateTimeInZone(part.latestSubmittedAt, t.timeZone, lang)
                              : '—'}
                          </td>
                          <td>
                            {submitted ? (
                              <button
                                type="button"
                                className="btn small"
                                onClick={() => openSubmissionsModal(t, companyId)}
                              >
                                {tr('tenders.viewFiles')}
                              </button>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Submission Warning Modal before editing a tender with submissions */}
      {warnTarget && (
        <Modal
          title={tr('tenders.editWarningTitle')}
          subtitle={tr('tenders.editWarningSub')}
          onClose={() => setWarnTarget(null)}
          maxWidth={480}
        >
          <div className="notice warn" data-testid="tender-edit-warning-text">
            {tr('tenders.editWarningBody')}
          </div>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => setWarnTarget(null)}>
              {tr('common.cancel')}
            </button>
            <button
              type="button"
              className="btn primary"
              data-testid="confirm-edit-warning-btn"
              onClick={() => {
                const target = warnTarget;
                setWarnTarget(null);
                openEditDirectly(target, true);
              }}
            >
              {tr('tenders.continueEditing')}
            </button>
          </div>
        </Modal>
      )}

      {/* Create / Edit Tender Modal */}
      {showEditor && (
        <Modal
          title={
            editingTender
              ? editingTender.computedStatus === 'DRAFT'
                ? tr('tenders.editDraft')
                : tr('tenders.edit')
              : tr('tenders.create')
          }
          subtitle={tr('tenders.sub')}
          onClose={() => setShowEditor(false)}
          maxWidth={780}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitTenderForm(
                editingTender?.publicationState === 'PUBLISHED' ? 'SAVE_PUBLISHED' : 'PUBLISH'
              );
            }}
          >
            <div className="form-grid">
              <div className="field full">
                <label>{tr('tenders.name')} *</label>
                <input
                  value={fName}
                  onChange={(e) => setFName(e.target.value)}
                  data-testid="tender-name-input"
                />
              </div>

              <div className="field">
                <label>{tr('tenders.project')} *</label>
                <SearchableSelect
                  ariaLabel={tr('tenders.project')}
                  value={fProjectId}
                  onChange={handleProjectChange}
                  options={projectOptions}
                />
              </div>

              <div className="field">
                <label>{tr('tenders.type')}</label>
                <SearchableSelect
                  ariaLabel={tr('tenders.type')}
                  value={fType}
                  onChange={setFType}
                  options={typeOptions}
                />
              </div>

              <div className="field full">
                <ScheduleEditor
                  mode="tender"
                  schedule={fSchedule}
                  onChange={setFSchedule}
                  projectSchedule={currentProjectForEditor?.masterSchedule || null}
                  scheduleSources={fSources}
                  onChangeSources={setFSources}
                />
              </div>

              <div className="field">
                <label>{tr('tenders.deadline')} *</label>
                <input
                  type="datetime-local"
                  value={fDeadlineLocal}
                  onChange={(e) => setFDeadlineLocal(e.target.value)}
                  data-testid="tender-deadline-input"
                />
              </div>

              <div className="field">
                <label>{tr('tenders.timeZone')} *</label>
                <input
                  list="tender-tz-options"
                  value={fTimeZone}
                  onChange={(e) => setFTimeZone(e.target.value)}
                  data-testid="tender-timezone-input"
                />
                <datalist id="tender-tz-options">
                  {timeZones.map((tz) => (
                    <option key={tz} value={tz} />
                  ))}
                </datalist>
                <small className="subtle">
                  {tr('tenders.tzPreview')}:{' '}
                  {dstResolution?.ok && dstResolution.utcIso
                    ? timeZoneOffsetLabel(fTimeZone, new Date(dstResolution.utcIso), lang)
                    : timeZoneOffsetLabel(fTimeZone, new Date(), lang)}
                </small>
                <small className="subtle">{tr('tenders.dstNote')}</small>
              </div>

              {dstResolution && !dstResolution.ok && dstResolution.errorCode === 'NON_EXISTENT_LOCAL_TIME' && (
                <div className="field full">
                  <div className="notice danger" style={{ margin: 0 }}>
                    {tr('tenders.dstGap')}
                  </div>
                </div>
              )}

              {dstResolution?.ambiguous && dstResolution.candidates && (
                <div className="field full">
                  <div className="notice warn" style={{ margin: 0 }}>
                    <div>
                      {tr('tenders.dstAmbiguous')}
                    </div>
                    <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="radio"
                          name="dstPick"
                          checked={fDstChoice === 'earlier'}
                          onChange={() => setFDstChoice('earlier')}
                        />
                        {dstResolution.candidates[0]?.offsetLabel}
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="radio"
                          name="dstPick"
                          checked={fDstChoice === 'later'}
                          onChange={() => setFDstChoice('later')}
                        />
                        {dstResolution.candidates[1]?.offsetLabel}
                      </label>
                    </div>
                  </div>
                </div>
              )}

              <div className="field full">
                <label>{tr('tenders.invitedSuppliers')} *</label>
                <input
                  className="search"
                  style={{ width: '100%', minWidth: 0, marginBottom: 6 }}
                  placeholder={`⌕ ${tr('tenders.searchBidders')}`}
                  value={bidderSearch}
                  onChange={(e) => setBidderSearch(e.target.value)}
                />
                <div className="bidder-selection-list">
                  {sortedBidders
                    .filter((s) => {
                      const mkts = s.coverage
                        .map((c) => `${c.displayName} ${marketDisplayName(c, 'ko')}`)
                        .join(' ');
                      return matchesSearch(
                        `${s.name} ${supplierTypeCode(s)} ${s.categories.join(' ')} ${mkts}`,
                        bidderSearch
                      );
                    })
                    .map((s) => {
                      const checked = fBidders.includes(s.id);
                      const lockedSubmitted = Boolean(
                        editingTender?.receivedCompanyIds.includes(s.id)
                      );
                      const coverageStr = s.coverage
                        .map((c) => marketDisplayName(c, lang))
                        .join(', ');
                      return (
                        <label key={s.id} className="bidder-option">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={lockedSubmitted}
                            onChange={() =>
                              setFBidders((prev) =>
                                prev.includes(s.id)
                                  ? prev.filter((x) => x !== s.id)
                                  : [...prev, s.id]
                              )
                            }
                          />
                          <span>
                            <b>
                              {supplierTypeCode(s)} {s.name}
                            </b>
                            {/* NDA first, then coverage; HQ location intentionally omitted here */}
                            <small>
                              NDA: {trv('nda', s.ndaStatus)}
                              {lockedSubmitted ? ` · ${tr('tenders.submittedLocked')}` : ''}
                            </small>
                            <small>
                              {tr('suppliers.serviceCoverage')}: {coverageStr || '—'}
                            </small>
                          </span>
                        </label>
                      );
                    })}
                </div>
                <small className="subtle">
                  {tr('tenders.selectedCount', { count: fBidders.length })}
                </small>
                <small className="subtle">{tr('tenders.ndaNotice')}</small>
              </div>

              <div className="field full">
                <label>{tr('tenders.requiredDocs')}</label>
                <input value={fRequired} onChange={(e) => setFRequired(e.target.value)} />
              </div>

              <div className="field full">
                <label>{tr('tenders.description')}</label>
                <textarea value={fDesc} onChange={(e) => setFDesc(e.target.value)} />
              </div>

              {editingTender?.publicationState === 'PUBLISHED' && (
                <div className="field full">
                  <label>{tr('tenders.changeReason')}</label>
                  <input
                    value={fChangeReason}
                    onChange={(e) => setFChangeReason(e.target.value)}
                    placeholder={tr('tenders.changeReasonPlaceholder')}
                  />
                </div>
              )}
            </div>

            {formError && (
              <div className="notice danger" role="alert" data-testid="tender-form-error">
                {formError}
              </div>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setShowEditor(false)}
                disabled={saving}
              >
                {tr('common.cancel')}
              </button>

              {editingTender?.publicationState === 'PUBLISHED' ? (
                /* Published tenders NEVER revert to DRAFT */
                <button
                  type="submit"
                  className="btn primary"
                  disabled={saving}
                  data-testid="save-published-tender-btn"
                >
                  {saving ? tr('common.loading') : tr('tenders.savePublished')}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn"
                    disabled={saving}
                    onClick={() => void submitTenderForm('SAVE_DRAFT')}
                    data-testid="save-draft-tender-btn"
                  >
                    {tr('tenders.saveDraft')}
                  </button>
                  <button
                    type="submit"
                    className="btn primary"
                    disabled={saving}
                    data-testid="publish-tender-btn"
                  >
                    {saving ? tr('common.loading') : tr('tenders.publish')}
                  </button>
                </>
              )}
            </div>
          </form>
        </Modal>
      )}

      {/* Tender Detail Modal */}
      {detailData && (
        <Modal
          title={detailData.tender.name || detailData.tender.code}
          subtitle={`${detailData.tender.code} · ${detailData.tender.projectName} · rev.${detailData.tender.revision}`}
          onClose={() => setDetailData(null)}
          maxWidth={780}
        >
          <div className="detail-box">
            <div className="detail-row">
              <span>{tr('common.status')}</span>
              <StatusPill status={detailData.tender.computedStatus} />
            </div>
            <div className="detail-row">
              <span>{tr('tenders.deadline')}</span>
              <b>
                {formatDateTimeInZone(
                  detailData.tender.deadlineAt,
                  detailData.tender.timeZone,
                  lang
                )}
              </b>
            </div>
            <div className="detail-row">
              <span>{tr('tenders.requiredDocs')}</span>
              <b>{detailData.tender.requiredDocuments || '—'}</b>
            </div>
          </div>

          <div className="detail-box">
            <b style={{ fontSize: 13 }}>{tr('tenders.schedule')}</b>
            <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
              {TENDER_MILESTONES.map((st) => {
                const entry = detailData.tender.schedule[st.key];
                const src = detailData.tender.scheduleSources[st.key];
                return (
                  <div key={st.key} className="detail-row" style={{ padding: '4px 0' }}>
                    <span>
                      {tr(st.labelKey as I18nKey)}{' '}
                      <small className="subtle">
                        ({src === 'OVERRIDE' ? tr('tenders.override') : tr('tenders.inherited')})
                      </small>
                    </span>
                    <b>
                      {entry.status === 'NOT_APPLICABLE'
                        ? tr('milestone.status.NOT_APPLICABLE')
                        : entry.status === 'PLANNED' && entry.dateLocal
                          ? entry.dateLocal
                          : tr('milestone.status.UNSET')}
                    </b>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="detail-box">
            <b style={{ fontSize: 13 }}>{tr('tenders.rfpDocs')}</b>
            <div style={{ marginTop: 8 }}>
              {detailData.files.filter((f) => f.ownerScope === 'RFP').length === 0 ? (
                <div className="subtle">{tr('tenders.noRfp')}</div>
              ) : (
                detailData.files
                  .filter((f) => f.ownerScope === 'RFP')
                  .map((f) => (
                    <div key={f.id} className="detail-row">
                      <span>
                        {f.originalName}{' '}
                        <StatusPill status={f.scanStatus} kind="scan" />{' '}
                        <StatusPill
                          status={f.publishedToSuppliers ? 'ACTIVE' : 'DRAFT'}
                          labelOverride={
                            f.publishedToSuppliers ? tr('tenders.published') : tr('tenders.internalOnly')
                          }
                        />
                      </span>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn small"
                          onClick={() => handleToggleRfpVisibility(f)}
                        >
                          {f.publishedToSuppliers ? tr('tenders.makeInternal') : tr('tenders.makePublished')}
                        </button>
                        <DownloadButton fileId={f.id} fileName={f.originalName} scanStatus={f.scanStatus} />
                      </div>
                    </div>
                  ))
              )}
            </div>
            <div className="upload-zone" style={{ marginTop: 10 }}>
              <input
                type="file"
                multiple
                disabled={rfpProgress !== null}
                onChange={(e) => {
                  const picked = e.target.files ? Array.from(e.target.files) : [];
                  e.target.value = '';
                  void handleRfpUpload(picked);
                }}
              />
              <div style={{ marginTop: 6 }}>{tr('tenders.uploadRfp')}</div>
              {rfpProgress !== null && (
                <div style={{ marginTop: 6, fontWeight: 600 }}>
                  {tr('common.uploading')} {rfpProgress}%
                </div>
              )}
            </div>
          </div>

          <div className="detail-box">
            <b style={{ fontSize: 13 }}>{tr('tenders.inviteLinks')}</b>
            {generatedLink && (
              <div className="notice" style={{ marginTop: 8 }}>
                <div>
                  <b>{tr('tenders.generatedLink')}</b>
                </div>
                <div className="link-box" style={{ marginTop: 6 }}>
                  <input readOnly value={generatedLink} data-testid="generated-invite-link" />
                  <button
                    type="button"
                    className="btn small"
                    onClick={() =>
                      void navigator.clipboard
                        ?.writeText(generatedLink)
                        .then(() => showToast(tr('tenders.copied')))
                        .catch(() => {})
                    }
                  >
                    {tr('tenders.copyInviteLink')}
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gap: 12, marginTop: 10 }}>
              {detailData.tender.invitedCompanyIds.map((cid) => {
                const sup = supplierMap.get(cid);
                const part = detailData.participants.find((p) => p.companyId === cid);
                const companyUsers = detailData.approvedSupplierUsers.filter(
                  (u) => u.supplierCompanyId === cid
                );
                const assigned = part?.assignedUserIds || [];

                return (
                  <div
                    key={cid}
                    style={{
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                      padding: 10,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 6,
                      }}
                    >
                      <b style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{sup?.name || cid}</b>
                      <StatusPill status={part?.hasSubmitted ? 'SUBMITTED' : 'NOT_SUBMITTED'} />
                    </div>

                    <div className="subtle" style={{ marginBottom: 6 }}>
                      {tr('tenders.assignedAccounts')}
                    </div>
                    {companyUsers.length === 0 ? (
                      <div className="subtle">
                        {tr('tenders.noLinkedAccounts')}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                        {companyUsers.map((u) => (
                          <label
                            key={u.uid}
                            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, overflowWrap: 'anywhere' }}
                          >
                            <input
                              type="checkbox"
                              checked={assigned.includes(u.uid)}
                              onChange={() => void handleAssignUserToggle(cid, assigned, u.uid)}
                            />
                            {u.email}
                          </label>
                        ))}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <input
                        className="search"
                        type="email"
                        style={{ minWidth: 0, flex: 1, padding: '7px 10px' }}
                        placeholder={tr('tenders.inviteEmailPlaceholder')}
                        value={inviteEmailByCompany[cid] || ''}
                        onChange={(e) =>
                          setInviteEmailByCompany((prev) => ({
                            ...prev,
                            [cid]: e.target.value,
                          }))
                        }
                      />
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => void handleCreateInvite(cid)}
                      >
                        {tr('tenders.createInviteLink')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {detailInvites.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <b style={{ fontSize: 13 }}>{tr('tenders.issuedLinks')}</b>
                {detailInvites.map((inv) => (
                  <div key={inv.tokenHash} className="detail-row">
                    <span>
                      {inv.normalizedEmail}{' '}
                      <StatusPill
                        status={inv.revokedAt ? 'DISABLED' : inv.consumedAt ? 'CLOSED' : 'ACTIVE'}
                        labelOverride={
                          inv.revokedAt
                            ? tr('tenders.inviteRevoked')
                            : inv.consumedAt
                              ? tr('tenders.inviteClaimed')
                              : tr('tenders.inviteActive')
                        }
                      />
                      {!inv.revokedAt && !inv.consumedAt && (
                        <small className="secondary">
                          {tr('tenders.expiresAt')}: {formatDateTimeInZone(inv.expiresAt, detailData.tender.timeZone, lang)}
                        </small>
                      )}
                    </span>
                    {!inv.revokedAt && !inv.consumedAt && (
                      <button
                        type="button"
                        className="btn small danger"
                        onClick={() => setRevokeTarget(inv.tokenHash)}
                      >
                        {tr('tenders.revoke')}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="modal-actions">
            <button type="button" className="btn primary" onClick={() => setDetailData(null)}>
              {tr('common.close')}
            </button>
          </div>
        </Modal>
      )}

      {/* Submission Versions Detail Modal */}
      {submissionModal && (
        <Modal
          title={`${supplierMap.get(submissionModal.companyId)?.name || submissionModal.companyId}`}
          subtitle={`${submissionModal.tender.name} · ${submissionModal.tender.code}`}
          onClose={() => setSubmissionModal(null)}
          maxWidth={680}
        >
          {submissionModal.versions.length === 0 ? (
            <div className="empty">{tr('common.noResults')}</div>
          ) : (
            submissionModal.versions.map((ver) => (
              <div key={ver.versionId} className="detail-box">
                <div className="detail-row">
                  <span>{tr('common.version')}</span>
                  <b>
                    v{ver.versionNumber} · {ver.receiptNumber}
                  </b>
                </div>
                <div className="detail-row">
                  <span>{tr('supplierPortal.acceptedAt')}</span>
                  <b>
                    {formatDateTimeInZone(
                      ver.acceptedAt,
                      submissionModal.tender.timeZone,
                      lang
                    )}
                  </b>
                </div>
                <div style={{ marginTop: 8 }}>
                  {ver.files.map((f) => (
                    <div key={f.fileId} className="detail-row">
                      <span>
                        {f.originalName} <StatusPill status={f.scanStatus} kind="scan" />
                      </span>
                      <DownloadButton fileId={f.fileId} fileName={f.originalName} scanStatus={f.scanStatus} />
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="btn primary"
              onClick={() => setSubmissionModal(null)}
            >
              {tr('common.close')}
            </button>
          </div>
        </Modal>
      )}
      {revokeTarget && (
        <ConfirmDialog
          title={tr('tenders.confirmRevokeTitle')}
          body={tr('tenders.confirmRevokeBody')}
          confirmLabel={tr('tenders.revoke')}
          danger
          onCancel={() => setRevokeTarget(null)}
          onConfirm={() => {
            const target = revokeTarget;
            setRevokeTarget(null);
            void handleRevokeInvite(target);
          }}
        />
      )}
    </PortalShell>
  );
}
