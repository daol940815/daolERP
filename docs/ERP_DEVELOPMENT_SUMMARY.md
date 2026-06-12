# 다올ERP 회계앱 — ERP 연동 개발 요약 (기획 검토용)

> 작성일: 2026-06-12 · 대상: Claude 등 AI에 컨텍스트로 입력하여 이후 기획 검토에 사용

## 1. 시스템 개요

- **스택**: Next.js 14 (App Router) + Supabase (PostgreSQL) + TypeScript + Tailwind
- **목적**: 자사 회계 관리 — 은행 입출금, 카드매출, 현금영수증, 세금계산서, ERP 주문 데이터를 통합해
  매출처 미수금·매입처 미결제 현황을 자동으로 추적하는 것이 최종 목표
- **데이터 입력 방식**: 각 소스에서 다운로드한 엑셀 파일을 업로드 (ERP 주문 파일은 HTML 테이블 형식의 .xls)
- **마이그레이션**: 자동화 도구 없음 — `my-accounting-app/supabase/migrations/*.sql`을
  Supabase Dashboard SQL Editor에서 수동 실행

## 2. 테이블 구조

### 기존 (ERP 연동 이전)
| 테이블 | 용도 | 거래처 연결 |
|---|---|---|
| `vendors` | 거래처 마스터 (name, biz_number, type[vendor/customer/both], match_aliases[], card_numbers[]) | — (허브) |
| `bank_accounts` / `transactions` | 은행 계좌·입출금내역 (tx_date, amount_in/out, counterparty_name) | `vendor_id` |
| `card_sales` | 카드매출 (승인/취소, approval_number) | `vendor_id` |
| `cash_receipts` | 현금영수증 (direction: sales/purchase, 승인/취소, 취소건 음수) | `vendor_id` |
| `tax_invoices` | 세금계산서 (direction: sales/purchase, issue_date, matched_transaction_id, payment_status) | `vendor_id` |
| `accounts`, `journal_entries/lines` | 계정과목·분개 | |

### ERP 연동 (마이그레이션 019, 020)
| 테이블 | 용도 |
|---|---|
| `erp_vendor_aliases` | ERP 별칭 → vendors 매핑. alias_type(customer/purchase), erp_name UNIQUE, vendor_id, payment_term(advance/monthly). **여러 별칭이 같은 vendor를 가리킬 수 있음** (예: 하나은행 경영지원부/영업지원부 → 하나은행 본점) |
| `erp_orders` | 주문 헤더. order_no UNIQUE, order_date, bank_name+branch_name(매출처), customer_alias_id, staff_name(다올직원=담당직원), total_amount, outstanding_amount(미수금), collect_status(collected/outstanding/in_progress — **ERP 입력값 그대로**) |
| `erp_order_items` | 주문 품목. is_canceled/is_vip/is_prepayment 플래그, purchase_vendor_name+purchase_alias_id(매입처), sale_price/line_total, purchase_total, **settlement_month(정산월, 이월 편집 가능, 재업로드 시 보존)**, channel(채널/상담자) |
| `erp_purchase_settlements` | 매입처×정산월 결제 상태 (unpaid/paid, paid_date, paid_amount) |
| `erp_prepayments` | 선결제 원장. direction(customer/purchase), entry_type(deposit/deduction), 자유 금액, source_key(업로드 시 중복방지) |
| RPC `erp_orders_summary()` | 주문수/순매출/미수금 요약을 DB 단일 집계로 계산 (데이터 증가 대비) |

### 핵심 비즈니스 규칙
- **취소건**(취소여부=cancel): 집계 제외, 화면에 배지만 표시
- **VIP**(품명='VIP' AND 판매가=매입가): 매출/매입 집계 제외, 별도 관리
- **선결제**(품명='선결제'): 집계 제외, 업로드 시 선결제 원장에 입금 자동 등록.
  차감은 수동(반자동) — 선결제 후에도 별도 결제하는 경우가 있어 자동 차감하지 않음
- **순매출 = total_amount − (취소+VIP+선결제 품목 합계)**
- **매입 정산월**: ERP 주문일과 실제 정산월이 다를 수 있어 품목 단위로 이월 가능
- **ERP는 입력 1일 후 수정 불가** → 매입 단가 인상분이 실제 계산서와 다를 수 있음 (실측 대조 필요)
- ERP 파일은 두 가지 헤더 포맷(36열/35열) 자동 감지, 같은 주문번호 재업로드 시 갱신(정산월 보존)

## 3. 구현된 화면

| 메뉴 | 경로 | 기능 |
|---|---|---|
| ERP 주문내역 | `/erp-orders` | 파일 업로드(복수), 전체/VIP/선결제 탭, 기간·상태·검색 필터, 100건 페이지네이션, 요약카드(주문수/순매출/미수금 — RPC로 전체범위 계산), 주문 펼침(품목), 선결제차감 버튼, 선택 삭제 |
| ERP 별칭 매칭 | `/erp-aliases` | 매출처/매입처 탭, 미연결 필터, **이름 유사도 추천**(정규화+포함관계+편집거리), 원클릭 연결, 직접 선택, 신규 거래처 생성+연결, 90%↑ 일괄 연결 |
| ERP 매출처 미수금 | `/reports/erp-receivables` | 매출처(별칭)별 순매출/미수금/선결제잔액, **담당직원(다올직원) 필터**, 거래처 연결 드롭다운, 엑셀 |
| ERP 매입처 결제현황 | `/reports/erp-payables` | 매입처×정산월별 매입액/결제상태, 결제완료/되돌리기/선입금, 품목 펼침+이월, 결제조건(선입금/월말정산), 엑셀 |
| ERP VIP·선결제 | `/reports/erp-special` | VIP 품목 내역, 매출처별 선결제 잔액, 선결제 원장(입금·차감), 엑셀(3시트) |
| 거래처 정산 대조 | `/reports/vendor-reconciliation` | **ERP 매출처/매입처명 기준** ERP 매출/매입 vs 은행 입출금·카드매출·현금영수증·세금계산서 합계와 차액 (매출/매입 탭, 취소 차감, 차액만 필터, 엑셀). 여러 ERP 거래처가 한 vendor를 공유하면(하나은행 부서들) 개별 행은 ERP 금액만, 결제·계산서·차액은 "거래처 합계" 행에 표시. 미연결 ERP 거래처도 ERP 금액과 함께 노출 |
| 매출처 수금현황 / 매입처 결제현황 | `/reports/vendor-status/*` | 기존(비ERP) 거래처 현황 + 엑셀 |

## 4. API 목록 (ERP 관련)

- `POST /api/erp-orders/import` — 파일 업로드·파싱·upsert (별칭 자동생성, 선결제 입금 자동등록, 정산월 보존)
- `GET/DELETE /api/erp-orders` — 목록(페이지네이션+RPC 요약)/삭제
- `GET/PATCH /api/erp-aliases` — 별칭 목록/거래처·결제조건 연결
- `GET/POST/DELETE /api/erp-prepayments` — 선결제 원장 (차감 시 잔액 초과 경고, 차단 안 함)
- `POST/PATCH /api/erp-settlements` — 결제완료/되돌리기(+선입금 차감 옵션), 품목 정산월 이동
- `GET /api/erp-items` — 매입처×정산월 품목 (결제현황 펼침용)
- `GET /api/reports/erp-receivables(+/export)` — 미수금현황 (staff 필터 지원)
- `GET /api/reports/erp-payables(+/export)` — 결제현황
- `GET /api/reports/erp-special(+/export)` — VIP·선결제
- `GET /api/reports/vendor-reconciliation(+/export)` — 정산 대조

집계 로직은 `lib/erp-reports.ts`, `lib/erp-special.ts`, `lib/vendor-reconciliation.ts`,
유사도 매칭은 `lib/name-similarity.ts`에 공용 함수로 분리.

## 5. 자동 결제현황 체크 — 설계 방향 (합의됨)

모든 데이터 소스가 `vendors`를 허브로 연결되는 구조:

```
ERP 주문 ──(erp_vendor_aliases)──┐
은행 입출금 ─────(vendor_id)─────┤
카드매출 ───────(vendor_id)──────┼──→ vendors (허브) → 거래처 단위 대조/매칭
현금영수증 ─────(vendor_id)──────┤
세금계산서 ─────(vendor_id)──────┘
```

### 3단계 로드맵
1. **거래처 단위 대조** ✅ 구현 완료 (`/reports/vendor-reconciliation`)
   — 거래처×기간별 ERP 금액 vs 결제수단 합계 vs 계산서 발행액 차액 확인
2. **건 단위 자동 매칭** (다음 단계, 미구현)
   — 매칭 기록 테이블 추가. **고신뢰(같은 거래처+금액 정확 일치+날짜 1~2일 이내 1:1)는 자동확정**,
   모호한 건(분할입금, 합산입금, 후보 복수)만 "검토대기" 목록으로. 합산입금은 수동 배분 UI.
   기준은 엄격하게 시작해 실데이터 보며 조정
3. **결제현황 자동 체크** (미구현)
   — 배분 완료된 주문 자동 "수금확인". 단 ERP collect_status는 재업로드 시 덮어쓰므로
   **앱 자체 확인 상태를 별도 보관**하고 ERP 상태와 어긋나는 건만 표시

### 주요 결정 사항
- 하나은행 본점처럼 계산서는 한 곳, 주문처(부서)는 여러 곳 → 별칭 여러 개를 같은 vendor에 연결해 해결
- 수금/미수금의 1차 기준은 ERP 입력값. 앱의 매칭은 검증·자동화 보조 (2~3단계에서 자체 상태 도입)
- VIP·선결제 금액은 일반 화면에서 제거, 자료출력의 전용 페이지에서만 확인

## 6. 운영 메모

- 마이그레이션 019(ERP 테이블), 020(요약 RPC)은 Supabase SQL Editor에서 수동 실행 필요
  (020 미적용 시 API가 자동 폴백하므로 동작은 함, 대용량 시 느려짐)
- 업로드된 ERP 데이터: 2025-06 ~ 2026-06, 주문 약 7천 건 / 품목 약 1.6만 행 규모
- 담당직원 예시: 홍창의, 김주연, 김보현, 김대희, 김재형, 옥광일 (erp_orders.staff_name)

## 7. 남은 과제 (우선순위 논의 필요)

1. 건 단위 자동 매칭(2단계) + 자동확정/검토대기 기준 설계
2. 결제현황 자동 체크(3단계) + 앱 자체 수금확인 상태
3. 합산입금(하나은행 본점 등) 수동 배분 UI
4. 은행 거래내역·카드·현금영수증 쪽 거래처 매칭률 향상 (대조 정확도의 전제조건)
5. ERP 단가 차이(1일 후 수정불가) 보정 — 실제 계산서 금액 기준 정산 검증
