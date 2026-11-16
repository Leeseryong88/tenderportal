# 시스템 아키텍처 (`ARCHITECTURE.md`)

## 1. 기술 스택 및 책임 분리

| 계층 | 기술 선택 | 역할 및 제약 |
|---|---|---|
| 프론트엔드 / SSR | Next.js App Router + TypeScript | 반응형 UI, key 기반 `en`/`ko` 다국어, Client Firebase Auth + Storage 직접 업로드 |
| 서버 API / BFF | Next.js Route Handlers (Node.js runtime) | `firebase-admin` 전용 실행, Session Cookie 검증, Zod 입력 검증, `authorize()` 인가, Transaction 처리 |
| 인증 | Firebase Authentication | Email/Password, 이메일 인증, 비밀번호 재설정, 선택적 Google 로그인, `revokeRefreshTokens` |
| 데이터베이스 | Cloud Firestore (`(default)`) | 업무 원장 + Projection 컬렉션. **클라이언트 SDK 직접 read/write 전면 차단 (`firestore.rules`)** |
| 파일 저장소 | Cloud Storage for Firebase (비공개 버킷) | `staging/...` 직접 업로드 + `protected/...` 서버 승격 보관. API 본문 바이너리 미통과 |
| 검증/테스트 | Firebase Emulator Suite + Vitest + Playwright | Rules 격리 테스트, API 인가 통합 테스트, 역할별 E2E 테스트 |

---

## 2. 인증 & 세션 아키텍처

- **인증 방식 통일**: 모든 보호 API 및 SSR 페이지는 HttpOnly/SameSite=Lax/(Prod: Secure) **Firebase Session Cookie (`__session`)**를 기준으로 인증한다.
- **CSRF 및 Origin 방어**: 모든 상태 변경(`POST`, `PATCH`, `PUT`, `DELETE`) API는 `Origin`/`Referer`가 `ALLOWED_ORIGINS`에 속하는지 검증하고 `X-Requested-With: XMLHttpRequest` 또는 `application/json` 요청 헤더 검증을 수행한다.
- **Storage SDK 동기화**: 클라이언트 Firebase Storage SDK는 Firebase Auth ID token을 사용한다. 로그아웃이나 관리자 정지/권한변경 시:
  - 서버: `revokeRefreshTokens(uid)` + `memberships/{uid}` (`status`, `authzVersion`) + `access/{uid}` (`enabled: false`) 즉시 갱신
  - Storage Rules: `firestore.get(...)`로 최신 `memberships/{uid}`와 `access/{uid}`를 평가하여 오래된 토큰에서도 업로드/다운로드 차단
  - 클라이언트: 세션 불일치(401/403) 감지 시 즉시 `signOut(auth)` 및 메모리/상태 캐시 초기화
- **캐시 격리**: 모든 비공개 API 응답에 `Cache-Control: private, no-store, no-cache, must-revalidate`를 적용하고, SSR 페이지는 `export const dynamic = 'force-dynamic'`으로 사용자 간 RSC/데이터 캐시 혼입을 차단한다.

---

## 3. Firestore 데이터 모델 및 Projection 경계

```text
/accountProfiles/{uid}
  - uid, email, displayName, phone, departmentOrCompany, createdAt, updatedAt
/accessRequests/{uid}
  - uid, verifiedEmail, displayName, phone, requestedRole('USER_DEPARTMENT'|'SUPPLIER'),
    requestedCompanyOrDept, status('PENDING'|'ACTIVE'|'REJECTED'|'DISABLED'),
    decisionByUid, decisionReason, decidedAt, createdAt, updatedAt
/memberships/{uid}   [서버 전용 권한 원장]
  - tenantId, role('ADMIN'|'USER_DEPARTMENT'|'SUPPLIER'|null),
    status('PENDING'|'ACTIVE'|'REJECTED'|'DISABLED'),
    supplierCompanyId, authzVersion, canManageAdmins, updatedAt, updatedByUid
/invitationTokens/{tokenHash}   [서버 전용]
  - tokenHash, tenantId, tenderId, companyId, normalizedEmail, expiresAt,
    createdByUid, createdAt, consumedAt, consumedByUid, revokedAt, revokedByUid
/tenants/{tenantId}/settings/default
  - organizationName, displayTimeZone, defaultLanguage, maxFileSizeMb,
    allowedExtensions, inviteExpiryDays, updatedAt, updatedByUid
/tenants/{tenantId}/tasks/{taskId}
  - tenantId, title, projectId, dateLocal, priority, done, createdByUid, updatedAt
/tenants/{tenantId}/suppliers/{supplierCompanyId}   [ADMIN 전용 원장]
  - id, tenantId, name, countryCode, countryName, city, categories,
    coverage: [{ countryCode, subdivisionCode?, cityName?, displayName, deliveryMode }],
    legacyUnmappedCoverage?, contacts: [{ countryCode, countryName, city, name, email, phone }],
    website, ndaStatus, ndaSignedDate, license, licenseStatus, licenseExpiry,
    status('Active'|'Inactive'), internalNotes?, createdAt, updatedAt
/tenants/{tenantId}/supplierDirectory/{supplierCompanyId}   [USER_DEPARTMENT 허용 projection]
  - id, tenantId, name, countryCode, countryName, city, categories,
    coverage, contacts(업무연락처만), website, ndaStatus, ndaSignedDate,
    license, licenseStatus, licenseExpiry, status
    (NDA 원본, 내부 평가 메모, 입찰이력, 금액, 제출자료 제외)
/tenants/{tenantId}/projects/{projectId}
  - id, tenantId, code, name, countryCode, countryName, city, type, owner, status,
    timeZone, dateLocal, masterSchedule(8단계: UNSET|NOT_APPLICABLE|PLANNED),
    createdAt, updatedAt, createdByUid
/tenants/{tenantId}/tenders/{tenderId}   [ADMIN 전용 입찰 원장]
  - id, tenantId, code, projectId, name, type, publicationState('DRAFT'|'PUBLISHED'),
    deadlineAt(UTC ISO/Timestamp), timeZone, requiredDocuments, description,
    schedule(8단계), scheduleSources(단계별 'INHERITED'|'OVERRIDE'),
    invitedCompanyIds, receivedCompanyIds, receivedCompanyCount,
    revision, lastChangeReason, publishedAt, createdAt, updatedAt, createdByUid
/tenants/{tenantId}/tenders/{tenderId}/participants/{companyId}
  - companyId, tenantId, tenderId, invitedAt, invitedByUid, assignedUserIds,
    hasSubmitted, latestVersionId, latestReceiptNumber, latestSubmittedAt
/tenants/{tenantId}/tenders/{tenderId}/access/{uid}   [Storage Rules 및 인가 projection]
  - uid, tenantId, tenderId, companyId, enabled, published, deadlineAt
    (경쟁사 정보 전혀 미포함)
/tenants/{tenantId}/tenders/{tenderId}/supplierViews/{companyId}   [협력사 공개 projection]
  - tenderId, tenantId, code, projectId, projectName, projectLocation,
    name, type, deadlineAt, timeZone, requiredDocuments, description,
    schedule, published, publishedAt, rfpFiles(공개된 RFP 메타데이터만)
/tenants/{tenantId}/tenders/{tenderId}/submissions/{companyId}/versions/{versionId}
  - versionId, versionNumber, receiptNumber, tenantId, tenderId, companyId,
    submittedByUid, acceptedAt(Server Timestamp), idempotencyKey, files(manifest[])
/tenants/{tenantId}/files/{fileId}
  - id, tenantId, tenderId, companyId, ownerScope('RFP'|'SUBMISSION'),
    kind, originalName, contentType, sizeBytes, sha256, storagePath,
    objectGeneration, scanStatus('PENDING'|'CLEAN'|'INFECTED'|'FAILED'),
    publishedToSuppliers, uploadedByUid, finalizedAt, versionId
/tenants/{tenantId}/uploadIntents/{intentId}
  - id, tenantId, tenderId, companyId, uid, ownerScope, originalName,
    declaredContentType, declaredSizeBytes, maxSizeBytes, stagingPath,
    fileId, expiresAt, consumedAt, createdAt
/tenants/{tenantId}/auditLogs/{eventId}   [불변 감사로그]
  - id, tenantId, requestId, actorUid, actorRole, action, targetType, targetId,
    beforeSummary, afterSummary, reason, createdAt
```

---

## 4. 파일 업로드 · 접수 · 다운로드 흐름

1. **업로드 의도 발행**: 클라이언트가 `/api/supplier/tenders/[tenderId]/upload-intents` (또는 관리자 `/api/admin/tenders/[tenderId]/rfp-intents`) 호출 → 서버가 현재 권한·마감·확장자·크기(기본 50MB) 검증 후 `uploadIntents/{intentId}` 생성 및 `stagingPath` 반환.
2. **Storage 직접 업로드**: 클라이언트가 Firebase Storage SDK(`uploadBytesResumable`)로 `staging/{tenantId}/{tenderId}/{companyId}/{uid}/{intentId}/{fileId}`에 직접 업로드. Storage Rules는 `request.auth.uid`, `memberships/{uid}`, `tenders/{tenderId}/access/{uid}`, `request.time < grant.deadlineAt`를 검증하고 overwrite/delete/list를 차단한다.
3. **제출 확정 (`finalize`)**:
   - 클라이언트가 `/api/supplier/tenders/[tenderId]/submit`에 `intentIds` + `idempotencyKey` 전달.
   - 서버가 Storage에서 실제 객체 존재·크기·generation·magic bytes(PDF/Office/ZIP/이미지 등)를 검증하고, 위험 실행형 파일(HTML/SVG/EXE/스크립트) 및 zip bomb 의심 여부를 확인한다.
   - 검증된 객체를 `protected/{tenantId}/{tenderId}/submissions/{companyId}/{versionId}/{fileId}`로 서버 복사 후 `staging` 객체를 정리한다.
   - Firestore Transaction에서 `now < deadlineAt`, `access/{uid}.enabled`, `idempotencyKey` 중복 여부를 최종 확인한 뒤 불변 `versions/{versionId}`와 접수번호(`RCP-...`), `acceptedAt`, `receivedCompanyCount`를 원자적으로 기록한다.
   - 마감 전에 업로드를 시작했더라도 `finalize` 시점 서버 시각이 `deadlineAt` 이후면 접수를 거부한다.
4. **악성코드 검사 미사용**:
   - 별도 악성코드 검사는 하지 않으며, 확장자·매직바이트 검증을 통과한 파일은 `scanStatus: 'CLEAN'`으로 기록되어 즉시 다운로드 가능하다.
   - `scanStatus` 필드는 기존 데이터 호환용으로만 남아 있으며 다운로드 권한 판단에 쓰이지 않는다.
5. **다운로드**:
   - 클라이언트 요청 시 `/api/files/[fileId]/download`에서 매번 8단계 인가를 수행하고 `Content-Disposition: attachment; filename*=UTF-8''...` 및 `X-Content-Type-Options: nosniff`로 안전하게 제공하거나, Storage SDK 인증 읽기를 사용한다. `getDownloadURL` 장기 토큰 및 공개 버킷은 사용하지 않는다.
