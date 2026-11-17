-- =====================================================
-- invoice_status_backfill_check.sql  (조회만 — 아무것도 바꾸지 않음. 1302 실행 뒤에 돌린다)
-- 계산서 상태를 3단계(미확인 · 부분 확인 · 확인됨)로 맞추기 전에, 기존 계산서 중 바뀔 건수를 본다.
--   A. 지금 미확인인데 입금이 일부 붙어 있음            → 부분 확인으로 바꿀 대상
--   B. 지금 확인됨인데 붙은 입금 합계가 합계금액에 못 미침 → 사람이 확인한 것으로 보고 "수동 확인" 표시를 붙일 대상(상태는 그대로 확인됨)
-- 결과를 알려주시면 1303(보정 실행) 파일을 만들어 드립니다.
-- =====================================================
WITH paid AS (
  SELECT t.id, t.direction, t.total_amount, t.payment_status,
         COALESCE((SELECT SUM(p.amount) FROM tax_invoice_payments p WHERE p.tax_invoice_id = t.id), 0) AS paid
  FROM tax_invoices t
)
SELECT
  count(*) FILTER (WHERE payment_status = 'unmatched' AND total_amount > 0 AND paid > 0 AND paid < total_amount)                  AS "A_부분확인으로_바꿀_건수",
  COALESCE(SUM(paid) FILTER (WHERE payment_status = 'unmatched' AND total_amount > 0 AND paid > 0 AND paid < total_amount), 0)    AS "A_붙은_입금_합계",
  count(*) FILTER (WHERE payment_status = 'unmatched' AND total_amount > 0 AND paid > 0 AND paid < total_amount AND direction = 'sales')    AS "A_중_매출",
  count(*) FILTER (WHERE payment_status = 'unmatched' AND total_amount > 0 AND paid > 0 AND paid < total_amount AND direction = 'purchase') AS "A_중_매입",
  count(*) FILTER (WHERE payment_status = 'matched' AND total_amount > 0 AND paid < total_amount)                                 AS "B_수동확인_표시할_건수",
  count(*) FILTER (WHERE payment_status = 'matched' AND total_amount > 0 AND paid = 0)                                            AS "B_중_입금이_하나도_없는_건수",
  count(*) FILTER (WHERE payment_status = 'unmatched' AND total_amount > 0 AND paid >= total_amount)                              AS "참고_미확인인데_전액_붙은_건수(0이어야_정상)"
FROM paid;
