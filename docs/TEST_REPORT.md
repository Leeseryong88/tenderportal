# 테스트 검증 보고서 (`TEST_REPORT.md`)

검증 일시: 2026-11-16  
실행 환경: Windows 10 (`Node.js v20.20.2`, `OpenJDK 21`, `firebase-tools 15.36.0`, `Next.js 15.5.12`)

---

## 1. 실행 및 통과 항목

| 구분 | 명령어 | 결과 | 검증 내용 |
|---|---|---|---|
| **정적 타입 검사** | `npm run typecheck` | **PASS** (0 errors) | 전체 TypeScript strict 컴파일 및 API/도메인/컴포넌트 타입 검증 |
| **ESLint 검사** | `npm run lint` | **PASS** (0 errors, 0 warnings) | `next/core-web-vitals`, `next/typescript` 규칙 통과 |
| **프로덕션 빌드** | `npm run build` | **PASS** (Exit 0) | App Router 전체 38개 경로/API Route Handler 프로덕션 번들 빌드 완료 |
| **단위 테스트 (10/10)** | `npm run test:unit` | **PASS** (10/10) | - 일정 `NOT_APPLICABLE`/`UNSET` 저장 시 `dateLocal: null` 유지 및 상속/별도설정 전파<br>- DST Spring-forward 미존재 시각 거부 및 Fall-back 이중 시각 오프셋 판별<br>- 해외 현지 마감일 ↔ `Asia/Seoul` 달력 일자 차이 계산<br>- 서버 시각 기준 `DRAFT`/`OPEN`/`RECEIVING`/`CLOSED` 상태 동적 계산<br>- `Australia`/`AUS`/`호주`/`오스트레일리아` → `AU`, `Texas` → `US-TX` 정규화<br>- 미국 특정 주(`US-TX`) vs 국가 전체(`US`) 우선순위 규칙<br>- `SupplierDirectoryDTO`의 내부 메모 제거<br>- 회원가입 schema mass assignment (`role=ADMIN`, `approved=true`) 차단<br>- SVG/HTML 위장 파일 매직바이트 차단 및 EICAR 시그니처 탐지 |
| **Firebase Rules 테스트 (2/2)** | `npm run test:rules` (Emulator 실행) | **PASS** (2/2) | - 모든 역할(`ADMIN`/`SUPPLIER`/`PENDING`)의 Firestore 직접 read/write 전면 거부 확인<br>- Storage `staging/...` 본인 UID·회사·이메일 인증·마감 전(`request.time < deadlineAt`) create 허용 및 덮어쓰기 차단<br>- 미인증 이메일, 동일 회사 미배정 계정(A2), 마감 후 업로드, 경쟁사 파일 읽기, `listAll`, `protected/` 직접 write, `PENDING` 스캔 파일 읽기 차단 |
| **서버 인가 통합 테스트 (5/5)** | `npm run test:integration` (Emulator 실행) | **PASS** (5/5) | - `PENDING` / `DISABLED` 계정 업무 API 차단<br>- 회원가입 payload 권한 상승 시도 400 차단<br>- `USER_DEPARTMENT`의 Pool projection 외 Admin/Supplier/File API 403 차단<br>- 협력사 A1/A2(동일회사 미배정)/B1(경쟁사)/타 tenant 관리자 X 상호 격리 및 `supplierViews` 경쟁사/상태(`RECEIVING`) 비노출 검증<br>- `authzVersion` 변경 시 기존 세션 쿠키 즉시 401 차단 및 마지막 활성 관리자 보호 확인 |

---

## 2. 미실행 항목 및 사유 (배포 연결 후 검증 필요)

| 항목 | 미실행 사유 | 재현 및 검증 절차 |
|---|---|---|
| **Playwright 브라우저 E2E (`tests/e2e/portal.spec.ts`)** | 로컬 브라우저 실행 데몬과 Next.js + Emulator 동시 상주 기동 대신 API/Rules/Build 검증을 우선 수행함 (E2E 스펙 파일 작성 완료) | 터미널 1: Firebase Emulators 기동 + `seed-dev.ts`<br>터미널 2: `npm run dev`<br>터미널 3: `npx playwright install chromium && $env:RUN_PLAYWRIGHT_E2E="true"; npm run test:e2e` |
| **실제 Firebase/Vercel 환경 검증** | Git 저장소, Firebase API/Service Account, Vercel 프로젝트 연결을 구현 이후 진행하기로 예약됨 | 1. Staging Firebase 프로젝트에 `firestore.rules`, `storage.rules`, `firestore.indexes.json`, `storage.cors.json` 배포<br>2. Vercel Preview 환경 연결 후 이메일 인증 메일 발송, Storage CORS 직접 업로드(4.5MB 초과 파일 포함), App Check, 외부 악성코드 스캐너 웹훅(`/api/internal/malware-scan`) 실동작 확인 |

---

## 3. 보안상 한계 및 운영 전환 전 필수 확인사항
1. **악성코드 검사**: 로컬 개발 모드(`MALWARE_SCANNER_MODE=local_signature_dev`)는 확장자·매직바이트·EICAR 시그니처만 검사하며, 운영(`NODE_ENV=production`)에서는 자동 비활성화되고 파일을 `PENDING`으로 보류합니다. 운영 전환 전 Cloud Run / ClamAV 등 외부 검사 워커를 연결해 `/api/internal/malware-scan`을 호출해야 합니다.
2. **이메일 발송**: 초청 링크는 생성 후 관리자가 복사해 직접 전달하는 구조이며, 자동 이메일 발송 기능은 포함되어 있지 않습니다.
3. **이미 다운로드된 파일**: 권한이 있던 사용자가 로컬 기기에 다운로드 완료한 파일은 이후 접근을 회수해도 원격 삭제할 수 없습니다.
