# 내 대시보드 트랙 (직원 개인화면, 300번대)

작성 2026-11-19. 이 세션은 **내 대시보드 `/me`** 화면의 관리 · 개선을 맡는다.
대화는 기억 장소가 아니다 — 결정 · 미결 · DB 변경은 이 문서에 바로 기록하고 main에 반영한다.

## 범위

- 맡는 것: 내 대시보드 화면 `app/(orders)/me/page.tsx`, 집계 API `app/api/me/summary/route.ts`,
  집계 RPC `supabase/migrations/300_my_dashboard.sql`(`my_dashboard_summary`), 도움말 `lib/help-registry.ts`의 `/me` 항목.
- 맡지 않는 것(다른 트랙 소유 — 대시보드는 **가져다 보여주기만** 한다):
  - 확인할 것 패널 · 알림 계산: 업무요청 트랙(`/api/notifications`, `components/layout/NotificationCenter.tsx`의 `TodoPanel`, docs/work-request-track.md)
  - 받은 · 보낸 요청 숫자: 업무요청 트랙(`/api/work-requests?summary=1`)
  - 근태 · 휴가: 인사·총무 트랙(docs/hr-track.md)
  - 업무일지 `/me/worklog` · 영업일지 `/me/journal`: 상담·영업·업무일지 트랙(docs/consultation-journal-track.md)
  - 내 정보 `/me/profile`: 기존 규칙(CLAUDE.md 직원 마스터 절 — 권한 정보 비노출)
  - 주문 · 미수 숫자의 정의: 주문시스템 트랙 · 결제처리 트랙(미수는 2차 확정에서만 줄어든다)
- 다른 트랙 소유 데이터의 정의가 바뀌어야 하면 이 트랙에서 고치지 말고 해당 트랙 문서에 요청을 남긴다.

## 확정된 방향 (이전 결정 — 다시 논의하지 않음)

- B안 직원 워크스페이스: 일반 직원의 홈 = 내 대시보드. 모드 선택(/portal)은 admin 전용(CLAUDE.md 직원 개인화면 절).
- 메뉴는 `lib/menu-registry.ts` 단일 원천 — `내 업무 › 내 대시보드` (`href: '/me', exact: true`). 영역 `all` 그룹이라 전 영역 사이드바 맨 위.
- 영업일지 카드 · 목록은 기록이 있는 직원에게만 보인다(2026-09-29 사용자 결정 — 영업팀만 씀).
- 모든 숫자는 원본 화면으로 드릴다운(카드 = 링크).
- 자동 갱신은 `useNotifRefresh` 구독만(자체 폴링 금지).

## 현재 화면 구성 (2026-11-19 코드 기준)

| 구역 | 데이터 원천 | 누르면 |
|---|---|---|
| 확인할 것 패널 | `/api/notifications` | 각 알림 대상 |
| 받은 요청 / 보낸 요청 카드 | `/api/work-requests?summary=1` | `/me/requests`, `?tab=outbox` |
| 이번 달 내 주문 · 내 미수 잔액 | RPC `my_dashboard_summary` | `/orders` |
| 담당 거래처 | RPC (`vendor_staff.employee_id`, 현재 배정) | 거래처 권한 있으면 `/sales-hub?mine=1`, 없으면 `/me/profile?tab=work` |
| 이번 달 업무일지 | `/api/me/worklog` | `/me/worklog` |
| 이번 달 영업일지 | RPC (`contact_activities.employee_id`) | `/me/journal` |
| 오늘 근태 · 휴가 | `attendance_records` · `attendance_leaves` | `/hr/attendance` |
| 최근 내 주문 / 최근 업무일지 / 최근 영업일지 | summary API | 각 전체 화면 |

## 알고 있는 문제 · 미결 (사용자 확인 필요)

1. **300 마이그레이션 적용 여부 미확인** — CLAUDE.md "현재 적용 완료" 목록에 300이 없다. 미적용이면 KPI 카드 대신
   "300 마이그레이션이 아직 적용되지 않았습니다" 문구가 뜬다(`MIGRATION_300_HINT`). 사용자 화면에서 확인 필요.
2. **내 주문 판정이 이름 대조** — `erp_orders.staff_name = 직원 이름`. 500 마이그레이션 이후 직접 입력 주문에는
   `erp_orders.created_by_employee_id`(로그인 자동 기록)가 있다. 2026-10-30 주문 전량 삭제로 현재 주문은 모두 직접 입력분이므로
   `created_by_employee_id` 기준으로 바꾸는 것이 정확하다(동명이인 · 이름 변경에 안전). 단 "입력한 사람"과 "담당 영업(상담자 = 품목 channel)"
   중 무엇을 "내 주문"으로 볼지는 사용자 결정 사항 — 바꾸려면 300번대 새 마이그레이션(301)으로 RPC 교체.
3. 역할별 대시보드 구성(영업팀 / 영업지원팀 / 경영지원팀)을 다르게 할지 — 미정. 지금은 전원 같은 구성.

## 작업 규칙

- 마이그레이션 번호: **300번대** (300 사용 중, 다음은 301). 실행은 사용자가 SQL 편집기에서.
- 새 구역은 기존 카드 패턴(둥근 카드, slate, 얇은 표)과 `check-ui` 규칙(rem 글자 크기, 색 코드 금지).
- 화면을 고치면 도움말 `/me` 항목 `updated` + `changes` 한 줄 → `npm run build` → 브랜치 커밋 · push → 원격 main pull → `--no-ff` 병합 → push.
- `app/(orders)/` 는 주문시스템 트랙과 공유 — 병합 전 반드시 원격 main을 먼저 받는다.
- 새 화면(구역 신설 포함)은 시안(HTML) → 사용자 확인 → 구현.

## 결정 기록

- 2026-11-19: 내 대시보드 관리 세션 개설(사용자 요청). 이 문서를 인수인계 문서로 둔다.
