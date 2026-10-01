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

## 미결

- [ ] 급여 구분값 목록 확정
- [ ] 4대보험·주휴수당 요율·적용 조건(단기 아르바이트 가입 요건) — 세무사·노무사 확인
- [ ] 영업일지 예정일 입력 칸 — 개인화면 트랙(300) 조율
- [ ] 근로계약서·보안서약서 양식 수령
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
