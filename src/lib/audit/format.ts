import { t, tv, type Lang } from '@/i18n';
import type { I18nKey } from '@/i18n/en';
import { formatDateTimeInZone } from '@/lib/domain/timezone';
import type { AuditLogRecord } from '@/types/domain';

export interface AuditNames {
  users: Record<string, string>;
  tenders: Record<string, string>;
  projects: Record<string, string>;
  suppliers: Record<string, string>;
  files: Record<string, string>;
}

export const EMPTY_AUDIT_NAMES: AuditNames = {
  users: {},
  tenders: {},
  projects: {},
  suppliers: {},
  files: {},
};

export interface FormattedAudit {
  actor: string;
  actorRole: string;
  summary: string;
  details: string[];
  reason: string | null;
}

type Summary = Record<string, unknown>;

function s(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

function n(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Picks 을/를-style particles from the final consonant of the last Hangul syllable. */
function josa(word: string, withBatchim: string, withoutBatchim: string): string {
  const last = word.replace(/['"’”)\]\s]+$/u, '').slice(-1);
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return `${withBatchim}(${withoutBatchim})`;
  return (code - 0xac00) % 28 === 0 ? withoutBatchim : withBatchim;
}

function quote(lang: Lang, name: string): string {
  return lang === 'ko' ? `'${name}'` : `"${name}"`;
}

const LEGACY_REASONS: Array<[RegExp, (lang: Lang, m: RegExpMatchArray) => string]> = [
  [/^Approved by administrator$/i, (lang) => (lang === 'ko' ? '관리자 승인' : 'Approved by administrator')],
  [
    /^Changed status to ([A-Z_]+)$/,
    (lang, m) =>
      lang === 'ko' ? `상태를 '${tv(lang, 'status', m[1])}'(으)로 변경` : `Changed status to ${tv(lang, 'status', m[1])}`,
  ],
  [/^Operator CLI bootstrap$/i, (lang) => (lang === 'ko' ? '운영자 CLI로 최초 관리자 지정' : 'Operator CLI bootstrap')],
];

function localizeReason(lang: Lang, reason: string | null): string | null {
  if (!reason) return null;
  for (const [re, fn] of LEGACY_REASONS) {
    const m = reason.match(re);
    if (m) return fn(lang, m);
  }
  return reason;
}

export function formatAuditLog(
  log: AuditLogRecord,
  names: AuditNames,
  lang: Lang,
  displayTimeZone: string
): FormattedAudit {
  const ko = lang === 'ko';
  const L = (k: string, e: string) => (ko ? k : e);
  const before: Summary = log.beforeSummary || {};
  const after: Summary = log.afterSummary || {};
  const [idA, idB] = log.targetId.split(':');
  const unknown = L('(확인할 수 없는 항목)', '(unknown item)');

  const userName = (uid: string | null | undefined) =>
    (uid && names.users[uid]) || (uid ? L(`사용자 ${uid.slice(0, 6)}…`, `user ${uid.slice(0, 6)}…`) : unknown);
  const tenderName = (id: string | null | undefined) =>
    quote(lang, (id && names.tenders[id]) || L('삭제되었거나 확인할 수 없는 입찰', 'unknown tender'));
  const supplierName = (id: string | null | undefined) =>
    (id && names.suppliers[id]) || L('확인할 수 없는 업체', 'unknown company');
  const projectName = (id: string) =>
    quote(lang, names.projects[id] || s(after.name) || s(before.name) || L('확인할 수 없는 프로젝트', 'unknown project'));
  const fileName = (id: string) => quote(lang, names.files[id] || L('확인할 수 없는 파일', 'unknown file'));
  const role = (r: unknown) => (s(r) ? t(lang, `role.${s(r)}` as I18nKey) : L('없음', 'none'));
  const status = (v: unknown) => (s(v) ? tv(lang, 'status', s(v)) : L('없음', 'none'));
  const when = (iso: unknown) => (s(iso) ? formatDateTimeInZone(s(iso), displayTimeZone, lang) : L('미정', 'not set'));
  const change = (label: string, from: string, to: string) => (from === to ? null : `${label}: ${from} → ${to}`);

  const actor =
    log.actorUid === 'MALWARE_SCANNER_WORKER'
      ? L('악성코드 검사 시스템', 'Malware scanning service')
      : names.users[log.actorUid] || (log.actorRole === 'SYSTEM_BOOTSTRAP' ? L('시스템', 'System') : userName(log.actorUid));
  const actorRole =
    log.actorRole === 'SYSTEM_BOOTSTRAP' ? L('시스템', 'System') : t(lang, `role.${log.actorRole}` as I18nKey);

  let summary: string;
  const details: Array<string | null> = [];

  switch (log.action) {
    case 'ACCESS_REQUEST_SUBMITTED':
      summary = L('포털 이용을 신청했습니다.', 'Submitted a portal access request.');
      details.push(
        `${L('신청 구분', 'Requested type')}: ${role(after.requestedRole)}`,
        s(after.requestedCompanyOrDept) ? `${L('소속', 'Organization')}: ${s(after.requestedCompanyOrDept)}` : null,
        `${L('이메일 인증', 'Email verified')}: ${after.emailVerified ? L('완료', 'yes') : L('미완료', 'no')}`
      );
      break;
    case 'USER_APPROVED_OR_UPDATED': {
      const target = userName(log.targetId);
      summary =
        s(before.status) === 'ACTIVE'
          ? L(`${target}의 권한을 변경했습니다.`, `Updated access for ${target}.`)
          : L(`${target}의 이용 신청을 승인했습니다.`, `Approved access for ${target}.`);
      details.push(
        change(L('역할', 'Role'), role(before.role), role(after.role)),
        change(L('상태', 'Status'), status(before.status), status(after.status)),
        change(
          L('연결 업체', 'Linked company'),
          s(before.supplierCompanyId) ? supplierName(s(before.supplierCompanyId)) : L('없음', 'none'),
          s(after.supplierCompanyId) ? supplierName(s(after.supplierCompanyId)) : L('없음', 'none')
        )
      );
      break;
    }
    case 'USER_STATUS_REJECTED':
      summary = L(`${userName(log.targetId)}의 이용 신청을 거절했습니다.`, `Rejected the access request of ${userName(log.targetId)}.`);
      break;
    case 'USER_STATUS_DISABLED':
      summary = L(`${userName(log.targetId)} 계정을 사용 중지했습니다.`, `Disabled the account of ${userName(log.targetId)}.`);
      break;
    case 'OPERATOR_REVOKE_USER':
      summary = L(`운영자 도구로 ${userName(log.targetId)} 계정을 차단했습니다.`, `Revoked ${userName(log.targetId)} via operator tool.`);
      break;
    case 'BOOTSTRAP_OWNER_ADMIN':
      summary = L(`${userName(log.targetId)} 계정을 최초 소유 관리자로 지정했습니다.`, `Assigned ${userName(log.targetId)} as the initial owner admin.`);
      break;
    case 'PROJECT_CREATED': {
      const name = projectName(log.targetId);
      summary = L(`프로젝트 ${name}${josa(name, '을', '를')} 등록했습니다.`, `Created project ${name}.`);
      details.push(s(after.status) ? `${L('상태', 'Status')}: ${tv(lang, 'projectStatus', s(after.status))}` : null);
      break;
    }
    case 'PROJECT_UPDATED': {
      const name = projectName(log.targetId);
      summary = L(`프로젝트 ${name}의 정보를 수정했습니다.`, `Updated project ${name}.`);
      details.push(
        change(L('이름', 'Name'), s(before.name) || '', s(after.name) || ''),
        change(
          L('상태', 'Status'),
          tv(lang, 'projectStatus', s(before.status)),
          tv(lang, 'projectStatus', s(after.status))
        )
      );
      break;
    }
    case 'SUPPLIER_CREATED': {
      const name = quote(lang, supplierName(log.targetId) || s(after.name) || '');
      summary = L(`협력사 ${name}${josa(name, '을', '를')} 등록했습니다.`, `Added supplier ${name}.`);
      break;
    }
    case 'SUPPLIER_UPDATED': {
      const name = quote(lang, names.suppliers[log.targetId] || s(after.name) || unknown);
      summary = L(`협력사 ${name}의 정보를 수정했습니다.`, `Updated supplier ${name}.`);
      details.push(
        change(L('업체명', 'Name'), s(before.name) || '', s(after.name) || ''),
        change('NDA', tv(lang, 'nda', s(before.ndaStatus)), tv(lang, 'nda', s(after.ndaStatus)))
      );
      break;
    }
    case 'TENDER_DRAFT_CREATED': {
      const name = tenderName(log.targetId);
      summary = L(`입찰 ${name}${josa(name, '을', '를')} 임시 저장했습니다.`, `Saved tender ${name} as a draft.`);
      break;
    }
    case 'TENDER_PUBLISHED': {
      const name = tenderName(log.targetId);
      const invited = n(after.invitedCount) ?? 0;
      summary = L(
        `입찰 ${name}${josa(name, '을', '를')} 생성하고 협력사 ${invited}곳을 초청했습니다.`,
        `Published tender ${name} and invited ${invited} supplier(s).`
      );
      details.push(`${L('제출 마감', 'Deadline')}: ${when(after.deadlineAt)}`);
      break;
    }
    case 'TENDER_UPDATED': {
      const name = tenderName(log.targetId);
      summary = L(`입찰 ${name}${josa(name, '을', '를')} 수정했습니다.`, `Updated tender ${name}.`);
      details.push(
        n(before.revision) !== null && n(after.revision) !== null
          ? `${L('개정', 'Revision')}: rev.${n(before.revision)} → rev.${n(after.revision)}`
          : null,
        change(L('제출 마감', 'Deadline'), when(before.deadlineAt), when(after.deadlineAt)),
        change(
          L('공개 상태', 'Publication'),
          s(before.publicationState) === 'PUBLISHED' ? L('생성 완료', 'Published') : L('임시 저장', 'Draft'),
          s(after.publicationState) === 'PUBLISHED' ? L('생성 완료', 'Published') : L('임시 저장', 'Draft')
        )
      );
      break;
    }
    case 'TENDER_RFP_UPLOADED': {
      const name = tenderName(log.targetId);
      const count = n(after.fileCount) ?? 0;
      summary = L(`입찰 ${name}에 입찰 자료 ${count}건을 업로드했습니다.`, `Uploaded ${count} tender document(s) to ${name}.`);
      break;
    }
    case 'TENDER_RFP_VISIBILITY_CHANGED': {
      const name = fileName(log.targetId);
      summary = after.publishedToSuppliers
        ? L(`입찰 자료 ${name}${josa(name, '을', '를')} 협력사에 공개했습니다.`, `Shared tender document ${name} with suppliers.`)
        : L(`입찰 자료 ${name}${josa(name, '을', '를')} 내부 전용으로 전환했습니다.`, `Made tender document ${name} internal only.`);
      break;
    }
    case 'TENDER_COMPANY_USERS_ASSIGNED': {
      const prev = Array.isArray(before.assignedUserIds) ? (before.assignedUserIds as string[]) : [];
      const next = Array.isArray(after.assignedUserIds) ? (after.assignedUserIds as string[]) : [];
      const added = next.filter((u) => !prev.includes(u)).map(userName);
      const removed = prev.filter((u) => !next.includes(u)).map(userName);
      summary = L(
        `입찰 ${tenderName(idA)}의 ${supplierName(idB)} 접근 계정을 변경했습니다.`,
        `Changed ${supplierName(idB)} accounts for tender ${tenderName(idA)}.`
      );
      details.push(
        added.length ? `${L('추가', 'Added')}: ${added.join(', ')}` : null,
        removed.length ? `${L('제외', 'Removed')}: ${removed.join(', ')}` : null
      );
      break;
    }
    case 'INVITATION_TOKEN_CREATED':
      summary = L(
        `입찰 ${tenderName(s(after.tenderId))} 초청 링크를 발급했습니다.`,
        `Issued an invitation link for tender ${tenderName(s(after.tenderId))}.`
      );
      details.push(
        s(after.normalizedEmail) ? `${L('대상', 'Recipient')}: ${s(after.normalizedEmail)}` : null,
        `${L('업체', 'Company')}: ${supplierName(s(after.companyId))}`,
        `${L('만료', 'Expires')}: ${when(after.expiresAt)}`
      );
      break;
    case 'INVITATION_TOKEN_REVOKED':
      summary = L(
        `입찰 ${tenderName(s(after.tenderId))}의 ${supplierName(s(after.companyId))} 초청 링크를 회수했습니다.`,
        `Revoked the ${supplierName(s(after.companyId))} invitation link for tender ${tenderName(s(after.tenderId))}.`
      );
      break;
    case 'INVITATION_TOKEN_CLAIMED':
      summary = L(
        `입찰 ${tenderName(log.targetId)} 초청을 수락했습니다.`,
        `Accepted the invitation to tender ${tenderName(log.targetId)}.`
      );
      details.push(`${L('업체', 'Company')}: ${supplierName(s(after.companyId))}`);
      break;
    case 'SUPPLIER_SUBMISSION_FINALIZED': {
      const version = n(after.versionNumber);
      summary = L(
        `${supplierName(idB)}이(가) 입찰 ${tenderName(idA)}에 제안서를 제출했습니다.`,
        `${supplierName(idB)} submitted a proposal to tender ${tenderName(idA)}.`
      );
      details.push(
        s(after.receiptNumber) ? `${L('접수번호', 'Receipt')}: ${s(after.receiptNumber)}` : null,
        version !== null ? `${L('버전', 'Version')}: v${version}` : null,
        n(after.fileCount) !== null ? `${L('파일', 'Files')}: ${n(after.fileCount)}${L('건', '')}` : null
      );
      break;
    }
    case 'FILE_SCAN_VERDICT_RECORDED': {
      const name = fileName(log.targetId);
      summary = L(
        `파일 ${name}의 보안 검사 결과를 기록했습니다.`,
        `Recorded the security scan result for ${name}.`
      );
      details.push(`${L('결과', 'Result')}: ${tv(lang, 'scan', s(after.scanStatus))}`);
      break;
    }
    case 'TENANT_SETTINGS_UPDATED':
      summary = L('운영 설정을 변경했습니다.', 'Updated portal settings.');
      details.push(
        change(
          L('파일당 최대 용량', 'Max file size'),
          `${n(before.maxFileSizeMb) ?? '—'}MB`,
          `${n(after.maxFileSizeMb) ?? '—'}MB`
        ),
        change(L('표시 시간대', 'Display time zone'), s(before.displayTimeZone) || '—', s(after.displayTimeZone) || '—')
      );
      break;
    default:
      if (log.action.startsWith('USER_STATUS_')) {
        const next = log.action.slice('USER_STATUS_'.length);
        summary = L(
          `${userName(log.targetId)}의 계정 상태를 '${status(next)}'(으)로 변경했습니다.`,
          `Changed the account status of ${userName(log.targetId)} to ${status(next)}.`
        );
      } else {
        summary = log.action;
      }
  }

  return {
    actor,
    actorRole,
    summary,
    details: details.filter((d): d is string => Boolean(d)),
    reason: localizeReason(lang, log.reason),
  };
}
