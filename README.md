# IICOMBINED Tender Portal

Next.js App Router + TypeScript + Firebase (Auth, Firestore, Storage) + Vercel 기반 입찰 접수 SaaS 웹서비스.

## 요구사항 및 버전
- **Node.js**: `>= 20.9.0` (검증 환경: Node `v20.20.2`, Java 21 for Firebase Emulator)
- **Next.js**: `15.5.12` (App Router, Node.js runtime)
- **Firebase SDK**: `firebase` `13.x`, `firebase-admin` `13.6.x`

## 주요 명령어
```bash
npm install
npm run typecheck
npm run lint
npm run build
npm run test:unit
```

## 로컬 Emulator 개발 및 전체 검증
1. `.env.example`을 `.env.local`로 복사합니다.
2. Firebase Emulator Suite와 시드·테스트를 한 번에 실행합니다:
```bash
npx --yes firebase-tools@latest emulators:exec --project demo-iicombined-tender --only auth,firestore,storage "npx tsx scripts/seed-dev.ts && npm run test:unit && npm run test:rules && npm run test:integration"
```
3. 개발 서버 실행:
```bash
# 터미널 1
npx --yes firebase-tools@latest emulators:start --project demo-iicombined-tender --only auth,firestore,storage
# 터미널 2
npx tsx scripts/seed-dev.ts
npm run dev
```

## 문서 목록
- `docs/FEATURE_PARITY.md`: 프로토타입(`reference/index.html`) 대비 기능 대응표
- `docs/ARCHITECTURE.md`: 데이터 모델, 인증, 파일 전송 아키텍처
- `docs/PERMISSIONS.md`: 역할/상태 권한표 및 8단계 서버 인가 규칙
- `docs/SETUP_KO.md`: 운영자용 Firebase / Vercel / Git 최초 구축 및 환경변수 가이드
- `docs/ADMIN_GUIDE_KO.md`: 관리자용 승인/업체연결/입찰/초청/마감 운영 매뉴얼
- `docs/OPERATIONS.md`: 백업, 복구, 감사, 비용, 키 회전, 장애 대응
- `docs/TEST_REPORT.md`: 단위/Rules/통합/E2E 검증 결과 보고서
