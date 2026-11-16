# 권한 모델 및 보안 경계 (`PERMISSIONS.md`)

## 1. 역할 및 계정 접근 상태 Enum

### 역할 (`role`)
- `ADMIN`: 구매팀 관리자 (해당 `tenantId` 내부 전사 관리 권한)
- `USER_DEPARTMENT`: 사용자부서 (승인된 협력사 Pool 디렉터리 열람 전용)
- `SUPPLIER`: 외부 협력사 (본인 업체 + 관리자가 입찰별로 배정한 입찰만 접근)

### 계정 접근 상태 (`membership.status`)
- `PENDING`: 회원가입 및 이메일 인증 후 관리자 승인 대기
- `ACTIVE`: 관리자 승인이 완료되어 배정된 역할로 접근 가능
- `REJECTED`: 가입 신청 거절
- `DISABLED`: 관리자 정지 / 비활성화

> **원칙**: `PENDING / REJECTED / DISABLED`는 역할이 아니라 계정 접근 상태다. 미인증 이메일 또는 `status !== 'ACTIVE'` 계정은 본인 계정 상태 조회, 인증 이메일 재발송, 로그아웃 외 모든 업무 API와 Storage 경로가 거부된다.

---

## 2. 역할별 기능 권한표

| 기능 | `ADMIN` (동일 tenant) | `USER_DEPARTMENT` | `SUPPLIER` |
|---|---|---|---|
| 관리자 대시보드 (`/admin/dashboard`) | 전체 열람 및 본인 할 일 관리 | 불가 (403) | 불가 (403) |
| 프로젝트 등록·수정·조회 (`/admin/projects`) | 동일 tenant 전체 | 불가 (403) | 초청 입찰에 필요한 프로젝트 요약명/위치만 |
| 입찰 등록·수정·제출현황 (`/admin/tenders`) | 동일 tenant 전체 | 불가 (403) | 본인에게 허용(`access/{uid}`)된 공개 입찰만 |
| 협력사 Pool (`/admin/suppliers`, `/department/suppliers`) | 등록·수정·열람 전체 | `supplierDirectory` 허용 필드만 열람 | 전체 Pool 접근 불가 (403) |
| 입찰 초청업체 / 경쟁사 목록 | 열람·관리 | 불가 (403) | **절대 불가** (응답 JSON/HTML/로그 포함 완전 제거) |
| 업체별 제안서·견적·제출파일 | 열람·다운로드 | 불가 (403) | 본인 업체 + 배정(`access/{uid}`)된 입찰의 자사 제출물만 |
| 입찰 자료 / RFP 다운로드 | 전체 | 불가 (403) | 초청 입찰의 공개(`publishedToSuppliers === true`)된 RFP만 |
| 회원 승인·권한·업체 연결 (`/admin/users`) | 관리 (`canManageAdmins` 구분) | 불가 (403) | 불가 (403) |
| 감사로그 / 운영 설정 (`/admin/audit`, `/admin/settings`) | 열람·관리 | 불가 (403) | 불가 (403) |

---

## 3. 세부 보안 규칙

### 3.1 회원가입 및 승인
1. 공개 회원가입(`/signup`)에서는 `USER_DEPARTMENT`와 `SUPPLIER`만 신청 가능하며, 요청 본문에 `role=ADMIN`, `status=ACTIVE`, `supplierCompanyId`를 주입해도 서버에서 무시한다.
2. 이메일 인증 완료(`email_verified === true`) 및 관리자 명시적 승인 전까지 `memberships/{uid}`는 `status: 'PENDING', role: null, supplierCompanyId: null`을 유지한다.
3. 협력사 계정은 회사명 문자열이나 이메일 도메인으로 자동 연결하지 않고, 관리자가 Pool의 불변 `supplierCompanyId`를 선택해 연결한다. 동일 회사의 추가 직원도 개별 승인 절차를 거친다.
4. **회사 소속 승인 ≠ 입찰 접근 권한**: 동일 `supplierCompanyId` 소속이라도 관리자가 해당 입찰의 `access/{uid}` grant를 부여하기 전까지는 입찰 열람/제출이 불가하다. 같은 입찰에 함께 배정된 동일 회사 사용자는 자사 제출 이력과 파일을 공유할 수 있다.

### 3.2 관리자 계층 및 최근 재인증
- `canManageAdmins: true` (최초 bootstrap 소유 관리자 또는 소유 관리자가 명시 위임한 관리자)만 `ADMIN` 임명/해제/정지가 가능하다. 일반 `ADMIN`은 `USER_DEPARTMENT`와 `SUPPLIER`만 승인·관리할 수 있다.
- 해당 `tenantId`의 **마지막 활성 관리자**(`status === 'ACTIVE' && role === 'ADMIN'`)는 삭제·강등·정지할 수 없다.
- 회원 승인, 역할 변경, 상태 정지, 협력사 재연결 시에는 최근 5분 이내 재인증(`X-Reauth-Token`의 `auth_time` 검증)을 요구한다.
- 역할 변경·정지·회사 재연결 시:
  1. 기존 입찰 `access/{uid}` grant 즉시 비활성화/회수
  2. `memberships/{uid}`의 `authzVersion` 증가 및 상태/역할 갱신
  3. Firebase Auth refresh token 폐기 (`revokeRefreshTokens`) 및 Custom Claims 최소 동기화 (`tenantId`, `role`, `status`, `authzVersion`)
  4. 다음 보호 요청에서 Session Cookie의 `auth_time`/claims와 Firestore `memberships/{uid}`의 `status`·`authzVersion`을 대조해 즉시 차단

### 3.3 협력사 응답 비노출 규칙
- 협력사 API(`/api/supplier/**`)는 관리자 원장(`tenders/{tenderId}`)을 직렬화하지 않고, 전용 projection(`supplierViews/{companyId}`) + 자사 제출 패키지(`submissions/{companyId}`)만 allowlist DTO로 반환한다.
- 관리자 상태 `RECEIVING`은 협력사에게 노출하지 않는다. 협력사는 오직 `submissionWindowState: 'OPEN' | 'CLOSED'`와 `ownSubmissionState: 'NOT_SUBMITTED' | 'SUBMITTED'`만 수신한다.

### 3.4 모든 보호 경로의 8단계 인가 순서 (`authorize(action, actor, resource)`)
1. Session Cookie 서명·만료·프로젝트·폐기 여부 검증 (`verifySessionCookie(..., true)`)
2. `emailVerified === true` 및 `memberships/{uid}.status === 'ACTIVE'` 검증
3. 서버 저장 원장(`memberships/{uid}`)에서 `tenantId`, `role`, `supplierCompanyId`, `authzVersion`, `canManageAdmins` 확정
4. 요청 대상 리소스의 `tenantId` 일치 검증
5. `action`에 필요한 역할(`ADMIN` / `USER_DEPARTMENT` / `SUPPLIER`) 및 `canManageAdmins` 검증
6. `SUPPLIER`인 경우 유효한 `access/{uid}` (`enabled === true`, `companyId === membership.supplierCompanyId`) 및 `participants/{companyId}` 참가 관계 검증
7. 파일/제출물 접근 시 `tenantId`, `tenderId`, `companyId`, `scanStatus`, `publishedToSuppliers` 소유·공개 범위 검증
8. Allowlist DTO 응답 (`Cache-Control: private, no-store`) 및 감사로그 기록
