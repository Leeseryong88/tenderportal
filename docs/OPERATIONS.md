# 운영 · 보안 · 복구 가이드 (`OPERATIONS.md`)

## 1. 데이터 백업 및 복구
- **Firestore**: Google Cloud Console 또는 `gcloud firestore`를 통해 Point-in-Time Recovery(PITR) 활성화 및 일일 Cloud Storage Export 스케줄 설정을 권장합니다.
- **Cloud Storage**: 비공개 버킷에 Object Versioning을 활성화하여 실수 삭제/변조 시 이전 세대 복구가 가능하도록 구성합니다.
- **파일 회수 한계**: 이미 다운로드 권한이 있던 사용자가 본인 기기에 내려받아 저장한 파일은 서버에서 원격 삭제/회수할 수 없습니다. 접근 회수는 향후 열람·신규 다운로드를 차단합니다.

## 2. 악성파일 검사 및 Production 전환 조건
- 개발/Emulator 환경에서는 `MALWARE_SCANNER_MODE=local_signature_dev`로 확장자·매직바이트·EICAR 시그니처 검사를 즉시 수행해 `CLEAN` 처리합니다.
- **운영(`NODE_ENV=production`)에서는 `local_signature_dev`가 차단**되며, `PENDING` 상태로 기록됩니다. 실제 운영 개시 전 Cloud Run + ClamAV 등 외부 스캐너 워커를 연결하고 `/api/internal/malware-scan` 웹훅(`MALWARE_SCANNER_WEBHOOK_SECRET`)으로 `CLEAN`/`INFECTED` 판정을 전달하도록 구성해야 합니다.

## 3. 감사로그 보관 및 모니터링
- `/tenants/{tenantId}/auditLogs`는 서버 전용으로만 기록되며 UI에서 수정·삭제할 수 없습니다.
- 로그인 실패 급증, `403` 인가 거부, 역할 변경, 파일 스캔 `INFECTED` 이벤트는 Cloud Logging / Vercel Log Drains와 연동해 알림을 설정합니다.

## 4. 키 회전 및 긴급 사용자 차단
- **Service Account 키 회전**: 새 키를 GCP IAM에서 발급 → Vercel 환경변수 업데이트 및 재배포 → 기존 키 폐기. 가능하면 Vercel OIDC / Workload Identity Federation 사용을 권장합니다.
- **긴급 계정 정지 CLI**:
  ```bash
  npx tsx scripts/revoke-user.ts --uid <TARGET_UID> --tenant iicombined --reason "Emergency incident"
  ```
- **마지막 소유 관리자 장애 복구**: 소유자가 접근 불가 시, GCP/Firebase Console 권한이 있는 조직 소유자가 새 계정을 가입·이메일 인증한 뒤 운영자 터미널에서 `npx tsx scripts/bootstrap-admin.ts --email <새이메일> --tenant iicombined`를 실행해 복구합니다.
