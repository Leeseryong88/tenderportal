'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/client/api';
import { PortalShell } from '@/components/layout/PortalShell';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Modal } from '@/components/ui/Modal';
import { ReauthModal } from '@/components/ui/ReauthModal';
import { SearchableSelect, type SelectOption } from '@/components/ui/SearchableSelect';
import { StatusPill } from '@/components/ui/StatusPill';
import type { AccountStatus, Role, SupplierRecord } from '@/types/domain';

interface UserRow {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  phone: string;
  requestedRole: 'USER_DEPARTMENT' | 'SUPPLIER' | null;
  requestedCompanyOrDept: string;
  status: AccountStatus;
  role: Role | null;
  supplierCompanyId: string | null;
  authzVersion: number;
  canManageAdmins: boolean;
  decisionReason: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type StatusChange = 'REJECTED' | 'DISABLED';

export function AdminUsersClient({
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

  const [users, setUsers] = useState<UserRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [actorCanManageAdmins, setActorCanManageAdmins] = useState(false);
  const [statusFilter, setStatusFilter] = useState<AccountStatus | 'ALL'>('ALL');
  const [loading, setLoading] = useState(true);

  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [targetRole, setTargetRole] = useState<Role>('USER_DEPARTMENT');
  const [targetCompanyId, setTargetCompanyId] = useState('');
  const [targetCanManageAdmins, setTargetCanManageAdmins] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmStatus, setConfirmStatus] = useState<StatusChange | null>(null);
  const [pendingAction, setPendingAction] = useState<
    | null
    | { type: 'APPROVE'; uid: string }
    | { type: 'STATUS'; uid: string; nextStatus: StatusChange }
  >(null);

  const loadAll = useCallback(async () => {
    try {
      const [uRes, sRes] = await Promise.all([
        apiFetch<{ users: UserRow[]; actorCanManageAdmins: boolean }>('/api/admin/users'),
        apiFetch<{ suppliers: SupplierRecord[] }>('/api/admin/suppliers'),
      ]);
      setUsers(uRes.users);
      setActorCanManageAdmins(uRes.actorCanManageAdmins);
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

  const openManageModal = (u: UserRow) => {
    setSelectedUser(u);
    setTargetRole(u.role || u.requestedRole || 'USER_DEPARTMENT');
    // Never preselect a company: linking the wrong supplier would expose its tenders.
    setTargetCompanyId(u.supplierCompanyId || '');
    setTargetCanManageAdmins(u.canManageAdmins);
    setReason('');
  };

  const executeWithReauth = async (freshToken: string) => {
    if (!pendingAction) return;
    try {
      if (pendingAction.type === 'APPROVE') {
        await apiFetch(`/api/admin/users/${pendingAction.uid}/approve`, {
          method: 'POST',
          reauthToken: freshToken,
          body: JSON.stringify({
            role: targetRole,
            supplierCompanyId: targetRole === 'SUPPLIER' ? targetCompanyId : null,
            canManageAdmins: targetRole === 'ADMIN' ? targetCanManageAdmins : false,
            reason: reason.trim() || tr('users.defaultApproveReason'),
          }),
        });
        showToast(lang === 'ko' ? '사용자 권한을 승인/반영했습니다.' : 'User approved/updated.');
      } else {
        await apiFetch(`/api/admin/users/${pendingAction.uid}/status`, {
          method: 'POST',
          reauthToken: freshToken,
          body: JSON.stringify({
            status: pendingAction.nextStatus,
            reason:
              reason.trim() ||
              tr('users.defaultStatusReason', { status: trv('status', pendingAction.nextStatus) }),
          }),
        });
        showToast(lang === 'ko' ? '계정 상태를 변경했습니다.' : 'User status updated.');
      }
      setPendingAction(null);
      setSelectedUser(null);
      await loadAll();
    } catch (err) {
      setPendingAction(null);
      showToast(trError(err), 'error');
    }
  };

  const filtered = users.filter((u) => statusFilter === 'ALL' || u.status === statusFilter);
  const supplierMap = new Map(suppliers.map((s) => [s.id, s]));
  const countFor = (st: AccountStatus | 'ALL') =>
    st === 'ALL' ? users.length : users.filter((u) => u.status === st).length;

  const supplierOptions: SelectOption[] = suppliers.map((s) => ({
    value: s.id,
    label: `${s.name} (${s.countryCode})`,
    keywords: s.countryName,
  }));

  const approveBlockedReason = !selectedUser
    ? ''
    : !selectedUser.emailVerified
      ? tr('users.emailNotVerifiedNotice')
      : targetRole === 'SUPPLIER' && !targetCompanyId
        ? tr('users.companyRequired')
        : '';

  return (
    <PortalShell
      role="ADMIN"
      displayName={displayName}
      email={email}
      organizationName={organizationName}
      crumbTitle={tr('nav.users')}
    >
      <div className="heading">
        <div>
          <h1>{tr('nav.users')}</h1>
          <p>{tr('users.sub')}</p>
        </div>
      </div>

      <div className="notice">{tr('users.scopeNotice')}</div>

      <div className="tender-tabs">
        {(['ALL', 'PENDING', 'ACTIVE', 'REJECTED', 'DISABLED'] as const).map((st) => (
          <button
            key={st}
            type="button"
            className={statusFilter === st ? 'active' : ''}
            onClick={() => setStatusFilter(st)}
          >
            {st === 'ALL' ? tr('common.all') : tr(`status.${st}`)} ({countFor(st)})
          </button>
        ))}
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
                  <th>{tr('users.colUser')}</th>
                  <th>{tr('users.colEmail')}</th>
                  <th>{tr('users.colRequested')}</th>
                  <th>{tr('users.colRole')}</th>
                  <th>{tr('users.colCompany')}</th>
                  <th>{tr('common.status')}</th>
                  <th>{tr('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.uid}>
                    <td>
                      <span className="primary-text">{u.displayName || '—'}</span>
                      <span className="secondary">
                        {u.email} · {u.phone || '—'}
                      </span>
                    </td>
                    <td>
                      <StatusPill
                        status={u.emailVerified ? 'ACTIVE' : 'PENDING'}
                        labelOverride={u.emailVerified ? tr('users.verified') : tr('users.unverified')}
                      />
                    </td>
                    <td>
                      {u.requestedRole ? tr(`role.${u.requestedRole}`) : '—'}
                      <span className="secondary">{u.requestedCompanyOrDept || '—'}</span>
                    </td>
                    <td>
                      {u.role ? tr(`role.${u.role}`) : '—'}
                      {u.canManageAdmins && <span className="secondary">{tr('users.ownerAdmin')}</span>}
                    </td>
                    <td className="cell-wrap">
                      {u.supplierCompanyId
                        ? supplierMap.get(u.supplierCompanyId)?.name || u.supplierCompanyId
                        : '—'}
                    </td>
                    <td>
                      <StatusPill status={u.status} />
                    </td>
                    <td>
                      <button
                        type="button"
                        className={u.status === 'PENDING' ? 'btn small primary' : 'btn small'}
                        onClick={() => openManageModal(u)}
                        data-testid={`manage-user-${u.uid}`}
                      >
                        {u.status === 'PENDING' ? tr('common.review') : tr('users.manage')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {selectedUser && !confirmStatus && !pendingAction && (
        <Modal
          title={selectedUser.displayName || selectedUser.email}
          subtitle={selectedUser.email}
          onClose={() => setSelectedUser(null)}
          maxWidth={580}
        >
          <div className="detail-box">
            <div className="detail-row">
              <span>{tr('users.colEmail')}</span>
              <b>{selectedUser.emailVerified ? tr('users.verified') : tr('users.unverified')}</b>
            </div>
            <div className="detail-row">
              <span>{tr('users.requestedRole')}</span>
              <b>{selectedUser.requestedRole ? tr(`role.${selectedUser.requestedRole}`) : '—'}</b>
            </div>
            <div className="detail-row">
              <span>{tr('users.requestedOrg')}</span>
              <b>{selectedUser.requestedCompanyOrDept || '—'}</b>
            </div>
            <div className="detail-row">
              <span>{tr('users.currentState')}</span>
              <b>
                {selectedUser.role ? tr(`role.${selectedUser.role}`) : tr('users.none')} /{' '}
                {tr(`status.${selectedUser.status}`)}
              </b>
            </div>
          </div>

          <div className="form-grid">
            <div className="field">
              <label htmlFor="user-target-role">{tr('users.assignRole')} *</label>
              <select
                id="user-target-role"
                value={targetRole}
                onChange={(e) => setTargetRole(e.target.value as Role)}
              >
                <option value="USER_DEPARTMENT">{tr('role.USER_DEPARTMENT')}</option>
                <option value="SUPPLIER">{tr('role.SUPPLIER')}</option>
                {actorCanManageAdmins && <option value="ADMIN">{tr('role.ADMIN')}</option>}
              </select>
            </div>

            {targetRole === 'SUPPLIER' && (
              <div className="field">
                <label htmlFor="user-target-company">{tr('users.linkCompany')} *</label>
                <SearchableSelect
                  id="user-target-company"
                  value={targetCompanyId}
                  onChange={setTargetCompanyId}
                  placeholder={tr('users.selectCompany')}
                  options={supplierOptions}
                  testId="user-target-company"
                />
              </div>
            )}

            {targetRole === 'ADMIN' && actorCanManageAdmins && (
              <div className="field full">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={targetCanManageAdmins}
                    onChange={(e) => setTargetCanManageAdmins(e.target.checked)}
                  />
                  {tr('users.grantOwner')}
                </label>
              </div>
            )}

            <div className="field full">
              <label htmlFor="user-reason">{tr('common.reason')}</label>
              <input
                id="user-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={tr('users.reasonPlaceholder')}
              />
            </div>
          </div>

          {approveBlockedReason && <div className="notice warn">{approveBlockedReason}</div>}

          <div className="modal-actions">
            {selectedUser.status === 'ACTIVE' && (
              <button type="button" className="btn danger" onClick={() => setConfirmStatus('DISABLED')}>
                {tr('users.disable')}
              </button>
            )}
            {selectedUser.status === 'PENDING' && (
              <button type="button" className="btn danger" onClick={() => setConfirmStatus('REJECTED')}>
                {tr('users.reject')}
              </button>
            )}
            <button
              type="button"
              className="btn primary"
              disabled={Boolean(approveBlockedReason)}
              onClick={() => setPendingAction({ type: 'APPROVE', uid: selectedUser.uid })}
              data-testid="approve-user-btn"
            >
              {tr('users.approve')}
            </button>
          </div>
        </Modal>
      )}

      {selectedUser && confirmStatus && (
        <ConfirmDialog
          title={confirmStatus === 'DISABLED' ? tr('users.confirmDisableTitle') : tr('users.confirmRejectTitle')}
          body={tr('users.confirmStatusBody')}
          confirmLabel={confirmStatus === 'DISABLED' ? tr('users.disable') : tr('users.reject')}
          danger
          onCancel={() => setConfirmStatus(null)}
          onConfirm={() => {
            setPendingAction({ type: 'STATUS', uid: selectedUser.uid, nextStatus: confirmStatus });
            setConfirmStatus(null);
          }}
        >
          <div className="detail-box">
            <div className="detail-row">
              <span>{tr('users.colUser')}</span>
              <b>{selectedUser.displayName || selectedUser.email}</b>
            </div>
            <div className="detail-row">
              <span>{tr('common.reason')}</span>
              <b>{reason.trim() || '—'}</b>
            </div>
          </div>
        </ConfirmDialog>
      )}

      {pendingAction && (
        <ReauthModal
          onCancel={() => setPendingAction(null)}
          onSuccess={(token) => void executeWithReauth(token)}
        />
      )}
    </PortalShell>
  );
}
