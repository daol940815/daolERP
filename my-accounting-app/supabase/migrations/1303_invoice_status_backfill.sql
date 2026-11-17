-- =====================================================
-- 1303_invoice_status_backfill.sql  (결제처리 트랙 + 회계 트랙 — docs/payment-track.md · docs/accounting-track.md)
-- 기존 계산서 상태를 3단계(미확인 · 부분 확인 · 확인됨)에 맞춰 보정  — 데이터 변경. 사용자 승인 후 실행.
-- 선행: 1302 (적용 2026-11-17)
--
-- 사전 조회 결과 (2026-11-17, checks/invoice_status_backfill_check.sql)
--   A. 미확인인데 입금이 일부 붙어 있음              18건 (매출 1 · 매입 17, 붙은 입금 합계 57,630,251원)
--   B. 확인됨인데 붙은 입금 합계가 합계금액에 못 미침  413건 (그중 입금이 하나도 없는 것 395건)
--   참고. 미확인인데 전액 붙은 건                      0건
--
-- 무엇을 바꾸나
--   A → payment_status 를 'partial'(부분 확인)로. 금액 · 입금 연결은 그대로.
--   B → payment_manual = true 표시만. 상태는 '확인됨' 그대로 둔다.
--        (사람이 확인 처리했거나 취소쌍 정리로 확인된 계산서 — 앞으로 입금을 붙이거나 풀어도 확인됨이 지워지지 않게)
-- 바꾸지 않는 것: 계산서 금액 · 거래처 · 입금 연결 · 분개. 음수(수정) 계산서는 대상이 아니다.
-- 재실행 안전(같은 조건을 다시 판정 — 두 번째 실행은 0건).
-- =====================================================

WITH paid AS (
  SELECT t.id, COALESCE((SELECT SUM(p.amount) FROM tax_invoice_payments p WHERE p.tax_invoice_id = t.id), 0) AS paid
  FROM tax_invoices t
  WHERE t.total_amount > 0
),
a AS (
  UPDATE tax_invoices t SET payment_status = 'partial'
  FROM paid
  WHERE paid.id = t.id AND t.payment_status = 'unmatched' AND paid.paid > 0 AND paid.paid < t.total_amount
  RETURNING t.id
),
b AS (
  UPDATE tax_invoices t SET payment_manual = true
  FROM paid
  WHERE paid.id = t.id AND t.payment_status = 'matched' AND paid.paid < t.total_amount AND t.payment_manual = false
  RETURNING t.id
)
SELECT (SELECT count(*) FROM a) AS "A_부분확인으로_바꾼_건수_기대18",
       (SELECT count(*) FROM b) AS "B_수동확인_표시한_건수_기대413";

-- ── 검증 (실행 후 위 결과와 아래 결과를 알려주세요) ──────────────────────────
SELECT
  (SELECT count(*) FROM tax_invoices WHERE payment_status = 'partial')    AS "부분확인_기대18",
  (SELECT count(*) FROM tax_invoices WHERE payment_status = 'matched')    AS "확인됨_기대5337(변동없음)",
  (SELECT count(*) FROM tax_invoices WHERE payment_status = 'unmatched')  AS "미확인_기대1308(1326-18)",
  (SELECT count(*) FROM tax_invoices WHERE payment_manual)                AS "수동확인_기대413",
  (SELECT count(*) FROM tax_invoices t WHERE t.payment_status = 'partial' AND t.direction = 'sales')    AS "부분확인_중_매출_기대1",
  (SELECT count(*) FROM tax_invoices t WHERE t.payment_status = 'partial' AND t.direction = 'purchase') AS "부분확인_중_매입_기대17",
  (SELECT count(*) FROM tax_invoices)                                     AS "계산서_전체_기대6663(5337+1326)";
