'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/client/api';
import { PortalShell } from '@/components/layout/PortalShell';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { Modal } from '@/components/ui/Modal';
import { ReauthModal } from '@/components/ui/ReauthModal';
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

export function AdminUsersClient({
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
  const [pendingAction, setPendingAction] = useState<
    | null
    | { type: 'APPROVE'; uid: string }
    | { type: 'STATUS'; uid: string; nextStatus: 'REJECTED' | 'DISABLED' }
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
      showToast(err instanceof Error ? err.message : 'Failed to load users', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const openManageModal = (u: UserRow) => {
    setSelectedUser(u);
    setTargetRole(u.role || u.requestedRole || 'USER_DEPARTMENT');
    setTargetCompanyId(u.supplierCompanyId || suppliers[0]?.id || '');
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
            reason: reason.trim() || 'Approved by administrator',
          }),
        });
        showToast(lang === 'ko' ? '사용자 권한을 승인/반영했습니다.' : 'User approved/updated.');
      } else {
        await apiFetch(`/api/admin/users/${pendingAction.uid}/status`, {
          method: 'POST',
          reauthToken: freshToken,
          body: JSON.stringify({
            status: pendingAction.nextStatus,
            reason: reason.trim() || `Changed status to ${pendingAction.nextStatus}`,
          }),
        });
        showToast(lang === 'ko' ? '계정 상태를 변경했습니다.' : 'User status updated.');
      }
      setPendingAction(null);
      setSelectedUser(null);
      await loadAll();
    } catch (err) {
      setPendingAction(null);
      showToast(err instanceof Error ? err.message : 'Operation failed', 'error');
    }
  };

  const filtered = users.filter((u) => statusFilter === 'ALL' || u.status === statusFilter);
  const supplierMap = new Map(suppliers.map((s) => [s.id, s]));

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
          <p>
            {lang === 'ko'
              ? '회원가입 승인 대기, 역할 배정, 협력사 Pool 업체 연결 및 계정 사용 중지를 관리합니다.'
              : 'Review access requests, assign roles, link supplier companies, and manage account suspensions.'}
          </p>
        </div>
      </div>

      <div className="notice">
        {lang === 'ko'
          ? '협력사 회사 소속 승인만으로는 입찰이 열리지 않습니다. 입찰 상세 화면에서 입찰별 접근 계정을 지정해야 해당 입찰 열람 및 자사 제출자료 공유가 가능합니다.'
          : 'Approving a supplier user into a company does not automatically grant access to all tenders of that company. Assign specific users per tender in Tender Detail.'}
      </div>

      <div className="tender-tabs">
        {(['ALL', 'PENDING', 'ACTIVE', 'REJECTED', 'DISABLED'] as const).map((st) => (
          <button
            key={st}
            type="button"
            className={statusFilter === st ? 'active' : ''}
            onClick={() => setStatusFilter(st)}
          >
            {st === 'ALL' ? tr('common.all') : tr(`status.${st}`)}
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
                  <th>USER</th>
                  <th>EMAIL VERIFIED</th>
                  <th>REQUESTED</th>
                  <th>ASSIGNED ROLE</th>
                  <th>LINKED COMPANY</th>
                  <th>STATUS</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.uid}>
                    <td>
                      <span className="primary-text">{u.displayName}</span>
                      <span className="secondary">
                        {u.email} · {u.phone || '—'}
                      </span>
                    </td>
                    <td>{u.emailVerified ? 'Verified' : 'Unverified'}</td>
                    <td>
                      {u.requestedRole ? tr(`role.${u.requestedRole}`) : '—'}
                      <span className="secondary">{u.requestedCompanyOrDept || '—'}</span>
                    </td>
                    <td>
                      {u.role ? tr(`role.${u.role}`) : '—'}
                      {u.canManageAdmins && <span className="secondary">Owner Admin</span>}
                    </td>
                    <td>
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
                        className="btn small"
                        onClick={() => openManageModal(u)}
                        data-testid={`manage-user-${u.uid}`}
                      >
                        Manage
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {selectedUser && (
        <Modal
          title={selectedUser.displayName}
          subtitle={selectedUser.email}
          onClose={() => setSelectedUser(null)}
          maxWidth={580}
        >
          <div className="detail-box">
            <div className="detail-row">
              <span>Verified Email</span>
              <b>{selectedUser.emailVerified ? 'Yes' : 'No'}</b>
            </div>
            <div className="detail-row">
              <span>Requested Role</span>
              <b>{selectedUser.requestedRole || '—'}</b>
            </div>
            <div className="detail-row">
              <span>Requested Dept / Company</span>
              <b>{selectedUser.requestedCompanyOrDept || '—'}</b>
            </div>
            <div className="detail-row">
              <span>Current Role / Status</span>
              <b>
                {selectedUser.role || 'None'} / {selectedUser.status} (v{selectedUser.authzVersion})
              </b>
            </div>
          </div>

          <div className="form-grid">
            <div className="field">
              <label>Assign Role *</label>
              <select
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
                <label>Link Supplier Company *</label>
                <select
                  value={targetCompanyId}
                  onChange={(e) => setTargetCompanyId(e.target.value)}
                >
                  <option value="">Select company...</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.countryCode})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {targetRole === 'ADMIN' && actorCanManageAdmins && (
              <div className="field full">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto' }}
                    checked={targetCanManageAdmins}
                    onChange={(e) => setTargetCanManageAdmins(e.target.checked)}
                  />
                  Grant canManageAdmins (Owner Admin)
                </label>
              </div>
            )}

            <div className="field full">
              <label>Decision / Audit Reason</label>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason for approval, role change, or suspension..."
              />
            </div>
          </div>

          <div className="modal-actions">
            <button
              type="button"
              className="btn danger"
              onClick={() =>
                setPendingAction({
                  type: 'STATUS',
                  uid: selectedUser.uid,
                  nextStatus: 'DISABLED',
                })
              }
            >
              Disable
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={() =>
                setPendingAction({
                  type: 'STATUS',
                  uid: selectedUser.uid,
                  nextStatus: 'REJECTED',
                })
              }
            >
              Reject
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => setPendingAction({ type: 'APPROVE', uid: selectedUser.uid })}
              data-testid="approve-user-btn"
            >
              Approve / Save Role
            </button>
          </div>
        </Modal>
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
