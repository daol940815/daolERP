-- =====================================================
-- prepay_billable_dryrun.sql  (결제처리 트랙 — 1308 적용 전 드라이런, DB를 바꾸지 않음)
-- 선결제 품목이 있는 주문: 지금 미수 vs 1308 적용 후 미수 (청구 금액 = 순매출 + 유효 선결제 품목)
-- 결과를 그대로 알려 주세요. ① 주문별 목록 ② 합계 두 개입니다.
-- =====================================================

-- ① 주문별 — 취소 주문 제외
WITH it AS (
  SELECT i.order_id,
         SUM(CASE WHEN i.is_canceled OR i.is_vip OR i.is_prepayment THEN 0 ELSE COALESCE(i.line_total, 0) END) AS net_amount,
         SUM(CASE WHEN i.is_prepayment AND NOT i.is_canceled AND NOT i.is_vip THEN COALESCE(i.line_total, 0) ELSE 0 END) AS prepay_amount
  FROM erp_order_items i GROUP BY i.order_id
)
SELECT v.order_no, v.order_date, v.source, v.bank_name, v.branch_name,
       it.net_amount            AS 순매출,
       it.prepay_amount         AS 선결제,
       it.net_amount + it.prepay_amount AS 청구금액,
       v.raw_outstanding        AS 원본미수,
       v.matched_deducted       AS 매칭,
       v.outstanding            AS 지금_미수,
       CASE WHEN v.collect_status = 'collected' THEN 0
            ELSE LEAST(GREATEST(0, v.raw_outstanding - v.matched_deducted), GREATEST(0, it.net_amount + it.prepay_amount)) END AS 바뀐뒤_미수
FROM v_erp_order_receivable v
JOIN it ON it.order_id = v.order_id
JOIN erp_orders o ON o.id = v.order_id AND o.canceled_at IS NULL
WHERE it.prepay_amount > 0
ORDER BY v.order_date DESC, v.order_no DESC;

-- ② 합계 — 미수가 얼마나 늘어나는지
WITH it AS (
  SELECT i.order_id,
         SUM(CASE WHEN i.is_canceled OR i.is_vip OR i.is_prepayment THEN 0 ELSE COALESCE(i.line_total, 0) END) AS net_amount,
         SUM(CASE WHEN i.is_prepayment AND NOT i.is_canceled AND NOT i.is_vip THEN COALESCE(i.line_total, 0) ELSE 0 END) AS prepay_amount
  FROM erp_order_items i GROUP BY i.order_id
), x AS (
  SELECT v.outstanding AS now_out,
         CASE WHEN v.collect_status = 'collected' THEN 0
              ELSE LEAST(GREATEST(0, v.raw_outstanding - v.matched_deducted), GREATEST(0, it.net_amount + it.prepay_amount)) END AS new_out
  FROM v_erp_order_receivable v JOIN it ON it.order_id = v.order_id
  JOIN erp_orders o ON o.id = v.order_id AND o.canceled_at IS NULL
)
SELECT count(*) FILTER (WHERE new_out <> now_out) AS 미수가_바뀌는_주문수,
       COALESCE(SUM(new_out - now_out), 0)         AS 늘어나는_미수_합계,
       COALESCE(SUM(now_out), 0)                   AS 지금_전체_미수,
       COALESCE(SUM(new_out), 0)                   AS 바뀐뒤_전체_미수
FROM x;
