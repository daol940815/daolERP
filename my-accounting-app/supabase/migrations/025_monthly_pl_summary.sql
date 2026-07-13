-- 월별 손익현황(매출/매출원가)을 DB에서 월별로 집계
-- erp_order_items를 PostgREST 임베드/페이지네이션을 거치지 않고 단일 쿼리로 집계하여
-- 조회 기간이 길어져도 안전하고, 응답 누락 없이 정확한 결과를 반환한다.
CREATE OR REPLACE FUNCTION monthly_pl_order_summary(
  p_from DATE,
  p_to   DATE
)
RETURNS TABLE (month TEXT, revenue BIGINT, cogs BIGINT)
LANGUAGE sql STABLE
AS $$
  SELECT
    to_char(o.order_date, 'YYYY-MM') AS month,
    COALESCE(SUM(i.line_total), 0)::BIGINT AS revenue,
    COALESCE(SUM(i.purchase_total), 0)::BIGINT AS cogs
  FROM erp_order_items i
  JOIN erp_orders o ON o.id = i.order_id
  WHERE o.order_date BETWEEN p_from AND p_to
    AND NOT i.is_canceled
    AND NOT i.is_vip
    AND NOT i.is_prepayment
  GROUP BY 1
$$;
