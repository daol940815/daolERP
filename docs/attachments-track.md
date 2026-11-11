# 공통 첨부 파일 트랙 (1200번대)

화면마다 따로 만들지 않는 **한 벌의 첨부 모듈**. 업무 요청이 1차, 회의록(1100)이 다음 사용처.

## 사용자 결정 (2026-11-11)

- 사용자들이 업무 요청 등에 사진 · 파일 첨부를 원함(지금은 카톡 · 로컬 폴더로 공유). 서버 · DB 부담 질문 → 아래 방식이면 부담 없음으로 답변.
- **1차 범위: 업무 요청만**(결정 카드). 발주서 첨부(510, 서버 경유)는 지금 방식 그대로 둔다 — 4.5MB 초과 실패 가능성은 알려둠, 이전은 미결.
- 10월 16일 결정(첨부 없이 '관련 링크 · 서버 경로' 칸)은 유지하고 첨부를 더한다. 10MB 넘는 파일은 회사 서버 + 링크 칸.
- 파일 정리: 자동 삭제 없음. 마스터 화면에서 오래된 · 큰 파일을 골라 묶어 내려받고 정리하는 기능은 **2차(미구현)**. 정리해도 기록 행은 남긴다.
- DB 정기 백업은 별도 작업(스레드 'DB 정기 백업 구축')으로 분리. 백업에 버킷 `attachments` 파일 복사를 포함하기로 함.

## 구조

- 마이그레이션 `1200_attachments.sql`: 테이블 `attachments` + 비공개 버킷 `attachments`(file_size_limit 10MB) + RPC `storage_usage_by_bucket()`(service_role 전용).
- 업로드: 브라우저 → `POST /api/attachments {action:'sign'}`(권한 · 형식 · 크기 · 개수 검사, 서명 업로드 URL) → `uploadToSignedUrl`로 Storage 직접 → `{action:'confirm'}`(Storage `info`로 실제 크기 확인 후 기록).
  **Vercel 서버는 파일을 만지지 않는다** — 본문 4.5MB 한도 무관.
- 내려받기: `GET /api/attachments?download=<id>` → 5분 서명 URL(`&inline=1`이면 새 탭 보기). 목록의 사진은 10분 미리보기 서명 URL.
- 삭제: Storage 파일 제거 + 행에 `deleted_at · deleted_by`(행은 남김). 저장 전 임시 파일만 행까지 삭제.
- 임시 업로드: 작성 화면이 `draft_key`(uuid)를 만들어 owner_id 없이 올림(본인만 보임) → 저장 API가 `linkDraftAttachments()`로 연결.
  하루 지난 미연결 임시 파일은 아침 크론 `/api/push/cron`이 `purgeStaleDrafts()`로 정리.
- 권한: `lib/attachments-server.ts` `ATTACHMENT_OWNERS[owner_type] = { canView, canAdd, canDelete }`(비동기, owner_id로 원본 조회).
  마스터를 공통 층에서 일괄 통과시키지 않는다(비공개 업무 요청 규칙).
- 화면 부품: `components/attachments/AttachmentBox.tsx` — 선택 · 끌어놓기 · Ctrl+V 붙여넣기(`pasteAnywhere`), 사진 썸네일, 파일 목록.
- 사진 자동 축소: `lib/attachments.ts` `shrinkImage` — jpg · png · webp · bmp를 긴 변 1600px JPEG(품질 0.85)로. gif · heic는 그대로.
- 받는 형식: 사진 · PDF · 엑셀 · CSV · 워드 · 파워포인트 · 한글(hwp · hwpx) · txt · zip (확장자 판정). 한 건 10개.
- 용량 표시: 직원 · 계정 · 권한 화면(마스터만) `StorageUsageCard` — Storage 전체 버킷별 + 공통 첨부 화면별, 1GB 대비 %, 80% 경고.

## 업무 요청 규칙 (owner_type `work_request`)

- 보기: 상세를 볼 수 있는 사람(공개 = 전원, 비공개 = 요청자 · 담당자 · 승인권자).
- 붙이기: **열린** 요청의 요청자 · 살아 있는 담당자. 닫힌 요청은 붙이기 불가.
- 지우기: 올린 사람 · 마스터 계정.

## 새 화면에 붙이는 법

1. `lib/attachments.ts` `ATTACH_OWNER_LABEL`에 이름, `lib/attachments-server.ts` `ATTACHMENT_OWNERS`에 판정 3개.
2. 저장된 건: `<AttachmentBox ownerType="x" ownerId={id} />`. 작성 화면: `draftKey` 넘기고 저장 API에서 `linkDraftAttachments`.
3. 회의록(1100) 예정: `meeting` · `meeting_comment` — 비공개 회의는 참석자 · 마스터만, 마감 회의 추가 차단, 삭제는 올린 사람 · 주최자 · 마스터(회의록 스레드와 합의).

## 상태

- 2026-11-11 구현 · 배포. **1200 적용 2026-11-11**(검증: 테이블 1 · 버킷 1 · 파일 한도 10485760 · 사용량 버킷 수 2). 사용자 시험 완료 2026-11-11(업로드 · 내려받기 · 삭제 이상 없음).
- 미결: 발주서 첨부 이전(4.5MB 문제), 파일 정리(묶어 받기) 화면, 상담일지 등 다른 화면.
