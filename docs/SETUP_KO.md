# IICOMBINED Tender Portal — 운영자 구축 설명서 (`SETUP_KO.md`)

이 문서는 IT팀에 의존하지 않고 운영자가 직접 **Git 저장소 · Firebase · Vercel**을 연결해 시험(Staging/Preview) 및 운영(Production) 환경을 구축하는 순서를 안내합니다.

---

## A. 계정 소유권 및 환경 분리 원칙
1. **조직 소유 계정 사용**: Firebase/Google Cloud, Vercel, GitHub 저장소는 개인 계정이 아닌 IICOMBINED 조직 계정 소유로 생성하고 소유자/복구 담당자를 지정합니다.
2. **환경 3분리**:
   - **로컬 개발**: Firebase Emulator Suite (`demo-iicombined-tender`)
   - **시험용(Staging / Vercel Preview)**: 시험용 Firebase 프로젝트 (예: `iicombined-tender-staging`)
   - **운영용(Production)**: 운영용 Firebase 프로젝트 (예: `iicombined-tender-prod`)
3. **절대 금지**: 운영용 `FIREBASE_PRIVATE_KEY`나 운영 DB/Storage를 Vercel Preview/PR 환경에 연결하지 않습니다.

---

## B. Firebase Console 설정 순서
1. **프로젝트 생성 및 Web App 등록**
   - [Firebase Console](https://console.firebase.google.com/)에서 프로젝트 생성 → `Project Settings` → `Your apps` → Web 앱(`</>`) 등록.
   - Firestore, Cloud Storage, Auth 사용 리전/데이터 보관 위치를 사내 정책에 맞게 선택하고 기록합니다(예: `asia-northeast3` 서울).
2. **Authentication 설정**
   - `Build > Authentication > Sign-in method`: **Email/Password** 활성화(이메일 링크 로그인은 선택). Google 로그인을 쓸 경우에만 Google 공급자를 켜고, 앱 환경변수 `NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN=true`로 설정합니다(승인 절차를 우회하지 않습니다).
   - `Templates`: 이메일 인증·비밀번호 재설정 템플릿의 Action URL 도메인을 실제 서비스 도메인에 맞춥니다.
   - `Settings > Authorized domains`: `localhost`, Vercel Preview 도메인, 실제 운영 도메인을 등록합니다.
   - **참고**: 회원가입을 완료한 `PENDING` 상태 사용자도 Firebase Auth 계정 자체는 생성되지만, 포털 업무 접근은 서버의 `memberships/{uid}` 원장과 이메일 인증 여부로 차단됩니다.
3. **Cloud Firestore 생성 및 Rules/인덱스 배포**
   - `Build > Firestore Database` 생성 시 **테스트 모드(공개 Rules)를 절대 선택하지 않고** Production 모드로 생성합니다.
   - 저장소의 `firestore.rules`, `firestore.indexes.json`을 배포합니다:
     ```bash
     npx --yes firebase-tools@latest login
     npx --yes firebase-tools@latest use <YOUR_PROJECT_ID>
     npx --yes firebase-tools@latest deploy --only firestore:rules,firestore:indexes
     ```
4. **Cloud Storage 생성 · 비공개 Rules · CORS · Cross-Service 권한**
   - `Build > Storage` 생성 (Cloud Storage for Firebase 이용 요금제는 2024년 9월 변경 정책에 따라 Blaze 요금제 연결이 필요할 수 있으므로 최신 공식 요금제를 확인하고 결제/예산 알림을 설정합니다. **주의: 예산 알림은 자동 지출 상한 차단이 아닙니다.**).
   - `storage.rules` 배포:
     ```bash
     npx --yes firebase-tools@latest deploy --only storage
     ```
   - `storage.cors.json`의 `origin`을 실제 Vercel/운영 도메인으로 수정한 뒤 버킷 CORS 적용:
     ```bash
     gcloud storage buckets update gs://<YOUR_STORAGE_BUCKET> --cors-file=storage.cors.json
     ```
   - **필수 (Storage Rules의 Firestore 교차 조회 권한)**: `storage.rules`가 `firestore.get(...)`로 멤버십·입찰 접근권을 확인하므로, Storage 서비스 에이전트 `service-<프로젝트번호>@gcp-sa-firebasestorage.iam.gserviceaccount.com`에 `roles/firebaserules.firestoreServiceAgent`(Firebase Rules Firestore Service Agent) 역할이 있어야 합니다. 이 역할이 없으면 규칙의 Firestore 조회가 모두 실패해 협력사 제출·관리자 RFP 업로드가 `storage/unauthorized`로 거부됩니다.
     - Firebase CLI는 **대화형 터미널**에서 `deploy --only storage`를 실행하고 규칙 내용이 바뀌었을 때만 "Grant the new role?"을 묻습니다. CI·자동화 셸(비대화형)이나 규칙이 이미 최신이면 이 단계를 **조용히 건너뜁니다.**
     - 확인/부여: Google Cloud Console > IAM 및 관리자 > IAM > "Google 제공 역할 부여 포함" 체크 후 위 서비스 에이전트에 해당 역할이 있는지 확인하고, 없으면 "액세스 권한 부여"로 추가합니다.
5. **App Check 설정**
   - `Build > App Check`에서 Web App을 reCAPTCHA Enterprise로 등록하고 Site Key를 `NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY`에 설정합니다.
   - 개발용 Debug Token은 절대 운영 환경에 배포하지 않습니다.
6. **백업 / PITR / MFA**
   - Firestore Point-in-Time Recovery(PITR) 및 일일 내보내기 백업, Storage Object Versioning 활성화를 권장합니다.
   - 관리자 계정은 Google Cloud / Firebase MFA 지원 구성을 적용할 수 있도록 운영 정책을 정합니다.

---

## C. 서버 자격증명 (Firebase Admin SDK)
- **권장(비밀키 없음)**: Vercel 프로젝트가 OIDC / Google Cloud Workload Identity Federation을 지원하는 경우 별도 JSON 키 없이 ADC로 연동합니다.
- **Service Account 키 방식 사용 시**:
  1. GCP IAM에서 전용 최소 권한 Service Account 생성 (Project `Owner`/`Editor` 전체 권한 부여 금지. Firebase Auth 관리 + Firestore/Storage 읽기쓰기 최소 역할만 부여).
  2. JSON 키 발급 후 Vercel 서버 전용 환경변수(`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`)에만 입력합니다.
  3. **절대 금지**: Private key를 Git, 브라우저 코드, `NEXT_PUBLIC_` 변수에 넣지 마십시오.
  4. **참고**: `NEXT_PUBLIC_FIREBASE_API_KEY` 등 Web Config 값은 클라이언트 공개 식별자이며 보안은 Firebase Rules와 서버 API 인가로 보장됩니다.

---

## D. 환경변수 매핑표

| 변수명 | 출처 | 서버 전용 | Dev (Emulator) | Preview (Staging) | Production |
|---|---|---|---|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase Web App 설정 | 아니오 | `demo-api-key` | Staging 값 | Prod 값 |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase Web App 설정 | 아니오 | `demo...` | Staging 도메인 | Prod 도메인 |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase 프로젝트 ID | 아니오 | `demo-iicombined-tender` | Staging ID | Prod ID |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Firebase Storage 버킷 | 아니오 | `demo...` | Staging 버킷 | Prod 버킷 |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase Web App 설정 | 아니오 | `000000` | Staging 값 | Prod 값 |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase Web App 설정 | 아니오 | `1:000:web:demo` | Staging 값 | Prod 값 |
| `NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY` | Firebase App Check | 아니오 | 빈 값 | Staging key | Prod key |
| `NEXT_PUBLIC_USE_FIREBASE_EMULATORS` | 로컬 에뮬레이터 스위치 | 아니오 | `true` | 미설정/`false` | 미설정/`false` |
| `FIREBASE_PROJECT_ID` | Service Account | **예** | `demo-iicombined-tender` | Staging ID | Prod ID |
| `FIREBASE_CLIENT_EMAIL` | Service Account | **예** | (Emulator 불필요) | Staging SA | Prod SA |
| `FIREBASE_PRIVATE_KEY` | Service Account | **예** | (Emulator 불필요) | Staging Key | Prod Key |
| `FIREBASE_STORAGE_BUCKET` | Firebase Storage | **예** | `demo...` | Staging 버킷 | Prod 버킷 |
| `APP_BASE_URL` | 서비스 기본 URL | **예** | `http://localhost:3000` | Staging URL | Prod URL |
| `ALLOWED_ORIGINS` | 허용 Origin 목록(콤마) | **예** | `http://localhost:3000` | Staging URL | Prod 도메인들 |
| `MALWARE_SCANNER_MODE` | 파일 검사 방식 | **예** | `local_signature_dev` | `webhook` | `webhook` |
| `MALWARE_SCANNER_WEBHOOK_SECRET` | 검사 워커 비밀키 | **예** | 빈 값 | Staging secret | Prod secret |

---

## E. Vercel 연결 및 배포
1. Git 저장소를 Vercel에 Import (Framework Preset: `Next.js`, Node.js `20.x`).
2. Preview 환경에는 시험용 Firebase 변수를, Production 환경(`main`)에는 운영용 Firebase 변수를 분리 입력합니다.
3. 대용량 견적/도면 파일은 Vercel API 본문을 거치지 않고 클라이언트에서 Firebase Storage로 직접 업로드됩니다(Vercel 4.5MB 요청 본문 제한 회피).
4. **시험용 배포 검증 먼저 수행**: 시험용 환경에서 보안·권한·파일 업로드/다운로드·이메일 인증 테스트를 통과한 후 운영 도메인 공개를 승인합니다.

---

## F. 최초 운영자 계정 생성 및 개시 절차
1. 운영자가 실제 배포된 `/signup` 화면에서 본인 업무 이메일로 가입 신청 → 이메일 인증 링크 클릭 완료.
2. Firebase Console > Authentication에서 본인의 `UID` 확인.
3. 운영자 로컬 PC(운영 Service Account 자격증명 설정 상태)에서 1회 bootstrap 스크립트 실행:
   ```bash
   npx tsx scripts/bootstrap-admin.ts --email <운영자이메일> --tenant iicombined
   ```
   (`canManageAdmins: true`를 가진 최초 소유 관리자가 생성되며 `auditLogs`에 기록됩니다.)
4. `/login`으로 로그인 → `/admin/suppliers`에서 협력사 Pool 등록 → `/admin/users`에서 사용자부서/협력사 가입 신청 승인 및 업체 연결 → `/admin/projects` 및 `/admin/tenders` 생성 → 입찰 상세에서 승인된 협력사 계정 배정 및 초청 링크 전달.
