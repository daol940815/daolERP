# daolERP — 프로젝트 컨텍스트

한국어 업무 중심 자사 ERP. Next.js 14 (App Router) + Supabase + Vercel.
앱 루트는 `my-accounting-app/` (저장소 루트가 아님).

## 핵심 철학

**"원본데이터를 통한 회계 및 경영관리"** — ERP 주문·통장·카드·계산서 등 원본을
보존하고, 원본을 처리(분류·확정·매칭)하면 회계가 자동 생성된다.

절대 원칙:
- 원본 데이터는 수정하지 않는다. 연결·해석 정보만 추가한다.
- 시스템은 추천만, 확정은 사용자가 한다. 기확정 값은 덮어쓰지 않는다.
- 모든 집계 숫자는 원본 화면으로 드릴다운 가능해야 한다.
- DB 데이터 변경 작업은 사용자 승인 후 실행하고, 실행 후 검증 보고를 남긴다.
- UI·문서·커밋에 이모지를 쓰지 않는다.
- 사용자에게는 솔직하게 평가한다 — 맞으면 맞다, 아니면 아니라고.

## 모듈 구조 (계층)

공통 마스터 → 원본데이터 → 연결 계층(별칭·매칭·분류) → 업무 모듈 → 경영 계층

- 업무 모듈: 영업·주문(구축 중) / 매출처 관리(허브+거래처 담당자) / 구매·매입처 / 회계 / 인사
- 마스터는 한 곳에서만 등록·수정, 나머지는 참조만:
  - 직원: `employees` (로그인 계정·권한 포함) — 화면: 직원·계정 관리
  - 거래처: `vendors` + 별칭 `erp_vendor_aliases` — 화면: 매출처 허브 / 매입처 관리
  - 거래처 담당자(고객사 인물): `contacts` + `contact_assignments` (A안: 인물 마스터 단일화.
    CRM 트랙의 crm_contacts는 사용하지 않기로 확정)
  - 계정과목: `accounts`

## 직원 마스터 (employees) — 인사·근태 기능은 반드시 이 테이블 참조

- 100에서 생성, 103·104에서 확장: `position, phone, email, hire_date, role, auth_user_id, login_id`
- role 3단계: `sales`(직원) / `manager`(중간 관리자: 주문+승인, 회계 접근 불가) / `admin`(전체 관리자)
- 로그인: login_id → `{login_id}@daol.internal` 내부 이메일로 Supabase Auth 인증 (`lib/user-role.ts`)
- 주의: 거래처 관리 엑셀 적재로 로그인 계정 없는 직원(auth_user_id NULL, 상담자 21명)이 존재함.
  근태 대상 여부는 사용자에게 확인할 것.
- 새 직원 테이블을 만들지 말 것. 확장이 필요하면 employees에 컬럼 추가 또는 참조 테이블.

## 직원 개인화면 트랙 참고 (300번대, 별도 세션)

- 목적: 일반 직원은 개인화면 + 주문 관리만 사용. 회계 등 중요 데이터 접근 차단은
  이미 구조화되어 있음 — (dashboard) 레이아웃이 admin 외 역할을 `/orders`로 리다이렉트.
- 개인화면은 (orders) 그룹 하위(`/orders/...`) 또는 별도 그룹으로 — middleware 가드 구조 유지.
- "본인 관련 정보" 데이터 소스: 내 입력 주문 `erp_orders.staff_name`(이름 대조) ·
  내 상담 주문 `erp_order_items.channel` · 내 담당 거래처 `vendor_staff.employee_id` ·
  내 영업일지 `contact_activities.employee_id` · 근태(200번대 트랙에서 생성 예정).
- 주문 포털 사이드바 `app/(orders)/orders/orders-sidebar.tsx`는 허브·주문 트랙도 수정하는
  파일 — main 병합 전 rebase 필수.

## 마이그레이션 규칙 (번호 충돌 주의 — 병행 세션 있음)

- 실행은 사용자가 Supabase SQL 편집기에서 직접 한다. 파일만 만들어 전달할 것.
- 번호 대역: `06x~07x` CRM 트랙(별도 세션) / `100번대` 매출처 허브·주문시스템·담당자 관리 /
  `200번대` 인사·근태 트랙 / **`300번대` 직원 개인화면(마이페이지) 트랙** /
  새 트랙은 다음 100번대를 사용.
- 현재 적용 완료: 100~105.

## 개발·배포 규칙

- 빌드 검증: `cd my-accounting-app && npx next build` (통과 후에만 커밋)
- 브랜치에서 작업 → main에 `--no-ff` 병합 → push → Vercel 자동배포.
  병행 세션이 있으므로 main 병합 전 원격 main을 먼저 pull/rebase 할 것.
- Vercel 함수 리전은 서울(icn1) 고정 (`my-accounting-app/vercel.json`) — Supabase가
  ap-northeast-2에 있어 리전을 바꾸면 로딩이 수 초 느려진다.
- Supabase 서비스 키는 저장소에 없다. DB 직접 조회가 필요하면 사용자에게 요청
  (`sb_secret_...` 키, `.env.local`은 gitignored).

## 자주 걸리는 함정

- PostgREST max-rows=1000: 단일 조회·RPC 결과 모두 1000행에서 잘린다.
  `lib/fetch-all-rows.ts`의 `fetchAllRows`(range 페이지네이션) 사용. 대량 집계는
  JSONB 단일 응답 RPC 패턴 참고(`102_hub_summary_json.sql`).
- `.in()`에 수백 개 id를 넣으면 URL 초과로 400 — 100~200개 청크로 나눌 것.
- 페이지 인증: `middleware.ts`가 전 경로 가드. (dashboard) 레이아웃은 admin 전용,
  직원·중간관리자는 `/orders`(주문 포털)로 리다이렉트.
- API 대량 응답·순차 쿼리는 병렬화(Promise.all)·청크 처리 — 기존 lib 패턴 따를 것.

## UI 관례

- 전부 한국어. Tailwind, 기존 페이지 스타일(둥근 카드, slate 팔레트, 얇은 표) 따름.
- 사이드바: `components/layout/Sidebar.tsx` — 경영관리 / 회계 / 원본데이터 / 정리 도구
  4그룹 접이식. 새 관리 화면은 대개 경영관리 그룹.
- 목록 화면 패턴: KPI 카드(클릭=필터) + 통합 검색 + 칩 필터 + 표. 상태는 수동 입력이
  아니라 데이터에서 자동 판정.
