# 기능 QA 피드백 보고서 — 2026-06-24

- 대상 브랜치: `claude/elegant-pascal-fTXWT` (HEAD `20e3c68`)
- 대상 앱: `my-accounting-app` (Next.js App Router + Supabase/PostgREST)
- 검증 방법: 정적 검증(타입체크·린트·빌드) + 핵심 로직 감사 + 운영 DB 읽기전용 정합성 점검
- 운영 DB 규모(검증 시점): erp_orders 6,153 / erp_order_items 16,438 / 매출처별칭 1,042 / 매입처별칭 343 / card_sales 105 / tax_invoices 231 / cash_receipts 2 / transactions 307 / vendor_ledger_entries 0

> 핵심 결론: 빌드·타입·린트는 **전부 통과**. 그러나 직전 커밋 `20e3c68`("PostgREST 1000행 한계 페이지네이션")이 **일부 위치를 누락**했고, 그중 **거래처별 매출/수익성 분석 리포트는 현재 데이터로 이미 오집계**된다. 나머지는 데이터가 1,000행을 넘는 시점에 같은 방식으로 깨지는 잠복 결함이다.

---

## 1. 객관 지표 (통과)

| 검사 | 결과 |
|---|---|
| `tsc --noEmit` (타입체크) | ✅ 통과 (오류 0) |
| `next lint` | ✅ 통과 (warning/error 0) |
| `next build` (프로덕션 빌드) | ✅ 통과 (exit 0) |

---

## 2. 발견된 이슈 (심각도순)

### 🔴 [HIGH-1] 거래처별 매출/수익성 분석 리포트 — 현재 오집계 중
- 파일: `lib/vendor-analysis.ts`
- 원인(3중 절단):
  1. `erp_orders ... .limit(50000)` → PostgREST max-rows(1000)로 **6,153건 중 1,000건만** 조회.
  2. 품목 조회 `erp_order_items ... .in(order_id, 500개씩)` (limit/range 없음) → 청크당 1,000행 캡. 주문 500개면 품목 ≈1,335개(>1000)라 **첫 청크부터 절단**.
  3. 매출처 별칭 `erp_vendor_aliases.eq(alias_type,customer)` (limit/range 없음) → **1,042건 중 1,000건만**, 42개 거래처 매핑 누락.
- 영향: 기간을 조금만 넓혀도(주문 ≥ 약 375건) 매출/매입원가/이익이 실제보다 **과소 집계**. 경영 판단용 리포트라 신뢰성 직접 타격.
- 수정: 세 쿼리 모두 공유 `fetchAllRows()`로 페이지네이션. (별칭/주문/품목 동일 패턴)

### 🟠 [MED-1] 예상 부가세 리포트 — 1,000행 초과 시 세액 과소
- 파일: `lib/vat-report.ts` (5개 쿼리: tax_invoices×2, cash_receipts×2, card_sales×1, 각 `.limit(50000~200000)`)
- 현재 상태: card_sales 105 / tax_invoices 231 → **지금은 정상**(잠복).
- 영향: 카드매출·세금계산서가 기간 내 1,000건을 넘기는 순간 매출세액/매입세액이 잘려 **예상 부가세가 틀림**. 세무 직접 연관이라 위험.
- 수정: 5개 쿼리 `fetchAllRows()` 페이지네이션.

### 🟠 [MED-2] 자금현황(현금흐름/잔액) 리포트 — 거래 누적 시 왜곡
- 파일: `lib/cash-reports.ts` (`transactions ... .in(bank_account_id, 50개씩).limit(200000)`)
- 현재 상태: transactions 307 → **지금은 정상**(잠복).
- 영향: 계좌 묶음(최대 50계좌)의 기간 거래가 1,000건을 넘으면 입금/출금/잔액 집계가 잘림. 활성 계좌는 누적상 금방 초과.
- 수정: 청크별 `fetchAllRows()` 페이지네이션(현 `.in()` 청크 루프 안에서 range 추가).

### 🟡 [LOW-1] 내보내기(Export) 4종 — 1,000행 초과 시 누락 다운로드
- 파일: `app/api/{tax-invoices,card-sales,cash-receipts,transactions}/export/route.ts` (`.limit(50000)`)
- 현재 상태: 대상 테이블 모두 <1,000 → **지금은 정상**(잠복).
- 영향: 데이터 증가 시 **경고 없이 일부만 내보내짐**(회계 자료 무결성). erp-orders/erp-aliases export는 이미 `fetchAllRows` 적용됨 — 본 4종만 누락.
- 수정: `fetchAllRows()`로 교체.

> 비고: 위 이슈들은 모두 동일 원인(`.limit(N)`은 PostgREST max-rows를 못 넘음 / limit·range 없는 select는 1,000행 캡)이며, 커밋 `20e3c68`이 손댄 목록에서 빠진 파일들이다. 즉 **그 수정의 후속 누락분**이다.

---

## 3. 추가 관찰 (버그 확정 아님, 확인 권장)

### ℹ️ [OBS-1] 매입처 정산 원장 비어 있음 (vendor_ledger_entries = 0)
- `computeVendorBalances`/`buildVendorMonthlyLedger`(매입처 미지급금)는 `vendor_ledger_entries`에 의존하는데 현재 **0건**.
- 거래처 매칭된 출금이 82건 있음에도 payment 항목이 없음 → 동기화(`syncTransactionPaymentEntry`)가 한 번도 실행 안 됐거나, 매칭된 거래처가 매출처(입금)뿐이라 payment(출금)가 안 생긴 정상 상태일 수 있음. **매입처 출금 매칭 후 원장 입금항목 생성 경로**가 실제로 도는지 1건으로 확인 권장.

### ℹ️ [OBS-2] 세금계산서 결제상태가 이진(binary)
- `recalcInvoiceStatus`: 전액 충족 시 `matched`, 그 외 전부 `unmatched`. **부분결제**가 미결제와 구분되지 않음(상태상). 분할결제 기능을 넣은 취지를 감안하면 `partial` 상태 도입 고려.

---

## 4. 양호 확인 항목
- 월별 손익현황(`pl-report.ts`): 무거운 집계를 DB RPC(`monthly_pl_*_summary`)로 처리 → 1,000행 문제 회피. ✅
- 매입처 미지급금/거래처원장(`vendor-ledger.ts`): 자체 `fetchAllRows`로 페이지네이션 적용. ✅
- ERP 주문 import / 매칭(`erp-orders/import`, `erp-matching.ts`): 별칭/주문/품목 모두 `fetchAllRows`·청크 적용. customer_alias_id 매칭 정상(별도 검증에서 6,153건 100% 연결 확인). ✅
- 거래처 자동매칭(`match-vendors`): 정규화 비교 + 단일후보(length≥2)만 확정 → 과매칭 가드 양호. ✅
- 세금계산서 분할/합산 결제(`tax-invoice-payments.server.ts`): 합계 초과 방지·멱등 upsert 적용. ✅

---

## 5. 권고 (우선순위)
1. **HIGH-1 즉시 수정** — 거래처별 매출/수익성 분석은 지금 틀린 숫자를 보여주고 있음.
2. **MED-1/MED-2 수정** — 부가세·자금현황은 세무/자금 판단 직접 연관. 데이터가 임계(1,000) 근접 전에 처리.
3. **LOW-1 수정** — 내보내기 4종.
4. **재발 방지** — `.limit(아주 큰 수)` 패턴을 금지하고, "전체 조회"는 반드시 `fetchAllRows()`만 쓰도록 규칙화(린트 규칙/리뷰 체크리스트). 현재 `lib/fetch-all-rows.ts`와 `lib/vendor-ledger.ts`에 **동일 헬퍼가 중복 정의**돼 있으니 하나로 통일 권장.

*검증은 모두 읽기전용(SELECT)으로 수행했으며, 본 작업으로 운영 데이터·스키마를 변경하지 않았다.*
