# 인사·총무 트랙 — 인수인계 문서

담당: **별도 세션 (인사·총무 트랙)**. 마이그레이션 번호: **200번대** (근태 200 적용 완료 → 201부터).
근태·휴가의 기존 설계는 `docs/attendance-design.md`(이 트랙의 전신). 화면 시안:
`docs/mockups/인사총무_확장_시안.html`. 권한·메뉴 체계는 `docs/ui-reorg-track.md`와 CLAUDE.md.
시작일: 2026-09-29 (총괄 세션에서 시안·결정까지 진행 후 분리).

## 배경

- 조직: CLAUDE.md "회사 조직" — 인사·총무는 경영지원팀(강시현 총괄부사장·오철준 대리). 대부분 수기.
- 현재 시스템에 있는 것: 근태·휴가(200번대, `/hr/attendance`·`/hr/admin`·`/hr/approvals`),
  직원·계정·권한(`/employees`, 109). 급여·아르바이트·스케줄은 없음 — 처음부터 설계.
- 화면 구조(2026-09-29 재조정): 영역 4개 중 **인사·총무** 영역. 메뉴는 `lib/menu-registry.ts`의
  `hr` 그룹에 항목을 추가한다(사이드바 파일 없음). 권한은 그룹 단위(hr) + 별도 잠금
  `employees.can_view_salary`(급여). API는 `API_OWNERS`에 등록(`/api/hr/...` 권장).

## 확정 사항 (2026-09-29, 사용자)

1. **급여는 "기록"부터** — 계산(4대보험·세금·수당)은 2단계. 기록 항목: 귀속월·지급 총액·지급일·
   **구분값(필수 — 월급/상여/일당/수당 등, 목록은 이 트랙에서 확정)**·메모·(선택) 통장 이체 연결.
2. **영업일지에 예정일 추가** — 스케줄의 "영업 일정" 원천. `contact_activities.planned_date`
   (105 테이블, 총괄 소유 — 컬럼 추가는 이 트랙 마이그레이션에서 해도 됨. 영업일지 화면
   `/me/journal`(300번대)에 예정일 입력 칸 추가 필요 — 개인화면 트랙과 조율).
3. **아르바이트 수당 즉시 계산**: 아르바이트는 매일 출근·퇴근 시간을 기록한다(기존 출퇴근 체크
   재사용). 시급 × 근무시간으로 **즉시 근사값** 표시(주휴수당 미반영 표기). **정산은 근무 종료 후**
   주휴수당 + 4대보험 적용해 확정. 요율·적용 조건은 설정값으로 두고 세무사·노무사 확인 항목으로.
4. **직원 목록에 아르바이트 제외** — 아르바이트는 "아르바이트 관리"에서만. 대신 고용형태에
   **계약직 추가**: `employees.employment_type` = regular(정규) / **contract(계약직)** / parttime(아르바이트).
   109의 CHECK 제약(regular·parttime)을 201에서 재정의하고, 타입 선언
   (`lib/user-role.ts` employmentType, `app/(dashboard)/employees/permission-panel.tsx` 고용 형태 select,
   `middleware.ts` loadSubject)도 함께 확장할 것 — 총괄 소유 파일이지만 이 변경은 허용.
5. 권한 편집은 직원 상세 안의 버튼으로 옮겨도 됨(시안 질문 d — 사용자 무응답, 트랙 판단).
6. 근로계약서·보안서약서 **양식은 사용자가 시행 후 전달** — 그 전에는 서명본 업로드·보관만.

## 데이터 계획 (안 — 이 트랙에서 확정)

| 항목 | 저장 | 비고 |
|---|---|---|
| 급여 기록 | `employee_salaries`(employee_id, pay_month, kind, gross_amount, paid_on, memo, tx_id NULL) | 열람·입력 = can_view_salary + hr 권한. 엑셀 다운로드 |
| 직원 상세 근태·휴가 탭 | 기존 attendance 테이블 재사용 | 무변경 |
| 스케줄 | 저장 없음 — 휴가 + 영업일지 planned_date + 업무일지 + 아르바이트 기간 + 공휴일표 | 조회 전용. 경영 현황(mgmt 그룹)에도 항목 추가 |
| 아르바이트 | `parttime_terms`(employee_id, season, hourly_rate, supervisor_employee_id, start/end, contract_doc, nda_doc, status, settled_at, settlement JSONB) + 출퇴근 기록(기존) | 즉시 근사 = Σ(퇴근−출근)×시급. 정산 = 주휴수당·4대보험 적용 확정값 저장 |
| 계약직 | employment_type='contract' + work_start/end(109 컬럼 재사용) | 직원 목록에 포함(아르바이트만 제외) |

## 진행 순서 (권장)

1. 201 마이그레이션: employment_type 제약 확장(contract) + employee_salaries + parttime_terms +
   contact_activities.planned_date → 드라이런·사용자 실행·검증 보고
2. 직원 목록(아르바이트 제외, 계약직 표시) + 직원 상세 탭(기본·급여 기록·근태·휴가)
3. 아르바이트 관리(등록=계정 자동 발급·주문 발주 권한, 출퇴근 기반 즉시 계산, 종료 후 정산)
4. 스케줄(조회 캘린더) + 경영 현황 노출
5. 문서 생성(양식 수령 후)
각 단계: 빌드 → main 병합 → 트랙 문서 갱신.

## 직원 스케줄 (2026-10-14 사용자 요청 — 시안 검토 대기)

확인 항목 5개: ① 직원 휴가 ② 영업자 영업일정 ③ 직원 업무일정 ④ 아르바이트 근무기간 ⑤ 직원 생일.
시안: `docs/mockups/직원스케줄_시안.html` (월 캘린더 + 기간 타임라인 두 보기, 조회 전용).

데이터 원천 조사 결과:
- ① 휴가 `attendance_leaves`(200) — **있음**
- ② 영업일정 — **없음**. `contact_activities`(105)에는 `activity_date`(실행일)와
  `next_action`(텍스트)뿐이라 `planned_date` 컬럼 추가 + 영업일지 화면 입력칸 필요(300·700 트랙 조율)
- ③ 업무일정 — `erp_work_logs`(700)는 **지나간 기록**이고 예정 개념이 없음. 정책 결정 필요
- ④ 아르바이트 근무기간 — `employees.work_start`/`work_end`(109)로 **지금도 가능**
- ⑤ 생일 — **없음**. `employees.birth_date` 추가 필요 + 노출 범위 결정
- 공휴일 배경 `attendance_holidays`(201) — **있음**

단계 제안: 1단계(휴가·아르바이트·공휴일·생일) → 2단계(영업일정·업무일정, 타 트랙 입력 화면 동반).
확정 대기: 업무일정 예정/기록 여부, 생일 노출 범위, 휴가 사유 표시, 조회 권한 범위, 담당 세션.

### 스케줄 1단계 — 구현 완료 (2026-10-14)

화면 `/hr/schedule` (인사·총무 그룹), API `GET /api/schedule?month=YYYY-MM`, 공용 로직 `lib/schedule.ts`.
**마이그레이션 없음** — 기존 데이터만 읽는다. 월 캘린더 + 기간 타임라인 두 보기, 항목 칩 필터,
날짜 클릭 상세, 다가오는 일정(2주).

표시 항목과 원천:

| 항목 | 원천 | 비고 |
|---|---|---|
| 휴가(승인) | `attendance_leaves` status=approved | 종류만 표시, **사유는 싣지 않는다**(병가·경조사 보호) |
| 휴가(대기) | 같은 테이블 status=requested | 점선·흐리게 — 겹침 확인용 |
| 아르바이트 근무기간 | `employees.work_start/work_end` + employment_type=parttime | 기간 막대 |
| 공휴일 | `attendance_holidays`(201) | 배경 + 목록 |
| 대출 원리금 상환일 | `loans.payment_day`(402) + 월 원금·이자 | **금액 포함** |
| 세무 반복 마감 | 코드 상수(`lib/schedule.ts`) | 원천세·4대보험 매월 10일, 부가세 1·4·7·10월 25일, 법인세 3/31·중간예납 8/31 |

- **휴일 순연**: 세무 마감·대출 상환일이 주말·공휴일이면 다음 영업일로 옮겨 표시하고
  원래 기한을 함께 적는다(`nextBusinessDay`). 공휴일표가 있으므로 정확히 계산된다.
- **권한**: 화면·API는 `hr` 그룹 조회(`API_OWNERS`에 `/api/schedule` 등록).
  금액이 붙는 자금 항목(대출·세무)은 라우트에서 `can(me,'accounting','view')`로 한 번 더 걸러
  **권한 없으면 응답에 담지 않는다**(화면에서 숨기는 것이 아니라 서버에서 제외).
- 미포함(2단계로): 생일, 수금·지급 예정, 카드 출금일, 급여일, 영업 예정일, 납품·출고·배송 예정일,
  외근·회의(유일한 수동 입력 항목), 경영 현황 영역 노출.

### 스케줄 관리 탭 (202, 2026-10-15 — 마이그레이션 실행 대기)

ERP 원본에 자리가 없는 일정을 한곳에서 관리한다. 사용자 결정(2026-10-14~15):
세무 마감도 코드 상수에서 이 표로 **옮겼고**, 외근·회의 같은 **1회성 일정도 포함**한다.

- 테이블 `schedule_rules`(202): title · category(payroll/tax/company/meeting/other) ·
  repeat_kind(monthly/yearly/once) · repeat_day(**31=말일**) · repeat_month · on_date/end_date ·
  **holiday_shift(prev/next/none)** · amount · employee_id · finance_only · active · memo
- **휴일 처리 방향이 항목마다 다르다** — 이번 설계의 핵심:
  - 세무 신고·납부, 자동이체 → `next` (다음 영업일로 순연)
  - **급여 → `prev` (말일이 휴일이면 직전 영업일로 앞당김)** — 2026-10-14 사용자 확인
  - 1회성 일정은 사람이 정한 날짜라 옮기지 않는다(저장 시 `none` 고정)
- 초기 데이터(202에 포함): 원천세·4대보험(매월 10일) · 부가세 4회(1·4·7·10월 25일) ·
  법인세 신고(3/31)·중간예납(8/31) — 모두 `finance_only` · 급여일(매월 말일·앞당김, 전체 공개)
- 화면: `/hr/schedule` **캘린더 / 관리** 탭 (`?tab=rules`, PageTabs 관례).
  등록·수정·삭제·끄기는 인사·총무 수정 권한, `finance_only` 건은 회계 조회 권한도 함께 필요.
  조회 시 회계 권한이 없으면 `finance_only` 건을 **서버에서 제외**한다.
- 캘린더는 `lib/schedule.ts`의 `expandRules`로 그 달 날짜를 계산한다 — 반복은 날짜를 저장하지 않는다.
- 법인카드 대금 출금일은 날짜 확인 후 화면에서 등록(카드사별로 다를 수 있어 초기 데이터에 미포함).

### 스케줄 2단계 설계 — 거래처 결제 조건 (매입·매출 공통, 2026-10-14 확정 · 미구현)

사용자 방향: **스케줄러에 직접 입력하지 않고 ERP 마스터에 조건을 두고 파생시킨다.**
`vendors`는 매출처·매입처 공용 마스터이므로 **두 벌(수금·지급)을 한 번에** 설계한다.

```sql
-- 202_vendor_payment_terms.sql (안 — 아직 작성·실행하지 않음)
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS ar_term_kind  TEXT,       -- 수금(매출) 조건 종류
  ADD COLUMN IF NOT EXISTS ar_term_value SMALLINT,   -- 종류에 따른 숫자
  ADD COLUMN IF NOT EXISTS ar_term_memo  TEXT,
  ADD COLUMN IF NOT EXISTS ap_term_kind  TEXT,       -- 지급(매입) 조건 종류
  ADD COLUMN IF NOT EXISTS ap_term_value SMALLINT,
  ADD COLUMN IF NOT EXISTS ap_term_memo  TEXT;
-- kind CHECK: monthly | next_month | after_issue | advance | per_case  (NULL=미설정)
```

- `value` 의미: `monthly` 매월 N일(**31=말일**, `loans.payment_day`와 같은 규칙) /
  `next_month` 익월 N일 / `after_issue` 계산서 발행 후 N일 / `advance`·`per_case`는 값 없음(일정 생성 안 함)
- **날짜가 아니라 조건을 저장한다** — 날짜 하나를 저장하면 이번 달만 맞는다.
- **금액은 새로 계산하지 않는다** — 매입처 허브(600)의 미지급 잔액, 매출처 허브의 미수 잔액을
  그대로 가져와 "10일 · OO상사 · 3,200,000원 예정"으로 보여준다.
- 입력 화면: 매입처 관리(`/purchase-hub`)·매출처 허브(`/sales-hub`) 상세. **600 트랙·총괄 세션과 조율 필요**
  (vendors는 공용 마스터).
- 주의: `erp_orders.payment_term`('advance'/'monthly')이 이미 있다 — 주문 단위 조건.
  **거래처 조건을 기본값으로, 주문에서 덮어쓰는 관계**로 명시해야 충돌하지 않는다.
- 함께 필요한 것: `card_accounts.payment_day`(카드별 결제일), 급여일·회사 설정값
  (단일 행 설정 테이블 신설 또는 기존 설정 재사용). **급여일·카드 출금일 실제 날짜는 사용자 확인 필요.**

## 미결

- [ ] 급여 구분값 목록 확정
- [ ] 4대보험·주휴수당 요율·적용 조건(단기 아르바이트 가입 요건) — 세무사·노무사 확인
- [ ] 영업일지 예정일 입력 칸 — 개인화면 트랙(300) 조율
- [ ] 근로계약서·보안서약서 양식 수령
- [x] **급여일 = 매월 말일, 휴일이면 앞당김** (2026-10-14 사용자 확인). 세무 기한(순연)과
  **반대 방향**이라 휴일 처리에 방향 값이 필요하다 — `nextBusinessDay`만으로는 부족하고
  `prevBusinessDay`를 함께 둬야 한다. 앞당김 폭이 '직전 영업일'인지 확인 필요.
- [ ] **법인카드 출금일** — 사용자 확인 중. 확인되면 스케줄 관리 탭에서 직접 등록하면 된다(코드 변경 불필요). 원래는 (카드사·카드별로 다를 수 있어 `card_accounts`에 둘 후보)
- [ ] 스케줄 2단계: vendors 결제 조건 컬럼 — 600 트랙·총괄 세션과 조율 후 진행
- [ ] 스케줄 경영 현황(mgmt) 영역 노출 — 사장님용. 1단계는 인사·총무에만 노출
- [ ] 한정호 사원 등록·권한(김주연 복사) — 사용자 수동

## 총괄 트랙 요청문 — 직원 상세와 내 정보 부품 공유 (2026-10-01 사용자 동의)

> 총괄이 **내 정보** 화면(`/me/profile`, 내 업무 그룹, 전 영역 공통)을 먼저 만들었습니다. 직원 상세(진행 순서 2단계)는
> 같은 부품을 써서 두 번 만들지 않습니다.
> - 읽기 전용 인사 정보 카드: `app/(orders)/me/profile/profile-client.tsx`의 `EmployeeBasicCard({ emp, today, right })`
>   (`EmployeeRow` 타입 export). 직원 상세의 '기본' 탭은 이 카드 + 인사 편집(팀·직위·입사일·고용형태·근무기간) 폼.
> - 본인 API `/api/me/profile`(GET 본인만 / PATCH 연락처만)은 그대로 두고, 직원 상세는 `/api/employees` 쪽에서
>   같은 컬럼(`EMP_COLS`)을 내려주면 카드를 바로 재사용할 수 있습니다.
> - 급여 탭은 내 정보에 두지 않기로 확정(사용자). 급여 기록(`employee_salaries`) 열람은 직원 상세(can_view_salary + hr)에서만.
> - 연락처(phone·email)는 본인이 내 정보에서 직접 수정합니다(사용자 확정). 직원 상세에서도 수정 가능하되 이력은 없음.
> - 권한 정보는 내 정보에 노출하지 않습니다(사용자 결정) — 직원 상세(인사 뷰)에서만.
> - `employment_type`에 'contract'를 추가하면 내 정보 카드의 고용 형태 라벨(`EMPLOYMENT_LABEL`)에 이미 '계약직'이 있어 추가 수정 불필요.
