-- ERP 주문내역 요약(주문수/순매출/미수금)을 DB에서 단일 집계 쿼리로 계산
-- 행 전체를 API 서버로 가져오지 않으므로 데이터가 쌓여도 속도가 유지됨
CREATE OR REPLACE FUNCTION erp_orders_summary(
  p_from   DATE DEFAULT NULL,
  p_to     DATE DEFAULT NULL,
  p_status TEXT DEFAULT NULL,   -- collected | outstanding | in_progress | NULL(전체)
  p_q      TEXT DEFAULT NULL,   -- 주문번호/은행/지점 검색어
  p_view   TEXT DEFAULT 'all'   -- all | vip | prepayment
)
RETURNS TABLE (total_count BIGINT, net_sales BIGINT, outstanding BIGINT)
LANGUAGE sql STABLE
AS $$
  WITH filtered AS (
    SELECT o.id, o.total_amount, o.outstanding_amount, o.collect_status
    FROM erp_orders o
    WHERE (p_from IS NULL OR o.order_date >= p_from)
      AND (p_to   IS NULL OR o.order_date <= p_to)
      AND (p_status IS NULL OR p_status = 'all' OR o.collect_status = p_status)
      AND (p_q IS NULL OR p_q = ''
           OR o.order_no    ILIKE '%' || p_q || '%'
           OR o.bank_name   ILIKE '%' || p_q || '%'
           OR o.branch_name ILIKE '%' || p_q || '%')
      AND (p_view IS NULL OR p_view = 'all'
           OR (p_view = 'vip' AND EXISTS (
                 SELECT 1 FROM erp_order_items i WHERE i.order_id = o.id AND i.is_vip))
           OR (p_view = 'prepayment' AND EXISTS (
                 SELECT 1 FROM erp_order_items i WHERE i.order_id = o.id AND i.is_prepayment)))
  ),
  excluded AS (
    -- 취소/VIP/선결제 품목 합계 → 순매출에서 제외
    SELECT COALESCE(SUM(i.line_total), 0) AS amt
    FROM erp_order_items i
    JOIN filtered f ON f.id = i.order_id
    WHERE i.is_canceled OR i.is_vip OR i.is_prepayment
  )
  SELECT
    (SELECT COUNT(*) FROM filtered)::BIGINT,
    ((SELECT COALESCE(SUM(total_amount), 0) FROM filtered) - (SELECT amt FROM excluded))::BIGINT,
    (SELECT COALESCE(SUM(outstanding_amount), 0)
       FROM filtered WHERE collect_status <> 'collected')::BIGINT;
$$;
