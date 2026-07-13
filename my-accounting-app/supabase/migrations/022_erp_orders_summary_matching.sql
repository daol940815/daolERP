-- ERP 주문내역 요약의 미수금을 수금 매칭(erp_payment_matches) 반영분만큼 차감
-- 매칭된 입금이 늘어날수록 미수금 합계가 자연스럽게 줄어들도록 한다.
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
  ),
  matched AS (
    -- 주문별 매칭 입금 합계 (매칭 테이블 미적용 시 빈 결과 → 영향 없음)
    SELECT m.order_id, COALESCE(SUM(m.amount), 0) AS amt
    FROM erp_payment_matches m
    JOIN filtered f ON f.id = m.order_id
    GROUP BY m.order_id
  )
  SELECT
    (SELECT COUNT(*) FROM filtered)::BIGINT,
    ((SELECT COALESCE(SUM(total_amount), 0) FROM filtered) - (SELECT amt FROM excluded))::BIGINT,
    (SELECT COALESCE(SUM(GREATEST(f.outstanding_amount - COALESCE(m.amt, 0), 0)), 0)
       FROM filtered f
       LEFT JOIN matched m ON m.order_id = f.id
       WHERE f.collect_status <> 'collected')::BIGINT;
$$;
