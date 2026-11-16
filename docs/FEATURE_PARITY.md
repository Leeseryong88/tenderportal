# Feature Parity & Gap Analysis (`reference/index.html` → Production SaaS)

기준 원본: `reference/index.html` (2026-11-16 최종 프로토타입)  
목표 시스템: IICOMBINED Tender Portal (Next.js App Router + TypeScript + Firebase + Vercel)

## 1. 기능 대응표 (Prototype vs. Production SaaS)

| 영역 | `reference/index.html` 원본 구현 | Production SaaS 구현 | 비고 / 보안·업무 개선 |
|---|---|---|---|
| **인증 및 역할 전환** | 상단 `#roleSelect`로 무인증 전환 (`Admin` / `Internal` / `Supplier`) | Firebase Auth (이메일/비밀번호, 이메일 인증, 비밀번호 재설정, 선택적 Google 로그인) + 관리자 승인 워크플로 | 무인증 역할 전환 제거. 개발/Emulator 전용 시연 안내는 운영 번들에서 제외 |
| **회원가입 / 승인** | 없음 (`db.users` 고정 배열) | `/signup`, `/verify-email`, `/account/pending`, `/account/rejected`, `/account/disabled`, `/admin/users` | 가입 시 `PENDING` 고정, `ADMIN` 공개 선택 불가, 승인/역할변경/업체연결 시 최근 재인증 필수 |
| **데이터 저장소** | `localStorage('tenderPortalDb')` + 하드코딩 `seed` | Cloud Firestore + 서버 전용 Admin SDK API (`/api/...`) + 기본 전면 차단 Rules | 클라이언트 직접 DB 읽기/쓰기 차단, 서버 DTO allowlist 적용 |
| **대시보드 (`/admin/dashboard`)** | 오늘 일정, 월 달력, 4개 KPI, 도넛 차트, 제출률 바, 임박 마감, 국가별 프로젝트, 최근 활동(하드코딩), 최근 입찰, 프로젝트 현황 | 동일 레이아웃 및 지표 유지. 최근 활동은 `auditLogs` 기반 실데이터로 대체, 대시보드 내 입찰 생성 버튼 미중복 유지 | 서버 기준 오늘 날짜 + 표시 시간대(`Asia/Seoul` 기본) 및 현지 시각 병기 |
| **프로젝트 (`/admin/projects`)** | 등록/수정, 8단계 기본 일정, 국가 필터, 검색, 유형(백화점/FS/Maison/리테일/건축/대수선/오피스/기타) | 동일 CRUD + Firestore 영속화, 기존 레거시 유형 보존, IANA 시간대 추천/직접 수정 | `UNSET`/`NOT_APPLICABLE` 선택 시 날짜 `null` 정리 및 달력 이벤트 제거 보장 |
| **입찰 (`/admin/tenders`)** | 입찰 목록 + 제출 현황 탭 통합, 임시저장/생성완료 분리, 8단계 일정 상속, 시간대+DST 미리보기, `[PM]/[AOR]/[GC]/[MAT]`+NDA+커버리지 초청 선택, 제출 후 수정 시 경고 | 동일 UI/흐름 + 단계별 `INHERITED`/`OVERRIDE` 배지 및 **상속 복원** 버튼, DST 존재하지 않는 시각 거부/중복 시각 오프셋 선택, revision/변경사유 기록 | 마감 판정(`DRAFT`/`OPEN`/`RECEIVING`/`CLOSED`)을 서버 시각(`Date.now()`)으로 동적 계산. 수정 시 `DRAFT` 회귀 방지 |
| **협력사 Pool (`/admin/suppliers`, `/department/suppliers`)** | 좌측 Sticky 필터 7종, 4개 KPI, 세계 백지도(국가 클릭 확대) + 미국 50개 주+DC 백지도(`Map data: Natural Earth`), 시장별 커버리지 카드, 컬럼 선택 검색 테이블, 복수 담당자, 커버리지 지도 미리보기 | 동일 UI/지도 데이터 보존. `countryCode`(ISO 3166-1 alpha-2) / `subdivisionCode`(ISO 3166-2) / `deliveryMode` 구조화, 호주·미국 주 별칭 표준화, 국가 전체 vs 주 우선순위 규칙 적용 | `USER_DEPARTMENT`는 `/department/suppliers`에서 허용된 `supplierDirectory` projection만 열람(입찰이력/금액/NDA원본/평가메모/제출파일 제거) |
| **협력사 입찰 (`/supplier/tenders`)** | 단일 통합 화면(KPI 4종 + 내 입찰 목록), RFP 다운로드, 파일 제출/재제출 | 동일 단일 화면 + 인증된 업체 계정·입찰별 UID grant 기반 조회, 버전별 불변 제출 패키지, 접수번호·서버시각 영수증 | 경쟁사 수·이름·제출여부·`RECEIVING` 상태 완전 비노출(`OPEN`/`CLOSED` + `NOT_SUBMITTED`/`SUBMITTED`만 제공) |
| **파일 업로드/다운로드** | `FileReader.readAsDataURL()` → `localStorage` 저장 (15MB 데모 제한) | Firebase Storage 직접 업로드(`staging/...`) → 서버 finalize 검증·복사(`protected/...`) → 권한 검증 후 다운로드 | Vercel API 본문 미통과, `getDownloadURL` 장기 토큰 미사용, 확장자+매직바이트+ZIP 위험도 검증, `attachment` 다운로드 강제 |
| **초청 링크 (`/invite`)** | `?invite=TND-...&supplier=sup1` (URL 파라미터 신뢰) | 암호학적 난수 토큰 생성, DB에는 SHA-256 `tokenHash`만 저장, 로그인+이메일인증+승인+업체일치 후 트랜잭션 단일 소비 | 검증 전 프로젝트명/업체명 비노출, claim 후 URL 파라미터 즉시 제거 |
| **다국어 (EN/KO)** | `translations` 객체 + `translateDom()` TreeWalker 문자열 치환 | Key 기반 `en`/`ko` 리소스 딕셔너리 + React 상태/Context 렌더링 (`translateDom` 제거) | 언어 전환 시에도 canonical enum 코드로 검색/필터 동작 유지 |
| **운영 설정 / 감사로그** | 없음 | `/admin/settings`, `/admin/audit` | 조직명, 시간대, 기본언어, 파일 제한(기본 50MB), 초청 만료일 설정 및 변경불가 감사로그 열람 |

## 2. 제거된 프로토타입 전용 기능
1. 상단 무인증 역할 전환 드롭다운 (`View as: Administrator / User Department / External Supplier`)
2. URL 쿼리스트링의 `supplierId`를 그대로 신뢰해 협력사 화면을 여는 취약한 초청 처리
3. `localStorage('tenderPortalDb')` 기반 업무/권한 데이터 공유
4. 브라우저 `Date.now()` 기반 마감 판정
5. 하드코딩된 최근 활동(`Storecraft GmbH · 2 hours ago` 등) 및 데모 수치
6. DOM `TreeWalker` 기반 텍스트 치환(`translateDom`)
