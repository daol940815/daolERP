# 업무요청 트랙 — 인수인계 문서 (900번대 마이그레이션 예정)

임직원 간 업무 요청·지시를 기록하고 진행을 보이게 하는 기능. 2026-10-15 사용자 발의, 피드백 단계(미착수).

## 사용자가 든 문제 (2026-10-15)

현재는 카카오톡·구두로 요청. 그래서
1. 지시하는 사람이 받는 사람의 일정을 몰라 지시해도 되는 상황인지 판단이 어렵다.
2. 받는 사람이 확인했는지, 어디까지 진행했는지 보고 전에는 알 수 없다.
3. 누가 누구에게 무엇을 지시했고 누가 처리했는지 기록이 없다.
4. 요청일·마감일 확인이 어렵고, 지시한 사람도 받은 사람도 잊는다.

## 총괄 피드백 요지 (2026-10-15)

- 문제 2·3·4는 "요청 1건 = 기록 1행(요청자·담당자·내용·요청일·마감일·상태·이력)"으로 해결된다. 1(상대 일정)은
  기록이 아니라 **조회**의 문제 — 담당자 선택 시 그 직원의 오늘 근태·휴가·진행 중 요청 건수를 옆에 보여주는 방식.
  정확한 '여유 시간' 계산은 이 회사 규모·데이터로는 불가능하므로 약속하지 않는다.
- 기존 자산 재사용: 직원 마스터(employees) · 내 업무 그룹(전 영역 공통) · 업무일지(erp_work_logs, 요청 완료를 자동
  한 줄로) · 근태·휴가(attendance_*) · 승인 흐름 패턴(erp_order_change_requests의 status·decided_by) · 권한(109).
- 상태는 단순하게: 요청 → 확인(담당자가 봤음) → 진행 중 → 완료 / 보류 / 반려(되돌림). "확인"을 별도 상태로 두는 것이
  문제 2의 핵심. 진행률(%) 입력은 두지 않고, 진행 메모(댓글형 이력)로 대신한다 — 숫자는 거짓이 되기 쉽다.
- 알림: ERP에 알림 기반이 없다. 1차는 사이드바 '내 업무 › 업무 요청'에 미확인·오늘 마감 건수 배지 + 내 대시보드
  카드. 카카오톡·메일 발송은 2차(비용·운영 부담).
- 넣지 말 것(1차): 간트·캘린더 드래그, 반복 업무, 하위 업무 트리, 파일 첨부(링크로 대체), 평가·점수.

## 사용자 결정 (2026-10-15)

1. 요청 대상 = 개인(직원 1명). 팀 지정 없음.
2. 마감 = 일자 + 시간(timestamptz). 우선순위는 답 없음 → '긴급' 체크 1개 제안(확인 대기).
3. 요청 취소와 완료 처리 모두 요청자가 할 수 있다. (담당자 흐름: 수락 → 진행 → 처리 완료 보고. 반려 허용 여부 확인 대기)
4. 사장님용 전 직원 요청 현황 화면 — 1차 포함(경영 현황 그룹).
5. 수락·완료 시 업무일지 자동 기재 — erp_work_logs의 action CHECK에 '업무요청수락'·'업무요청완료', ref_type에
   'work_request' 추가 필요(900 마이그레이션에서 700 트랙 테이블 제약 확장 — consultation-journal 트랙에 알림).
6. 카카오톡 알림 — 알림톡은 유료(건당 과금 + 채널·템플릿 심사 + 발송업체 계약) → **보류**. 1차는 앱 내 배지·대시보드 카드.

## 상태 모델 (제안, 확정 대기)

요청(requested) → 수락(accepted, 담당자) → 진행 중(in_progress, 담당자 메모) → 처리 완료 보고(done_reported, 담당자)
→ 완료(completed, 요청자 확정). 요청자는 어느 단계에서든 취소(canceled) 또는 바로 완료(completed) 가능.
담당자 반려(rejected, 사유 필수)는 허용 제안 — 반려되면 요청자에게 돌아가 수정 후 재요청 또는 취소.
이력은 work_request_events(누가·언제·무엇을·메모)로 전부 남긴다.

## 사용자 결정 2차 (2026-10-15)

- 마감 **필수**(일자+시간, 기본값 당일 18:00 채워 두고 수정) + **긴급** 체크 1개.
- 담당자 **반려 허용**(사유 필수) → 요청자에게 돌아감.
- **아르바이트도 요청 가능**(받기·보내기 모두). 요청 기능은 내 업무 그룹(전원).
- 상태 모델 위 제안대로 확정: requested → accepted → in_progress → done_reported → completed / canceled / rejected.

## 사용자 결정 3차 (2026-10-15, 시안 검토)

- 본인에게 요청(개인 할 일) **허용**.
- 처리 보고 후 **자동 완료 없음** — 요청자가 확정, 완료 대기 카드에 계속 보임.
- 파일 첨부: 사용자가 용량 제한을 질문 → 총괄 제안(확정 대기): 발주서 첨부(510, 버킷 po-attachments, 10MB)와 같은
  방식. 파일당 10MB · 요청당 5개 · 비공개 버킷 `work-request-attachments` · 허용 형식 이미지·PDF·엑셀·워드·한글·zip.
  **주의**: Vercel 서버 함수 요청 본문 한도 4.5MB — 발주서 첨부처럼 서버 경유 업로드는 4.5MB 초과 시 실패하므로,
  업무 요청 첨부는 브라우저 → Storage 직접 업로드(서명 URL)로 구현해야 10MB가 실제로 된다. 저장 비용은 Supabase
  요금제에 포함(Free 1GB / Pro 100GB 포함, 초과 GB당 약 $0.021) — 월 수십 건 × 수 MB면 연 1GB 안.
  보존: 삭제 없이 보관, 1년 뒤 점검.

## 사용자 결정 4차 (2026-10-16)

- **첨부 없음**. 회사 네트워크 서버가 있어 '관련 링크 · 서버 경로' 텍스트 칸 1개 + 복사 버튼으로 대체. 사진 첨부가 필요해지면 2차.

## 1차 구현 (2026-10-16, 배포 — 900 실행 대기)

- 마이그레이션 `supabase/migrations/900_work_requests.sql`: work_requests · work_request_events(RLS, 서비스 키 경유) +
  erp_work_logs action CHECK에 '업무요청수락'·'업무요청완료', ref_type에 'work_request' 추가(700 트랙 테이블 — 알림 아래) +
  updated_at 트리거 + 검증 SELECT. **사용자 실행 필요** — 실행 전에는 화면이 안내 문구를 띄우고 배지·카드는 숨겨진다.
- lib: `lib/work-requests.ts`(상태·라벨·마감 판정·KST 변환·allowedActions) / `lib/work-requests-server.ts`(select·정규화) /
  `lib/work-log.ts` 액션 2개·refType 추가(700 트랙 파일, 추가만).
- API (`API_OWNERS`: `/api/work-requests` → my, `/api/work-requests/overview` → mgmt):
  `GET/POST /api/work-requests`(받은/보낸 목록·요약·생성), `GET/POST /api/work-requests/[id]`(상세·이력 / accept·reject·memo·
  report·complete·cancel·edit — 당사자 판정은 API 안, 경영 조회자는 읽기만), `/employees`(담당자 선택: 계정 있는 재직자),
  `/staff-status`(담당자 오늘 상황), `/overview`(월별 전 직원 현황).
- 화면: `/me/requests`(받은|보낸 탭, 요약 카드 클릭=필터, 행 버튼: 수락·반려·처리 완료 / 완료·취소·다시 요청),
  `/me/requests/new`(담당자 오늘 상황 패널, 마감 기본 당일 18:00, `?from=`으로 반려 건 재요청),
  `/me/requests/[id]`(상태 흐름·내용 수정·이력·메모·역할별 버튼·링크 복사), `/reports/work-requests`(경영 현황).
- 배지·카드: 사이드바 '업무 요청' 옆 빨강(받은 미확인+지남) 또는 노랑(보낸 완료 대기+반려), 내 대시보드 받은/보낸 카드 2개.
  업무일지의 '업무요청…' 줄은 '업무 요청 보기'로 상세 드릴다운.
- 담당자의 첫 메모가 '수락' → '진행 중'으로 올린다. 처리 보고 시 결과 메모(선택). 수정은 요청자, 처리 보고 전까지(수정 전 값 snapshot).

### 상담·영업·업무일지 트랙 알림문
> 총괄이 `erp_work_logs`의 action CHECK에 '업무요청수락'·'업무요청완료', ref_type CHECK에 'work_request'를 추가했습니다
> (900_work_requests.sql, lib/work-log.ts WORK_LOG_ACTIONS·refType 확장, me/worklog 드릴다운 링크 1줄). 업무일지 화면의
> 행위 필터·라벨에 두 액션이 표시되는지만 확인해 주세요. 별도 작업 없음.

## 미결

- [x] 900 실행 완료(2026-10-16 사용자) — 검증 2 · 1 · 1 일치, REST로 테이블 조회 확인(0행)
- [ ] 실제 요청 1건으로 수락·메모·보고·완료 흐름 점검 + 담당자 업무일지 2줄 확인
- [x] 목록 기본 정렬(2026-11-03 사용자 결정): 긴급 → 마감 임박 → 생성일시 오름차순(같은 마감이면 먼저 요청된 것이 위).
  `app/api/work-requests/route.ts`의 조회 1곳에서 정하고 화면은 재정렬하지 않는다. 세 탭(전체 · 받은 · 보낸) 공통.
- [ ] 사용해 보고 조정: 완료 대기 노출 방식, 알림 2차(알림톡) 필요성

## 알림 센터 제안 (2026-10-16 사용자 질문: 로그인 중 알림 메시지 가능한가 → 가능, 설계 제안·확정 대기)

- 방식: 폴링(60초) 기반 **앱 내 알림 센터**. 공통 API `/api/notifications`가 본인 기준 "확인할 것"을 원본 상태에서
  계산해 내려주고(저장 없음 — 처리하면 사라짐), 사이드바 상단 알림 종 아이콘(건수) + 새 항목 생기면 화면 우하단 토스트 +
  로그인 직후 첫 화면(업무 선택 또는 영역 홈)에 "확인할 것" 패널. 읽음 표시는 브라우저 localStorage의 마지막 확인 시각.
- 원천(1차 후보): 업무 요청(받은 미확인·오늘 마감·지남 / 보낸 완료 대기·반려) · 휴가 승인 요청(승인권자, attendance_leaves
  requested) · 주문 수정 승인 요청(승인권자, erp_order_change_requests pending) · 본인 휴가 승인/반려 결과.
- 하지 않을 것: Supabase Realtime(서비스 키 전용 RLS라 브라우저 구독 불가 — 정책 추가 필요, 폴링으로 충분) · 브라우저
  푸시(탭 닫혀도 알림 — 서비스워커·권한 요청 필요, 2차 후보) · 알림톡(유료, 보류 유지).

### 알림 센터 확정·구현 (2026-10-16 사용자: "권장사항으로 진행")
- 확정: 종 숫자 = 해야 할 것 + 기다리는 것(결과 통지 제외) / 토스트 모든 화면 / 60초 폴링(탭 복귀 시 즉시).
- 구현: `/api/notifications`(my) — 업무 요청(받은 미확인·오늘 마감·지남, 보낸 완료 대기·반려 7일) · 휴가 승인 요청(승인권자=
  isManagerLike) · 주문 수정 승인 요청(승인권자) · 내 휴가/주문 수정 요청 결과(7일). `badges`로 메뉴 배지(/me/requests ·
  /hr/approvals · /orders/approvals)까지 내려줌. `lib/notifications.ts`(타입) · `lib/use-notifications.ts`(폴링·토스트 판정·
  확인함 localStorage) · `components/layout/NotificationCenter.tsx`(종+패널 · 토스트 · TodoPanel). AreaSidebar가 폴링 1곳 소유
  (옛 업무 요청 요약 폴링 대체). 업무 선택(`app/portal/portal-todo.tsx`)·내 대시보드 상단에 '확인할 것' 패널(0건 비표시).
- 토스트 규칙: 직전 폴링보다 건수가 늘어난 종류만, 최대 2개, 8초, 첫 응답은 토스트 없음, 소리 없음.

## 2차 업데이트 요청 (2026-11-02 사용자)

1. 목록을 공용으로 전환해 전원이 본다. 2. '내 업무만' 버튼. 3. 담당자를 다수 지정. 4. 다수 지정 시 "한 명이 수락하면 진행"과 "전원이 그룹으로 진행" 구분.
총괄 피드백 후 **사용자 결정(2026-11-02)**: ① 비공개 체크 옵션 추가 ② 경영 현황 '업무 요청 현황'은 통계 중심으로 축소하고 목록으로 드릴다운
③ 선착 방식에서 해제된 사람은 할 일에서 제거 + 참고 표시 ④ 팀 단위 빠른 선택 추가(10-15 '개인 대상만' 결정 변경) ⑤ 1·2 먼저 배포 후 3·4 시안.
추가 질문 ⑥ 실시간 알림 가능? ⑦ 웹페이지가 닫혀 있어도 PC 알림 가능?

### 1·2 구현 (2026-11-02 배포)
- `901_work_requests_private.sql`: work_requests.is_private BOOLEAN DEFAULT false. **사용자 실행 필요** — 미적용이어도 코드는 동작(비공개는 저장되지 않고
  작성 시 경고 alert, 목록 하단 안내). `lib/work-requests-server.ts`의 `selectWithPrivacy`가 is_private 포함 select 실패 시 옛 select로 폴백.
- API `GET /api/work-requests?scope=all|inbox|outbox[&month=][&employee=][&closed=1]`: all = 지금 열린 건 전부 + 선택 월 생성분(닫힌 건 포함), 비공개는
  요청자·담당자·승인권자(isManagerLike)만(`canSeePrivate`), `hiddenPrivate` 건수 반환. employee= 는 요청자·담당자 어느 쪽이든 그 직원 관련만. 옛 `box=` 호환.
  POST에 is_private. 상세 GET: 공개 요청은 로그인 전원 조회, 비공개는 당사자·승인권자만(이전 '당사자 또는 mgmt 권한' 규칙 대체).
- 화면 `/me/requests`: 탭 '내가 받은 | 내가 보낸 | 전체 (공용)' (?tab=inbox|outbox|all, 기본 받은). 전체 탭: 생성 월 선택, 요청자·담당자 열 둘 다,
  KPI 카드(진행 중 전체·미확인·오늘 마감·마감 지남·완료 대기), 비공개 배지, 조작 버튼은 내가 담당자·요청자인 행에만. `?employee=`·`?filter=`로 드릴다운 수신.
  작성 화면 비공개 체크(기본 공개), 상세 비공개 배지.
- 경영 현황 `/reports/work-requests`: 전체 목록 표 제거 → KPI 카드·직원별 행이 `/me/requests?tab=all&month=&filter=|employee=`로 링크, '전체 목록 보기' 버튼.
  overview API는 비공개 건을 집계에 포함하되 승인권자 외에게는 제목·내용 마스킹(`maskRow`).

### ⑥ 실시간 알림 — 총괄 답 (2026-11-02)
- 현재: 알림 센터가 60초 폴링 + 탭 복귀 시 즉시 조회. 종·배지·토스트는 갱신되지만 **목록·상세 화면 자체는 다시 조회하지 않아** 새로고침이 필요하다고 느낀 것.
- 1단계(즉시 가능, 반나절): 목록·상세·대시보드가 알림 폴링 결과가 바뀔 때 재조회 + 폴링 주기 60초 → 15~20초(요청 수 4배, 비용 미미).
- 2단계(진짜 실시간, 반나절~1일): Supabase Realtime **Broadcast** — API가 요청 생성·수락·보고 등 변경 시 채널에 "변경 있음" 신호를 쏘고 브라우저가 즉시
  재조회. 테이블 RLS를 브라우저에 열 필요 없음(신호만, 데이터는 기존 API). 무료 플랜 한도(동시 200연결·월 200만 메시지) 안. 권고: 1단계 바로, 2단계는 3·4와 함께.

### ⑦ 웹 닫혀 있어도 PC 알림 — 총괄 답 (2026-11-02)
- **가능 — Web Push**(서비스 워커 + Push API + VAPID 키). 조건: HTTPS(Vercel 충족), 직원이 PC·브라우저마다 "알림 허용" 1회, 브라우저가 백그라운드에서
  실행 중(Windows 크롬·엣지는 창을 닫아도 백그라운드 유지가 기본 설정; 완전 종료 시 다음 실행 때 도착). Mac Safari는 PWA 설치 후에만.
- 구현: 구독 저장 테이블(902 push_subscriptions) + 서버 발송(web-push 라이브러리, VAPID 비밀키는 Vercel 환경변수) + 발송 시점(새 요청 받음·반려·처리 보고·
  오늘 마감·휴가 승인 요청). 1~2일. 알림톡(유료)·이메일(즉시성 낮음)보다 비용 0에 가깝다. 권고: ⑥ 2단계와 한 묶음으로 3·4 시안 뒤에.

- **901 실행 완료(2026-11-02 사용자)** — REST 검증: work_requests.is_private 조회 OK(요청 3건 전부 false, 비공개 0건). 비공개 체크 저장 가능.

### ⑥ 1단계 구현 (2026-11-02 배포)
- 폴링 주기 `NOTIF_POLL_MS` 60초 → **20초**(알림 패널 하단 문구도 상수에서 읽음).
- `lib/use-notif-refresh.ts`: window 이벤트 2개 — `daol:notif-changed`(폴링 결과가 직전과 다를 때 useNotifications가 발신) /
  `daol:notif-refresh`(화면 조작 뒤 `requestNotifRefresh()`로 즉시 폴링 요청). `useNotifRefresh(load)` 훅으로 구독.
- 구독 화면: 업무 요청 목록(`requests-list.tsx`) · 상세(`[id]/page.tsx`, 수정 중에는 갱신 보류) · 내 대시보드(`me/page.tsx` 요청 카드·확인할 것 패널).
  수락·반려·메모·보고·완료·취소 뒤에는 즉시 폴링을 요청해 종·배지가 바로 바뀐다.
- 효과: 다른 사람이 요청·수락·보고하면 최대 20초 안에 열린 화면이 새로고침 없이 갱신. 서버 호출은 사용자당 분당 3회(이전 1회).

### 2차 시안 (2026-11-02 전달 — `docs/mockups/업무요청_2차_시안.html`)
- 8섹션: 새 요청(담당자 검색+칩, 팀 버튼, 진행 방식 선착|공동 라디오) / 선착 상세 / 공동 상세 / 목록 '내 몫' 열 /
  즉시 갱신(Realtime Broadcast) / Web Push(배너·설정·OS 알림) / 902 구조(`assign_mode single|first|all`, `work_request_assignees`,
  `push_subscriptions`) / 결정 6건(팀 버튼 범위 · 공동 조기 완료 확정 · 선착 담당자 추가 불가 · PC 알림 기본값 · 아침 알림 09:00 · 순서).
- **사용자 요청(2026-11-02) — 새 요청 옆 "선택한 담당자 오늘 상황" 패널에서 근태·휴가 열을 빼고, 그 사람이 지금 맡고 있는 업무를
  보여준다.** 총괄 답: 어렵지 않음 — `staff-status` API가 이미 열린 요청을 조회해 건수만 돌려주던 것을 행(제목·마감·상태)으로
  돌려주면 된다. 설계: 담당자별 열린 요청(미확인·수락·진행 중·처리 보고) 마감 순, 사람마다 최대 3건 + 나머지 건수, 이름 클릭 →
  공용 목록 담당자 필터. 비공개 요청은 `canSeePrivate` 아니면 제목 감추고 "비공개 n건"으로만 센다. 근태·휴가·최근 업무일지는
  패널에서 제거(API 조회도 제거). 시안 1번 패널 수정 완료. 3·4 구현에 포함.

### 사용자 결정 5차 (2026-11-02 "좋아 진행해줘" — 시안 결정 6건 전부 권고대로)
① 팀 버튼: 팀별(재직·로그인 직원) + 아르바이트 + **전 직원** 버튼 둠 ② 공동 방식 요청자 **조기 완료 확정 허용**(미보고자에게는 "요청자가 완료 처리"로 닫힘)
③ 선착 방식 **담당자 추가 불가**(단일·공동만 추가 가능, 단일에 추가하면 공동으로 전환) ④ PC 알림 기본값: 허용 안내 1회, 주문 수정 승인만 기본 끔
⑤ 오늘 마감 아침 알림 09:00 ⑥ 순서: 3·4(다수 담당자) + ⑥ 2단계 먼저 → ⑦ Web Push 다음 묶음.

### 3·4 + ⑥ 2단계 구현 (2026-11-02 배포 — **902 실행 대기**)
- **902** `supabase/migrations/902_work_request_assignees.sql`: `work_requests.assign_mode`(single|first|all, 기본 single) · `assignee_id` NULL 허용 ·
  **`work_request_assignees`**(request_id · employee_id · status invited|accepted|in_progress|done_reported|rejected|released · 수락/보고/반려 시각 · 사유 · 메모) ·
  기존 요청을 single 방식 담당자 행으로 이행(요청 상태 → 담당자 상태 역산) · 이력 종류에 `assignee_added` 추가. push_subscriptions 는 ⑦에서 903으로.
  **902 적용 전에는 업무 요청 화면·API가 "902 마이그레이션을 실행해주세요" 안내를 낸다**(폴백 없음 — 데이터 구조 변경이라 두 경로 유지하지 않음, 알림 API는 조용히 건너뜀).
- 규칙(`lib/work-requests.ts`): 요청 상태 = 담당자 상태 **집계**(`aggregateStatus`) — 살아 있는 담당자 없음 → 반려 / 전원 보고 → 처리 보고 /
  1명이라도 진행·보고 → 진행 중 / 1명이라도 수락 → 수락 / 그 외 미확인. 선착은 수락 시 나머지가 released 라 수락자 1명 상태가 그대로 요청 상태.
  `allowedActions(row, meId)` 내 몫(담당자 행) 기준 — 선착 수락은 요청이 requested 일 때만, `addAssignee` 는 요청자·열린 건·선착 제외.
  `assigneeSummary` 목록 담당자 열 요약(선착 "수락자 (외 N 해제 · M 반려)" / "미정 (N명 중 수락 대기)", 공동 "팀명 N명 · 보고 k/N").
  `myDueState` 내 몫 기준 마감(공동에서 내가 보고했으면 배지 없음).
- 서버(`lib/work-requests-server.ts`): `ROW_SELECT` 에 담당자 행 임베드, `applyAggregate(admin, row, now)` 담당자 변경 뒤 요청 상태·시각 재기록
  (reject_reason 은 다수면 "이름: 사유" 결합). `canSeePrivate` 는 해제·반려된 담당자도 당사자로 봄. 901 폴백(`selectWithPrivacy`) 제거.
- API: POST 생성 `assignee_ids[]` + `assign_mode`(2명 이상 필수), 담당자 행 insert 실패 시 요청 롤백. `[id]` 조작 — 선착 수락은
  `update … eq(status,'requested')` 원자 갱신(늦은 쪽 409 "이미 다른 사람이 수락했습니다"), 나머지 invited → released, 이력 "나머지 N명 자동 해제";
  `add_assignee`(employee_ids, 반려·해제자는 재초대). 업무일지: 수락 = 수락한 사람, 완료 확정 = 수락했던 담당자 전원 각자.
  GET 목록: 최근 90일+열린 건 1회 조회 후 내 몫 기준으로 받은/보낸을 가름(선착 해제 건은 받은 목록·배지·알림에서 제외). `staff-status` 는
  `employee_ids` 다수 → 담당자별 열린 요청 목록(비공개는 당사자·승인권자 외 제목 가림). 알림 API 받은 요청 = 내 몫(invited·accepted·in_progress) 행 기준.
  경영 현황 직원별 집계 = 담당자 행 기준(공동 1건 = 담당자 N명 각 1건, 해제자 제외), 요약 KPI 는 요청 건 기준.
- 화면: 새 요청(검색+칩, 팀 버튼, 진행 방식 라디오, 오른쪽 "선택한 담당자가 맡고 있는 업무" 사람당 3건 + 나머지 건수, 이름 → 공용 목록 담당자 필터) ·
  목록(선착/공동 배지, 담당자 요약, **내 몫** 열, 조작 버튼 = allowedActions) · 상세(담당자별 진행 표, 담당자 추가 패널, 선착 "먼저 수락하면 내가 담당",
  공동 조기 확정 경고 문구, 미보고자 "요청자가 완료 처리") · 경영 현황 담당 열 요약.
- **⑥ 2단계 즉시 갱신**: `lib/realtime-broadcast.ts` — 업무 요청 API가 처리 직후 Supabase Realtime **HTTP Broadcast**(`/realtime/v1/api/broadcast`, 서비스 키)로
  채널 `wr` 이벤트 `changed`(request_id · employee_ids만, 데이터 없음) 발신. `lib/use-notifications.ts` 가 브라우저 anon 클라이언트로 채널 구독 →
  신호 400ms 디바운스 후 `poll(force)` = 알림 재조회 + `daol:notif-changed` 무조건 발신(메모처럼 건수가 안 바뀌는 변경도 열린 화면 갱신).
  20초 폴링은 안전망으로 유지. 알림 패널 하단에 "즉시 갱신 연결됨" 표시(`live`). 연결 실패 시 조용히 폴링만.
  확인 필요: Supabase 프로젝트가 공개(anon) Broadcast 채널 참여를 허용해야 함 — 패널에 "즉시 갱신 연결됨"이 안 보이면 Realtime 설정 점검.

### 902 적용 (2026-11-02 사용자 실행 — 검증 완료)
- 검증 SELECT: assign_mode 열 1 · assignee_id NULL 허용 YES · 요청 5 = 담당자 행 5 · 담당자 없는 요청 0 · 이력 확장 1.
- REST 대조(총괄): 5건 모두 single, 담당자 오철준, 담당자 상태 역산 일치(done_reported→done_reported, completed→done_reported,
  in_progress, accepted×2). API가 쓰는 임베드 3종(요청→담당자 행, 담당자 행→요청 inner, staff-status 중첩 역참조) PostgREST 200.

- 2026-11-03 사용자 확인: 알림 패널 "즉시 갱신 연결됨 · 20초마다 갱신" 표시 — ⑥ 2단계 정상.

### ⑦ PC 알림(Web Push) 구현 (2026-11-03 배포 — **903 실행 + Vercel 환경변수 4개 대기**)
- **903** `supabase/migrations/903_push_subscriptions.sql`: `push_subscriptions`(employee_id · endpoint UNIQUE · p256dh · auth · device_label ·
  user_agent · enabled · prefs JSONB · last_used_at · last_error). RLS, 서비스 키 경유만.
- **환경변수(Vercel, 저장소에 넣지 않음)**: `VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` · `VAPID_SUBJECT`(mailto:) · `CRON_SECRET`. 키 쌍은 총괄 세션이
  `web-push generateVAPIDKeys` 로 생성해 채팅으로 전달(2026-11-03). NEXT_PUBLIC 빌드 변수에 묶지 않고 공개키를 GET API 가 내려주므로
  환경변수만 넣고 재배포하면 동작. 키를 바꾸면 모든 구독이 무효 — 직원들이 다시 허용해야 한다.
- 받을 알림 종류(`lib/push.ts` PushKind): `wr_new`(새 업무 요청 — 담당자, 본인 제외) · `wr_result`(내 요청 반려·처리 보고 — 요청자) ·
  `wr_due_today`(오늘 마감, 아침 09:00 1회) · `leave_approve`(휴가 승인 요청 — 승인권자). 기기(구독)마다 prefs, 키 없으면 켬.
  **주문 수정 승인은 제외** — 수정요청 제도가 2026-08-25 폐지되어 새 요청이 생기지 않는다(시안 6의 다섯 번째 항목 삭제).
- 발송(`lib/push-server.ts`): `sendPush(admin, employeeIds, payload)` → 켜진 구독 중 kind 를 받기로 한 기기에 web-push. 404·410 은 행 삭제,
  그 외 실패는 last_error. 호출한 본 작업에는 영향 없음. `approverIds()` = 알림 API 의 isManagerLike 와 같은 기준(마스터·승인권·sales 외 role).
  호출 지점: 업무 요청 생성(담당자) · 반려/처리 보고(요청자; 공동은 "k/N 보고") · 담당자 추가(추가된 사람) · 휴가 신청(승인권자).
  내용은 제목·요청자·마감만. **비공개 요청은 "비공개 업무 요청 1건"** 으로만.
- 브라우저(`lib/push-client.ts`, `public/sw.js`): 서비스 워커는 푸시 표시 + 클릭 시 해당 화면 열기만(캐시 없음). 허용 → 구독 → `POST /api/push/subscriptions`
  (같은 endpoint 는 갱신, 다른 직원이 같은 PC에서 허용하면 그 직원 것으로 이전). 해제 = 서버 행 삭제 + 브라우저 구독 취소.
- 화면: 사이드바 종 위 **허용 안내 배너**(`components/layout/PushBanner.tsx` — 지원·미차단·미구독·서버 키 있음일 때, "나중에" 7일 localStorage) ·
  **내 정보 › 알림 설정**(`/me/profile?tab=notify`, `notify-tab.tsx`): 이 PC 상태·허용·끄기·**테스트 알림**, 내 기기 목록(켬/끔·테스트·삭제), 기기별 받을 알림.
- **아침 09:00 오늘 마감**: `vercel.json` crons `0 0 * * *`(UTC = 09:00 KST) → `GET /api/push/cron`(Authorization: Bearer CRON_SECRET, 미들웨어 통과 경로).
  wr_due_today 를 켠 직원 중 내 몫(미확인·수락·진행 중)이 오늘 마감인 사람에게 "오늘 마감 업무 요청 N건 — 첫 건 (HH:MM까지) 외 n · 마감 지난 m건".
  Vercel Hobby 요금제는 하루 1회 크론만 허용되고 실행 시각이 수십 분 늦을 수 있다.
- API_OWNERS `/api/push` → my. 패키지 `web-push@3.6.7` + `@types/web-push` 추가.
- 한계(시안 6 그대로): Windows 크롬·엣지는 창을 닫아도 백그라운드 실행이라 도착, 브라우저 완전 종료 시 다음 실행 때 도착. Mac Safari 는 "앱으로 설치" 후만.
  PC·브라우저마다 허용 따로.

### 903 적용 · PC 알림 동작 확인 (2026-11-03)
- 사용자: 903 실행 + Vercel 환경변수 4개(VAPID_PUBLIC_KEY · VAPID_PRIVATE_KEY · VAPID_SUBJECT · CRON_SECRET) 등록 · Redeploy 완료.
- 첫 테스트: 서버 발송은 성공(구독 행 last_used_at 기록, FCM 수락)이었으나 PC에 표시되지 않음 → Windows/Chrome 알림 표시 설정 쪽 안내 후
  **사용자 확인: "알림 테스트 완료. 문제없이 적용됐어."** (Chrome · Windows, 2026-11-03 11:33 KST 발송분). ⑦ 동작 확인.
- 남은 확인: 다음 날 09:00 전후 오늘 마감 알림(Vercel › Cron Jobs 로그 `/api/push/cron` 응답 `sent`), 실제 업무 요청 생성 시 담당자 PC 알림.

### 알림 종류 분리 + 진행 메모 알림 (2026-11-04 사용자 요청 → 즉시 구현·배포)
- 사용자 지적: 알림 패널이 "업무 요청 미확인 31건 · 오늘 마감 13건 · 마감 지남 19건"으로만 보여 성격 구분이 안 됨(오철준 대리 종 63).
  요청: ① 개인 요청(나에게 온 것) ② 공용 요청(내가 포함된 것) ③ 내가 요청한 업무 관련 알림으로 나눌 것 + 진행 메모·이력 변경 알림 여부 확인.
- 확인 결과: 진행 메모·이력은 **알림으로 오지 않고 있었다**(화면 자동 갱신 신호만). 종·토스트·PC 알림 어디에도 항목 없음.
- 구현(`/api/notifications`): 받은 요청을 `assign_mode` 로 가름 — **개인 요청**(single) / **공용 요청**(first·all). 각각 미확인·마감 지남·오늘 마감
  (키 `wr:unread:p|s` 등, 공용은 `/me/requests?filter=shared` 로). 보낸 쪽은 "**내 요청** 완료 확정 대기 / 반려됨". 배지(빨강)는 개인+공용 합.
  **진행 메모 · 수락 · 요청 수정 · 담당자 추가**: 내가 관련된 열린 요청(내 몫 살아 있음 또는 내가 요청자)에서 **다른 사람**이 남긴 이력을
  최근 7일 최신 10건 "결과 통지"(파랑)로 — 키 `wr:ev:<event id>` 라 새 건마다 토스트. 종 숫자에는 포함하지 않음(결과 통지 규칙).
- PC 알림 종류 `wr_memo`(진행 메모, 기본 켬) 추가: 담당자가 쓰면 요청자에게, 요청자가 쓰면 살아 있는 담당자 전원에게(본인 제외).
- 목록에 "개인 요청만 / 공용 요청만" 칩(`?filter=personal|shared`, 받은·전체 탭). 도움말 항목 changes 갱신.
- 한계(솔직): 종 숫자는 여전히 미확인+지남+오늘 마감을 더한 값이라 한 건이 두 번 세어질 수 있다(미확인이면서 지남). 숫자를 "건수"가 아니라
  "확인할 항목 수"로 바꿀지는 사용해 보고 결정.

## 다음 단계

1. 09:00 오늘 마감 크론 첫 실행 확인(2026-11-04). 2. 3·4 배포 확인(선착 수락 → 나머지 해제, 공동 전원 보고 → 처리 보고).
3. 2차 업데이트 전 항목(1~7) 모두 배포 완료 — 다음 요청 대기.
