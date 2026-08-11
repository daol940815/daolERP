-- =====================================================
-- 400_card_sales_202605_vat_fix.sql  (회계 트랙)
-- 미결 5번: 카드매출 2026년 5월분 공급가액·세액 미기재(0) 보정
--
-- 2026-08-06 점검 결과: 승인 31건 / 결제금액 합계 24,923,040원 (5/4~5/14).
-- 전제: 사용자가 원자료(PG/카드사 내역) 대조로 "전부 과세" 확인 후 실행할 것.
--       면세 건이 섞여 있으면 실행하지 말고 회계 세션에 알릴 것
--       (면세 건은 공급가=결제금액, 세액=0으로 별도 보정해야 함).
-- 보정식: 공급가 = round(결제금액/1.1), 세액 = 결제금액 - 공급가.
-- 이미 값이 채워진 건(공급가 또는 세액 != 0)은 건드리지 않는다.
-- =====================================================

-- ── STEP 1. 드라이런 (읽기 전용) ─────────────────────────
-- 기대: approval 31건 / sum_amount 24,923,040 / 세액 합 약 2,265,731.
-- cancel 행이 나오면 취소 건도 세액 미기재라는 뜻 — 동일 보정식이 함께 적용됨.
-- 건수·금액이 기대와 다르면 실행 중단하고 회계 세션에 보고할 것.
SELECT transaction_type,
       count(*)                                    AS cnt,
       sum(amount)                                 AS sum_amount,
       sum(round(amount / 1.1)::bigint)            AS supply_sum,
       sum(amount - round(amount / 1.1)::bigint)   AS tax_sum
FROM card_sales
WHERE tx_date >= '2026-05-01' AND tx_date < '2026-06-01'
  AND supply_amount = 0 AND tax_amount = 0 AND amount <> 0
GROUP BY transaction_type;

-- ── STEP 2. 보정 실행 (STEP 1 확인 후) ───────────────────
UPDATE card_sales
SET supply_amount = round(amount / 1.1)::bigint,
    tax_amount    = amount - round(amount / 1.1)::bigint,
    note          = coalesce(note || ' | ', '') || '부가세 보정 2026-08 (원자료 확인, 마이그레이션 400)'
WHERE tx_date >= '2026-05-01' AND tx_date < '2026-06-01'
  AND supply_amount = 0 AND tax_amount = 0 AND amount <> 0;

-- ── STEP 3. 검증 (실행 후) ──────────────────────────────
-- 기대: remaining_zero_vat = 0, mismatch = 0 (2026-05 전체에서 공급가+세액 = 결제금액)
SELECT count(*) FILTER (WHERE supply_amount = 0 AND tax_amount = 0 AND amount <> 0)
         AS remaining_zero_vat,
       count(*) FILTER (WHERE supply_amount + tax_amount <> amount)
         AS mismatch,
       count(*)    AS total_rows_may,
       sum(tax_amount) AS may_tax_total
FROM card_sales
WHERE tx_date >= '2026-05-01' AND tx_date < '2026-06-01';
