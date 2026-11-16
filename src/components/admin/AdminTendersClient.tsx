'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ref, uploadBytesResumable } from 'firebase/storage';
import { getFirebaseClientStorage } from '@/lib/firebase/client';
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
import { Modal } from '@/components/ui/Modal';
import { StatusPill } from '@/components/ui/StatusPill';
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
  const { lang, tr } = useLanguage();
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
      showToast(err instanceof Error ? err.message : 'Failed to load tenders', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const supplierMap = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const timeZones = useMemo(() => getSupportedTimeZones(), []);

  const dstResolution = useMemo(() => {
    if (!fDeadlineLocal || !fTimeZone) return null;
    return resolveLocalDateTimeInZone(fDeadlineLocal, fTimeZone, fDstChoice);
  }, [fDeadlineLocal, fTimeZone, fDstChoice]);

  const openCreateModal = () => {
    if (!projects.length || !suppliers.length) {
      showToast(
        lang === 'ko'
          ? '먼저 프로젝트와 협력사를 등록하세요.'
          : 'Add at least one project and supplier first.',
        'error'
      );
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

  const submitTenderForm = async (action: 'SAVE_DRAFT' | 'PUBLISH' | 'SAVE_PUBLISHED') => {
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
        showToast(
          action === 'SAVE_DRAFT'
            ? 'Draft updated.'
            : lang === 'ko'
              ? '입찰 수정사항을 저장했습니다.'
              : 'Tender changes saved.'
        );
      } else {
        await apiFetch('/api/admin/tenders', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast(
          action === 'SAVE_DRAFT'
            ? lang === 'ko'
              ? '입찰을 임시 저장했습니다.'
              : 'Tender saved as draft.'
            : lang === 'ko'
              ? '입찰을 생성했습니다.'
              : 'Tender published.'
        );
      }
      setShowEditor(false);
      await loadAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save tender', 'error');
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
      showToast(err instanceof Error ? err.message : 'Failed to open tender detail', 'error');
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
      showToast(err instanceof Error ? err.message : 'Failed to load submission', 'error');
    }
  };

  const handleRfpUpload = async (files: FileList | null) => {
    if (!files || !files.length || !detailData) return;
    const tenderId = detailData.tender.id;
    const storage = getFirebaseClientStorage();
    const intentIds: string[] = [];

    try {
      for (const file of Array.from(files)) {
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
      showToast(lang === 'ko' ? 'RFP 자료를 업로드했습니다.' : 'RFP documents uploaded.');
      await openDetailModal(tenderId);
      await loadAll();
    } catch (err) {
      setRfpProgress(null);
      showToast(err instanceof Error ? err.message : 'RFP upload failed', 'error');
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
      showToast(err instanceof Error ? err.message : 'Failed to update visibility', 'error');
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
      showToast(lang === 'ko' ? '입찰 접근 계정을 업데이트했습니다.' : 'Assigned accounts updated.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to assign user', 'error');
    }
  };

  const handleCreateInvite = async (companyId: string) => {
    if (!detailData) return;
    const targetEmail = (inviteEmailByCompany[companyId] || '').trim();
    if (!targetEmail) {
      showToast(lang === 'ko' ? '대상 이메일을 입력하세요.' : 'Enter target email.', 'error');
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
      showToast(
        lang === 'ko'
          ? '초청 링크를 생성했습니다. 직접 대상자에게 전달하세요.'
          : 'Invitation link generated. Please share it directly with the recipient.'
      );
      await openDetailModal(detailData.tender.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create invite link', 'error');
    }
  };

  const handleRevokeInvite = async (tokenHash: string) => {
    if (!detailData) return;
    try {
      await apiFetch(
        `/api/admin/tenders/${detailData.tender.id}/invitations/${tokenHash}`,
        { method: 'DELETE' }
      );
      showToast(lang === 'ko' ? '초청 링크를 회수했습니다.' : 'Invitation revoked.');
      await openDetailModal(detailData.tender.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to revoke invite', 'error');
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
                          <span className="primary-text">{t.name || 'Untitled draft'}</span>
                          <span className="secondary">
                            {t.code} · rev.{t.revision}
                          </span>
                        </td>
                        <td>{t.projectName}</td>
                        <td>{t.type}</td>
                        <td>{formatDateTimeInZone(t.deadlineAt, t.timeZone, lang)}</td>
                        <td>{t.invitedCompanyIds.length}</td>
                        <td>
                          {t.receivedCompanyCount} / {t.invitedCompanyIds.length}
                        </td>
                        <td>
                          <StatusPill status={t.computedStatus} />
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
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
            {lang === 'ko'
              ? '접수된 견적 및 기술 자료는 구매팀 관리자만 열람할 수 있습니다. 자동 금액 추출 및 봉인평가는 현재 범위에 포함되지 않습니다.'
              : 'Submitted commercial and technical files are visible to Procurement Admins only.'}
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
                          <td>{sup?.name || companyId}</td>
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
                                {lang === 'ko' ? '견적/제출파일 보기' : 'View quote/files'}
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
                <select
                  value={fProjectId}
                  onChange={(e) => handleProjectChange(e.target.value)}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>{tr('tenders.type')}</label>
                <select value={fType} onChange={(e) => setFType(e.target.value)}>
                  {TENDER_TYPES.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
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
                    {lang === 'ko'
                      ? '선택한 현지 시각은 서머타임 전환(Spring Forward)으로 존재하지 않는 시각입니다.'
                      : 'The selected local time does not exist due to a Daylight Saving Time transition.'}
                  </div>
                </div>
              )}

              {dstResolution?.ambiguous && dstResolution.candidates && (
                <div className="field full">
                  <div className="notice warn" style={{ margin: 0 }}>
                    <div>
                      {lang === 'ko'
                        ? '서머타임 종료로 동일한 현지 시각이 두 번 발생합니다. 적용할 오프셋을 선택하세요:'
                        : 'This local time occurs twice due to DST fall-back. Choose which offset applies:'}
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
                  {suppliers
                    .filter((s) => {
                      const q = bidderSearch.trim().toLowerCase();
                      if (!q) return true;
                      const mkts = s.coverage.map((c) => c.displayName).join(' ');
                      return `${s.name} ${supplierTypeCode(s)} ${s.categories.join(' ')} ${mkts}`
                        .toLowerCase()
                        .includes(q);
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
                              NDA: {s.ndaStatus}
                              {lockedSubmitted ? ' · Submitted (locked)' : ''}
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
                    placeholder={
                      lang === 'ko'
                        ? '예: 마감일 연장 또는 RFP 수정 안내'
                        : 'e.g. Extended deadline or revised RFP scope'
                    }
                  />
                </div>
              )}
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
            <b style={{ fontSize: 12 }}>{tr('tenders.schedule')}</b>
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
            <b style={{ fontSize: 12 }}>{tr('tenders.rfpDocs')}</b>
            <div style={{ marginTop: 8 }}>
              {detailData.files.filter((f) => f.ownerScope === 'RFP').length === 0 ? (
                <div className="subtle">No tender files uploaded yet.</div>
              ) : (
                detailData.files
                  .filter((f) => f.ownerScope === 'RFP')
                  .map((f) => (
                    <div key={f.id} className="detail-row">
                      <span>
                        {f.originalName}{' '}
                        <StatusPill status={f.scanStatus} />
                      </span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          className="btn small"
                          onClick={() => handleToggleRfpVisibility(f)}
                        >
                          {f.publishedToSuppliers
                            ? lang === 'ko'
                              ? '협력사 공개 중'
                              : 'Published'
                            : lang === 'ko'
                              ? '내부 전용'
                              : 'Internal only'}
                        </button>
                        <a
                          className="btn small"
                          href={`/api/files/${f.id}/download`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          ↓ {tr('common.download')}
                        </a>
                      </div>
                    </div>
                  ))
              )}
            </div>
            <div className="upload-zone" style={{ marginTop: 10 }}>
              <input
                type="file"
                multiple
                onChange={(e) => void handleRfpUpload(e.target.files)}
              />
              <div style={{ marginTop: 6 }}>{tr('tenders.uploadRfp')}</div>
              {rfpProgress !== null && <div>Uploading... {rfpProgress}%</div>}
            </div>
          </div>

          <div className="detail-box">
            <b style={{ fontSize: 12 }}>{tr('tenders.inviteLinks')}</b>
            {generatedLink && (
              <div className="notice" style={{ marginTop: 8 }}>
                <div>
                  <b>{lang === 'ko' ? '생성된 초청 링크 (직접 전달용)' : 'Generated invite link'}</b>
                </div>
                <div className="link-box" style={{ marginTop: 6 }}>
                  <input readOnly value={generatedLink} data-testid="generated-invite-link" />
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => void navigator.clipboard?.writeText(generatedLink)}
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
                        marginBottom: 6,
                      }}
                    >
                      <b>{sup?.name || cid}</b>
                      <StatusPill status={part?.hasSubmitted ? 'SUBMITTED' : 'NOT_SUBMITTED'} />
                    </div>

                    <div className="subtle" style={{ marginBottom: 6 }}>
                      {lang === 'ko'
                        ? '입찰 접근 배정된 승인 계정:'
                        : 'Assigned approved supplier accounts:'}
                    </div>
                    {companyUsers.length === 0 ? (
                      <div className="subtle">
                        {lang === 'ko'
                          ? '이 업체에 연결된 승인 계정이 없습니다.'
                          : 'No approved user accounts linked to this company yet.'}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                        {companyUsers.map((u) => (
                          <label
                            key={u.uid}
                            style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}
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
                        style={{ minWidth: 0, flex: 1, padding: '6px 9px' }}
                        placeholder={
                          lang === 'ko'
                            ? '초청 대상 이메일 입력...'
                            : 'Target supplier email...'
                        }
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
                        {tr('tenders.copyInviteLink')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {detailInvites.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <b style={{ fontSize: 11 }}>
                  {lang === 'ko' ? '발급된 초청 링크 이력' : 'Issued invitation links'}
                </b>
                {detailInvites.map((inv) => (
                  <div key={inv.tokenHash} className="detail-row">
                    <span>
                      {inv.normalizedEmail} ·{' '}
                      {inv.revokedAt
                        ? 'Revoked'
                        : inv.consumedAt
                          ? 'Claimed'
                          : 'Active'}
                    </span>
                    {!inv.revokedAt && !inv.consumedAt && (
                      <button
                        type="button"
                        className="btn small danger"
                        onClick={() => void handleRevokeInvite(inv.tokenHash)}
                      >
                        Revoke
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
                  <span>Version</span>
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
                        {f.originalName} <StatusPill status={f.scanStatus} />
                      </span>
                      <a
                        className="btn small"
                        href={`/api/files/${f.fileId}/download`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        ↓ {tr('common.download')}
                      </a>
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
    </PortalShell>
  );
}
