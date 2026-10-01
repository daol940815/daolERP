# 다올커머스 신규 ERP — 요구사항 대비 현황 점검 보고서

작성: 2026-09-28 (총괄 세션) · 기준 코드: main `2b69b51` · 분석만 수행, 코드·DB 무수정
상태 표기: **[구현]** 요구를 충족 / **[부분]** 일부 충족 또는 다른 형태로 존재 / **[미구현]** 없음
근거 표기: 파일·함수·테이블·컬럼. "(추측)"은 코드로 확인하지 못한 판단.
DB 스키마는 `my-accounting-app/supabase/migrations/*.sql` 기준(이 환경에는 DB 접속 키가 없어
실제 적용 여부는 각 트랙 문서의 실행 기록으로 보완).

---

## 1. 프로젝트 개요

**기술**: Next.js 14 App Router + TypeScript + Tailwind / Supabase(Postgres·Auth·Storage) /
Vercel(icn1) / exceljs·nodemailer·ag-grid. 앱 루트 `my-accounting-app/`.

**화면 구역 (3개 모드)**
- `(dashboard)` 회계·경영 모드 — admin 전용 (`app/(dashboard)/layout.tsx`가 admin 외 `/me`로 리다이렉트). 60여 화면.
- `(orders)` 직원 워크스페이스 — `/me`(내 대시보드·영업일지·업무일지), `/orders/*`(주문 현황·상담일지·신규 주문·품목 관리·발주서·매입처 관리·샘플 재고, 배송 관리는 '준비 중').
- `(hr)` 근태·휴가.
- 인증: `middleware.ts`(전 경로) + `lib/user-role.ts`(역할 3단계 sales/manager/admin).

**주요 파일**
- 주문·상담·발주: `lib/orders-portal.ts`, `lib/orders-portal-list.ts`, `lib/consultations.ts`, `lib/purchase-orders.ts`, `lib/po-form.ts`, `lib/trade-statement.ts`, `app/(orders)/orders/form-shared.tsx`(주문·상담 공용 폼)
- 고객·담당자: `lib/vendor-hub.ts`(매출처 허브 집계), `lib/contact-manager.ts`(담당자 관리), `lib/contact-label.ts`
- 매입처: `lib/purchase-hub.ts`, `lib/purchase-cycle-status.ts`
- 회계·자금: `lib/cash-reports.ts`, `lib/pl-report.ts`, `lib/vat-report.ts`, `lib/erp-matching.ts`, `lib/sales-collection-match.ts`, `lib/purchase-payment-match.ts`, `lib/journal/*`
- 대시보드: `app/(dashboard)/page.tsx` + `_components/MgmtTab·CashTab·WorkTab.tsx`

**테이블 (마이그레이션 기준, 영역별)**

| 영역 | 테이블 | 비고 |
|---|---|---|
| 마스터 | `vendor_groups`(505) → `vendors`(002, group_id·purchase_kind·uses_custom_po·po_use_sale_price·invoice_email·fax·biz_number·ceo_name) → `contacts` + `contact_assignments`(100) / `employees`(100·103·104) / `vendor_staff`(100) / `erp_products`(500~504·509·703·800) / `accounts`(001) | 3단계 고객 구조 존재 |
| 별칭·연결 | `erp_vendor_aliases`(019, payment_term 매입처용) / `contact_name_links`(105) / `vendor_match_aliases`(014) | 업로드 주문의 표기 → 마스터 연결 |
| 주문 | `erp_orders`·`erp_order_items`(019·023·500·511) / `erp_consultations`·`erp_consultation_items`(506·509·701·702) / `erp_order_change_requests`(500) / `erp_order_edit_logs`(511) | source=upload(기존 ERP)·direct(자체 입력) 이중 소스 |
| 발주 | `erp_purchase_orders`·`erp_purchase_order_items`(507) / `erp_po_mail_presets`·`erp_po_attachments`·`erp_po_send_logs`(510) / Storage `po-attachments` | 매입처별 1장 |
| 수금·정산 | `erp_payment_matches`(021) / `erp_order_invoices`(067) / `erp_purchase_settlements`·`erp_vendor_ledger_entries`(019·033) / `tax_invoices`(013·027·030·034) / `purchase_cycle_*`(060~063) / 601 컷오프 링크 | 주문↔입금↔계산서 3단 대사 |
| 원본 회계 | `transactions`(003·032·049·065) / `bank_accounts`(007·010·024) / `card_sales`·`card_expenses`(016·038) / `cash_receipts`(018) / `journal_entries`(004·039) / `loans`(402~405) / `account_opening_balances`·`vendor_opening_balances`(043·048) / `vat_manual_entries`(106) | 원본 보존 + 분류·전기 |
| 인사·활동 | `attendance_*`(200) / `contact_activities`(105, 영업일지) / `erp_work_logs`(700, 업무일지) | |
| 기타 | `erp_sample_moves`·`erp_sample_stocktakes`(800·801) | 요아럽 샘플 재고 |

---

## 2. 항목별 점검표

### 2-A. 데이터 구조 요구사항

| 요구사항 | 상태 | 근거 | 비고 |
|---|---|---|---|
| 2-1 고객 3단계(기관/조직단위/담당자) | [부분] | `vendor_groups`(기관) → `vendors.group_id`(조직단위=지점) → `contacts`+`contact_assignments`(담당자). 실데이터 이관 완료: 지점 973·담당자 1,400·이동 이력 172 (`docs/customer-management-track.md`) | **조직단위 유형 구분 없음** — `vendors`에 본점/지점/부서를 가르는 컬럼이 없어 "은행 부서"와 "지점"이 같은 모양. 부서 없는 업체는 `group_id NULL` 지점 1행으로 표현(구조적으로는 무방) |
| 2-2 청구처 자동 결정 | [미구현] | `erp_orders`에 청구처 컬럼 없음(bank_name·branch_name·customer_alias_id·vendor_id만). 코드 전체에 청구처/billing 개념 없음(grep 0) | 세금계산서 연결(`erp_order_invoices`)·수금 매칭이 전부 **지점(vendors) 단위**로 쌓이고 있음 |
| 2-2 청구처별 결제조건(결제일·결제방법) 자동 적용 | [미구현] | 유일한 결제조건은 `erp_vendor_aliases.payment_term`(advance/monthly) — **매입처 정산 전용**. 매출처 결제일·결제방법 저장처 없음. 상담일지 `payment_info_enc`(506)는 건별 암호문(구조화 아님) | |
| 2-3 기관·조직단위별 + 담당자별 이중 조회 | [구현] | `/sales-hub`(지점) ↔ `/sales-hub/contacts`(담당자) 토글, 108 `hub_customer_flags` KPI 양쪽 표시, `lib/contact-manager.ts` | admin 전용 화면(권한 항목 참조) |
| 2-3 담당자 독립 엔티티 + 소속 이력 | [구현] | `contacts`(인물) + `contact_assignments`(vendor_id·title·started_at·ended_at). 이동해도 contact_id 유지 → 이력 보존. 병합(`merged_into_id`) 지원 | 요구사항 권장 구조와 정확히 일치 |
| 2-4 직원별 담당 고객 지정 | [부분] | `vendor_staff`(vendor_id·employee_id·is_primary·started_at·ended_at) — **지점 단위**. 허브 상세에서 개별 지정 | 담당자(인물) 단위 다올 담당 없음 — 트랙 문서 미결로 기록됨 |
| 2-4 담당자 변경·퇴사 시 일괄 이관 | [미구현] | 일괄 이관 UI·API 없음(grep 0). 이관 이력 97건은 엑셀 이행 스크립트로 처리 | 현재는 지점마다 개별 변경 |
| 2-5 상품 마스터 판매가·매입가(주문 시 수정 가능) | [구현] | `erp_products.sale_price·purchase_price·individual_sale_price·carton_unit·carton_shipping_fee·loose_shipping_fee·is_addon`, 주문·상담 폼에서 추천값 후 수정 가능(`form-shared.tsx`), 원가표 엑셀 업로드 | |

### 2-B. ① 기준정보

| 요구사항 | 상태 | 근거 | 비고 |
|---|---|---|---|
| 기관/조직단위/담당자 관리 | [부분] | 위 2-1·2-3. 등록: 상담일지·주문 입력 인라인 등록(업체+지점+담당자 한 번에), 허브 상세 편집 | 조직단위 유형 없음 |
| 청구처 지정·결제조건 | [미구현] | 위 2-2 | |
| 매입처 관리 | [구현] | `/orders/purchase-hub`(주문 모드)·`/purchase-hub`(회계 모드), 600~602, `vendors.purchase_kind`, 508 담당자 이메일, 509 계산서 이메일·팩스·사업자번호·대표자명, 자체양식·판매가 발주 플래그 | |
| 상품 관리(판매가·매입가·매입처) | [구현] | `/orders/products` + `/api/orders-portal/products/import`(원가표 파서 v2), 품절 플래그(509) | |
| 직원·권한 관리 | [부분] | `/employees` 직원·계정 관리(계정 발급·비밀번호·일괄 삭제), `employees.role` 3단계 | 요구 4역할과 불일치(⑦ 참조) |

### 2-C. ② 영업관리 (영업자)

| 요구사항 | 상태 | 근거 | 비고 |
|---|---|---|---|
| 로그인 시 내 담당 고객 우선 표시 | [부분] | `/me` 내 대시보드: `my_dashboard_summary`(300) — 이번 달 내 주문·미수·담당 거래처 수·영업일지 | **담당 고객 목록 화면이 워크스페이스에 없음.** 고객 목록(`/sales-hub`)은 회계 모드라 sales 역할은 접근 불가(`(dashboard)/layout.tsx` 리다이렉트) |
| 고객/담당자 상세 한 화면(상담·주문·미수·최근 연락) | [부분] | `/sales-hub/[vendorId]` 탭 7개(주문·수금·계산서·담당 등), `/sales-hub/contacts/[contactId]` 이력·커넥션·영업일지 | 화면 자체는 요구 충족. 단 admin 전용이라 **영업자는 못 봄** |
| 기관 기준 ↔ 담당자 기준 전환 | [구현] | 허브 토글 + 108 KPI 투트랙 | admin 전용 |
| 일정 기간 상담·주문 없는 고객 표시 | [구현] | `lib/contact-manager.ts` 미주문 90/180일 자동 판정(수동 상태 없음), 108 신규/이탈 플래그 | 상담 기준 판정은 없음(주문 기준만) |

### 2-D. ③ 상담·주문 (영업지원)

| 요구사항 | 상태 | 근거 | 비고 |
|---|---|---|---|
| 상담일지 작성 | [구현] | `erp_consultations`(506)·품목별 상태·기타사항·할인·카톤·마진율(509·702), `/orders/consultations` | 실물 '주문상담' 시트 3,588행 분석 기반 |
| 상담 → 주문 전환 시 재입력 없음 | [구현] | `/orders/new?consult=<id>` 프리필 → 저장 시 `erp_orders.consultation_id` 연결, 상담 1건 → 주문 N건 분할 허용 | 자유 입력 거래처는 마스터 등록 안내 배너 |
| 주문 상태: 상담→확정→발주→배송중→수령완료(+취소/반품) | [부분] | 단계별로 **따로 파생**: 상담 `status`(진행중/주문전환/종결) · 주문 수금 `collect_status` · 발주 배지(미발주/부분/완료, `lib/purchase-orders.ts`) · 품목 `delivery_status`(in_transit/delivered/issue)+송장 유무 파생(`lib/erp-delivery-status.ts`) · 취소·재등록(511 `canceled_at·reissued_to_order_id`) | **주문 단위 단일 상태 축 없음**, '수령완료' 기록처 없음, 반품 없음 |
| 배송유형 지점/개별 구분 | [구현] | `erp_order_items.order_kind`(지점/개별/샘플) + 가격·배송비 규칙(502·503: 지점=카톤 배송비, 개별=개별판매가) | 주문 헤더가 아닌 품목 단위 구분 |
| 개별배송: 배송지 엑셀 업로드, 배송지 단위 상태·송장 | [미구현] | **배송지 테이블 없음**(5xx·7xx에 address 컬럼 없음). 배송명단은 발주서 엑셀 2번째 시트에 수령인만 프리필하고 주소·연락처·송장은 **수기 보완**(`lib/po-form.ts` ROSTER_HEADERS). 송장·배송상태 컬럼은 품목 단위(023)만 | 개별배송 핵심 기능 공백 |

### 2-E. ④ 발주·배송 (영업지원)

| 요구사항 | 상태 | 근거 | 비고 |
|---|---|---|---|
| 매입처별 발주서 자동 분리 | [구현] | 주문 상세 발주 섹션이 품목을 `purchase_alias_id`별로 묶어 매입처당 `erp_purchase_orders` 1장 생성(507), 중복 발주 방지(`order_item_id`) | |
| 발주서 PDF/엑셀 생성, 메일 발송, 발송 여부 기록 | [부분] | 엑셀: exceljs(`lib/purchase-orders.ts`) · 메일: nodemailer + 프리셋·변수 치환·첨부 대체(510) · 기록: `send_method·sent_at·sent_by·send_error` + `erp_po_send_logs`(실발송 제목·본문·첨부명 보존) | **PDF 없음**(엑셀·미리보기만) |
| 개별배송 배송지 목록 발주서 첨부 | [부분] | 배송명단 시트 자동 포함 — 단 수령인만 프리필, 주소 등 수기 | 배송지 데이터가 없어 "첨부"라기보다 "빈 양식 동봉" |
| 송장 등록: 수동 + 엑셀 일괄(컬럼 매핑) | [미구현] | `erp_order_items.tracking_number` 컬럼(023)은 있으나 **쓰기 경로 없음**(app/api·lib에 갱신 코드 0). 회계 모드 ERP주문내역이 업로드 데이터의 송장을 표시만 | 기존 ERP 업로드에 의존 중 |
| 송장 미등록 알림(발주 후 N일) | [부분] | 주문 단위 파생 상태 '송장기입'(`lib/erp-delivery-status.ts`)으로 필터 가능(회계 모드 ERP주문내역) | 발주일 기준 경과일 목록 없음, 워크스페이스에 없음 |
| 택배사 배송조회 연동, 배송완료 자동 반영 | [미구현] | 연동 코드 없음(grep 0) | 4페이즈 계획(`docs/order-system-track.md` "4 배송현황 관리") |
| 송장 등록 = 출고 처리 | [미구현] | 출고 개념·이벤트 없음 | |

### 2-F. ⑤ 매출·매입 정산 (회계)

| 요구사항 | 상태 | 근거 | 비고 |
|---|---|---|---|
| 세금계산서 발행 대상: 청구처 기준 합산 목록 | [부분] | `erp_order_invoices`(067) 주문↔계산서 합산/분할 연결, 매출처 허브 주문별 발행/미발행 배지, `/tax-invoices/*` | 청구처 개념 부재 → **지점 단위**. "발행해야 할 목록" 전용 화면 없음 |
| 결제조건 기반 입금예정일 자동 계산 | [미구현] | 결제조건 없음(2-2). 예정일 컬럼·계산 없음(grep 0) | |
| 입금 확인, 미수 경과일 30/60/90 | [구현] | `erp_payment_matches`(021) 입금↔주문 매칭(자동 추천·확정), 107 업로드 컷오프 규칙, `/reports/receivables-aging`(bucket_30/60/90/over), 매출처 허브 미수 | |
| 매입처별 매입계산서·지급예정일·미지급금 | [부분] | 매입처 허브(600·601 기초원장·컷오프), `/reports/payables-aging`, `purchase-cycle`(계산서↔지급 사이클), 매입 세금계산서 분류 | 지급예정일은 `payment_term`(선입금/월정산) 수준의 규칙만, 날짜 계산 없음 |
| 주문별 마진 | [구현] | 주문 상세 '예상 마진'(`app/(orders)/orders/[id]/page.tsx`, 전 직원 공개 2026-08-13 결정), 상담 품목 마진율(509), `/reports/vendor-profitability` | |

### 2-G. ⑥ 자금현황 대시보드 (임원·대표)

| 요구사항 | 상태 | 근거 | 비고 |
|---|---|---|---|
| 현재 계좌 잔액(통장 업로드 기준) | [구현] | `lib/cash-reports.ts` — `transactions.balance` 원본을 계좌별 carry-forward, `/reports/cash-position`·`/reports/daily-cash`, 대시보드 CashTab, 마이너스통장 한도(024) | |
| 이번 달/다음 달 입금 예정 vs 지급 예정 | [미구현] | 예정일 개념 없음. MgmtTab에 대출 월 상환액(원금·이자)만 | 결제조건(2-2)이 선행 조건 |
| 미수금 합계, 장기 미수 거래처 | [구현] | 대시보드 공통 요약(허브 단일 진실 `buildHubList`), receivables-aging | |
| 미지급금 합계 | [구현] | `buildPurchaseHubList`, 과다지급 분리 표시 | |
| 월별 매출·매입·마진 추이, 기관별 매출 순위 | [부분] | `/reports/monthly-pl`(025·028·058 회계 기준 월별 손익), `/reports/vendor-sales`·`lib/vendor-analysis.ts`(지점 단위 매출 분석) | **기관(vendor_groups) 단위 순위 없음**(grep 0). 주문 기준 마진 추이(판매−매입) 월별 화면 없음 |
| 조회 전용(원천 자동 집계, 직접 수정 불가) | [구현] | 대시보드·리포트에 숫자 입력 UI 없음. 유일한 쓰기는 미등록 계좌 등록(`OrphanedAccountsSection` → `/api/bank-accounts`, 숫자 아님). 기초잔액은 '추천만'(046) | 예외: 부가세 신고서 수동 항목(106)은 신고서 화면 한정 |

### 2-H. ⑦ 권한

| 역할(요구) | 상태 | 근거 | 비고 |
|---|---|---|---|
| 영업자: 영업관리·고객 조회(본인 중심) | [부분] | `sales` = 워크스페이스만. `/me` 본인 KPI, 상담일지 본인 기본 | 고객 목록·상세 없음(② 참조) |
| 영업지원: 상담·주문·발주·배송(전체 주문) | [부분] | 전체 주문 열람은 `manager`+(상담일지 전체 토글), 주문·발주 입력은 전 직원 | "영업지원" 역할 자체가 없음 — manager는 승인 권한까지 포함 |
| 회계: 정산·자금(금액 수정) | [미구현] | 회계 모드 = `admin`만. 회계 전용 역할 없음 | |
| 임원·대표: 자금현황·리포트 조회 전용 | [미구현] | 조회 전용 역할 없음 — 대표가 보려면 admin(전체 수정 권한) | |

---

## 3. 데이터 구조 이슈 (지금 고치지 않으면 비용이 커지는 것)

**이슈 1. 청구처가 없다 — 가장 큰 구조 공백.**
`vendors`(지점)에 본점/지점/부서 유형도, 청구처 참조도 없다. 그 결과 세금계산서 연결(`erp_order_invoices`)·입금 매칭(`erp_payment_matches`)·미수 집계가 전부 지점 단위로 쌓이고 있다. 은행 부서 주문의 본점 청구, 청구처 기준 합산 발행, 입금예정일 계산이 모두 이 위에 서야 하는데 토대가 없다. 시간이 갈수록 "지점 단위로 연결된 계산서·입금"이 늘어 나중에 청구처 단위로 재편할 때 재매칭 비용이 커진다.
권장: `vendors.unit_type`(head/branch/dept) + `vendors.billing_vendor_id`(NULL=자기 자신) + 결제조건 컬럼(결제일 규칙·결제방법)을 **vendors에** 추가하고, 주문 저장 시 청구처를 스냅샷(`erp_orders.billing_vendor_id`)으로 기록. 기존 데이터는 기본값(자기 자신)으로 안전하게 채워진다.

**이슈 2. 결제조건이 별칭 테이블에 붙어 있다.**
`erp_vendor_aliases.payment_term`은 매입처 정산 방식인데 마스터(`vendors`)가 아니라 별칭에 있어, 별칭이 여러 개인 매입처는 조건이 분산된다. 매출처 결제조건을 만들 때 같은 실수를 반복하지 말고 마스터(청구처)에 둘 것.

**이슈 3. 배송지·출고 엔티티가 없다.**
송장·배송상태가 `erp_order_items`의 컬럼(품목 단위)뿐이라 개별배송(한 주문 → 여러 배송지)을 표현할 수 없다. 배송명단이 엑셀 수기 보완으로 남는 이유가 이것이다. 배송 4페이즈를 품목 컬럼 위에 얹으면 개별배송을 결국 다시 뜯게 된다.
권장: `erp_shipments`(order_id·po_id·recipient·address·phone·carrier·tracking_number·status·shipped_at·delivered_at) 신설 — 지점배송은 1행, 개별배송은 N행. 송장 등록 = 행 생성(=출고), 택배 조회 = 행 갱신.

**이슈 4. 주문 상태의 단일 축이 없다.**
수금·발주·배송·취소가 각기 다른 테이블/컬럼에서 파생된다. 현재 방식(파생)은 원본 철학과 맞고 유지해도 되지만, 요구 흐름(상담→확정→발주→배송중→수령)을 목록에서 한 컬럼으로 보려면 **파생 규칙을 한 함수로 고정**해야 한다(`lib/erp-delivery-status.ts`처럼). 이슈 3이 해결되면 '배송중/수령완료'가 그 함수에 들어간다.

**이슈 5. 업로드 주문과 직접 입력 주문의 이중 소스.**
`erp_orders.source`(upload/direct)가 공존하며, 하류는 텍스트 컬럼(bank_name·manager_name·staff_name·channel)에 의존한다. 내 대시보드(300)의 "내 주문"도 `staff_name = 직원 이름` **이름 대조**다(동명이인·개명·퇴사자 재입사에 취약). 기존 ERP 중단 시점에 FK(`created_by_employee_id`·`counselor_employee_id`·`vendor_id`·`contact_id`) 기준으로 전환하는 계획이 필요하다.

**이슈 6. 권한 모델이 요구(4역할)보다 좁다.**
`role`이 sales/manager/admin 3단계라 회계 담당·조회 전용 임원을 만들 수 없다. 특히 대표 계정이 admin이면 "조회 전용" 요구를 구조적으로 보장하지 못한다. 컬럼 하나(`employees.role` 값 추가)와 레이아웃 가드 수정으로 끝나는 일이라 비용은 작지만, 늦게 하면 회계 화면마다 조건이 흩어진다.

**이슈 7. 담당자(인물) 단위 다올 담당이 없다.**
`vendor_staff`는 지점 단위라, 은행 담당자가 다른 지점으로 이동했을 때 "그 사람은 계속 홍창의 담당"을 표현할 수 없다(트랙 문서에 잔여 8건 미결로 기록됨). 영업이 담당자 중심이라는 요구와 어긋난다. `contact_staff`(contact_id·employee_id·기간) 또는 `vendor_staff`에 contact_id 선택 컬럼으로 해결 가능.

---

## 4. 미구현·부분구현 항목의 개발 순서 제안

요구사항의 우선순위 기준(1단계 고객 구조→상담→주문→발주→송장→배송조회 / 2단계 정산·자금 / 3단계 영업자·리포트)에 맞춰 정리. 상담·주문·발주까지는 이미 운영 중이므로 1단계의 남은 것은 "청구처"와 "배송"이다.

**1단계 잔여 (구조부터)**
1. **청구처·결제조건** — 이슈 1·2. vendors 유형·청구처 참조·결제조건 → 주문 저장 시 청구처 자동 결정·스냅샷. 기존 데이터는 기본값 백필. 이것이 2단계 전부(발행 대상·입금예정·자금 예정)의 선행 조건.
2. **배송지·출고 엔티티 + 송장 등록** — 이슈 3. `erp_shipments` 신설 → 개별배송 배송지 엑셀 업로드(상담/주문 시점) → 발주서 배송명단에 실제 데이터 첨부 → 송장 수동 등록 + 엑셀 일괄(매입처별 컬럼 매핑 저장) → 송장 등록=출고.
3. **송장 미등록 목록** — 발주(`erp_purchase_orders.sent_at`) 후 N일 경과·shipment 없는 건. 워크스페이스 발주서 메뉴에 KPI+칩으로.
4. **택배 조회 연동** — 스마트택배/스윗트래커류 API로 shipment 상태 갱신·배송완료 자동 반영. (외부 API 계약 필요 — 사용자 결정)
5. **주문 상태 파생 함수 통합** — 이슈 4. 목록·상세에 단일 상태 컬럼.
6. **권한 4역할** — 이슈 6. 비용이 작고 이후 화면마다 반복되므로 1단계 안에 처리 권장.

**2단계 (정산·자금)**
7. 입금예정일·지급예정일 자동 계산(결제조건 기반) → 미수·미지급 화면에 예정일 열.
8. 자금현황: 이번 달/다음 달 입금 예정 vs 지급 예정(7의 결과 + 대출 상환) — CashTab에 추가.
9. 청구처 기준 세금계산서 발행 대상 목록(미발행 주문을 청구처별 합산).
10. 기관(vendor_groups) 단위 매출 순위, 주문 기준 월별 마진 추이.

**3단계 (영업자·리포트)**
11. 워크스페이스 "내 고객" 화면 — 허브 목록·상세의 영업자용 축소판(본인 담당 필터 기본). 이슈 7(인물 단위 담당)과 함께.
12. 담당 일괄 이관(직원 A → B, 기간 기록).
13. 발주서 PDF(현재 엑셀·미리보기).

---

## 5. 점검 체크리스트 답변

| # | 질문 | 답 | 근거 |
|---|---|---|---|
| 1 | 담당자가 지점을 옮겨도 거래 이력이 유지되는가? | **예** | `contacts` 독립 + `contact_assignments` 기간 이력. 주문은 `contact_id`·`contact_name_links`로 인물에 연결 |
| 2 | 은행 부서 주문 시 청구처가 본점으로 자동 지정되는가? | **아니오** | 청구처 개념·조직 유형 없음 |
| 3 | 상담일지→주문→발주서까지 재입력하는 곳이 없는가? | **대체로 예** | 상담→주문 프리필, 주문 품목→발주서 생성. 예외: 개별배송 **배송지 정보는 발주서 엑셀에 수기** |
| 4 | 한 주문에 매입처가 2곳 이상일 때 발주서가 나뉘는가? | **예** | 매입처별 `erp_purchase_orders` 1장(507) |
| 5 | 개별배송에서 배송지별 송장·상태를 따로 관리하는가? | **아니오** | 배송지 엔티티 없음, 송장은 품목 단위 컬럼이며 입력 경로도 없음 |
| 6 | 송장이 안 들어온 발주 건을 한눈에 찾을 수 있는가? | **아니오** | 회계 모드에 주문 단위 '송장기입' 파생 상태만 있고, 발주 기준 경과일 목록·워크스페이스 화면 없음 |
| 7 | 자금현황 숫자를 사람이 직접 고칠 수 있는 곳이 있는가? | **없음 (정상)** | 대시보드·리포트에 숫자 입력 UI 없음. 기초잔액은 추천만(046). 예외: 부가세 신고서 수동 항목(106)은 신고서 화면 한정 |
| 8 | 영업자 로그인 시 자기 고객만 먼저 보이는가? | **부분 (사실상 아니오)** | `/me`에 본인 KPI(담당 거래처 수 등)는 보이나 **고객 목록·상세 화면이 영업자에게 없음** |
| 9 | 결제조건이 청구처 단위로 저장되고 주문에 자동 적용되는가? | **아니오** | 매출처 결제조건 저장처 없음. 매입처 `payment_term`만 별칭 단위 존재 |

---

## 요약

- 상담→주문→발주서 발송까지의 실무 흐름과, 고객 3단계·담당자 이력·매입처·상품·미수·미지급·계좌잔액·조회 전용 대시보드는 갖춰져 있다.
- 요구사항과 어긋나는 **구조적 공백은 셋**: 청구처(결제조건 포함), 배송지·출고 엔티티, 권한 4역할. 이 셋은 화면이 아니라 데이터 구조 문제라 뒤로 미룰수록 재작업이 커진다.
- 기능 공백은 배송 단계 전체(송장 등록·미등록 알림·택배 조회)와 예정일 기반 자금 예측, 영업자용 고객 화면이다.
