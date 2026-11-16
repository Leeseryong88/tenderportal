import { describe, expect, it } from 'vitest';
import { EMPTY_AUDIT_NAMES, formatAuditLog, type AuditNames } from '@/lib/audit/format';
import type { AuditLogRecord } from '@/types/domain';

const base: AuditLogRecord = {
  id: 'aud_1',
  tenantId: 't1',
  requestId: 'r1',
  actorUid: 'admin1',
  actorRole: 'ADMIN',
  action: 'TENDER_PUBLISHED',
  targetType: 'tender',
  targetId: 'tnd_1',
  beforeSummary: null,
  afterSummary: { name: '본사 리뉴얼', invitedCount: 3, deadlineAt: '2026-12-01T09:00:00.000Z' },
  reason: null,
  createdAt: '2026-11-16T00:00:00.000Z',
};

const names: AuditNames = {
  ...EMPTY_AUDIT_NAMES,
  users: { admin1: '홍길동 (admin@example.com)', u2: '김철수' },
  tenders: { tnd_1: '본사 리뉴얼' },
  suppliers: { sup_1: '한빛건설' },
};

describe('formatAuditLog', () => {
  it('describes a published tender in Korean with names instead of ids', () => {
    const view = formatAuditLog(base, names, 'ko', 'Asia/Seoul');
    expect(view.actor).toBe('홍길동 (admin@example.com)');
    expect(view.actorRole).toBe('구매팀 관리자');
    expect(view.summary).toBe("입찰 '본사 리뉴얼'을 생성하고 협력사 3곳을 초청했습니다.");
    expect(view.details[0]).toContain('제출 마감');
    expect(view.summary).not.toContain('tnd_1');
  });

  it('lists added and removed accounts for participant assignment', () => {
    const view = formatAuditLog(
      {
        ...base,
        action: 'TENDER_COMPANY_USERS_ASSIGNED',
        targetType: 'tenderParticipant',
        targetId: 'tnd_1:sup_1',
        beforeSummary: { assignedUserIds: ['u3'] },
        afterSummary: { assignedUserIds: ['u2'] },
      },
      names,
      'ko',
      'Asia/Seoul'
    );
    expect(view.summary).toBe("입찰 '본사 리뉴얼'의 한빛건설 접근 계정을 변경했습니다.");
    expect(view.details).toEqual(['추가: 김철수', '제외: 사용자 u3…']);
  });

  it('translates legacy English default reasons and status changes', () => {
    const view = formatAuditLog(
      {
        ...base,
        action: 'USER_STATUS_DISABLED',
        targetType: 'membership',
        targetId: 'u2',
        afterSummary: null,
        reason: 'Changed status to DISABLED',
      },
      names,
      'ko',
      'Asia/Seoul'
    );
    expect(view.summary).toBe('김철수 계정을 사용 중지했습니다.');
    expect(view.reason).toBe("상태를 '사용 중지'(으)로 변경");
  });

  it('falls back to the raw action for unknown events', () => {
    const view = formatAuditLog({ ...base, action: 'SOMETHING_NEW' }, EMPTY_AUDIT_NAMES, 'ko', 'Asia/Seoul');
    expect(view.summary).toBe('SOMETHING_NEW');
  });
});
