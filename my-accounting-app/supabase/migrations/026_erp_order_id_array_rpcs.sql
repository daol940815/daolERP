-- order_id .in([...]) 로 대량의 주문 ID를 URL 쿼리스트링에 담아 조회하면
-- 조회 기간이 길어져 주문 건수가 많아질 때 URL이 비대해져 fetch 자체가 실패할 수 있음.
-- RPC(POST body로 배열 전달)로 대체하여 URL 크기와 무관하게 안전하게 집계한다.

-- 주문별 취소/VIP/선결제 품목 합계 (순매출 계산 시 제외할 금액)
CREATE OR REPLACE FUNCTION erp_order_item_exclusions(p_order_ids UUID[])
RETURNS TABLE (order_id UUID, excluded_amount BIGINT)
LANGUAGE sql STABLE
AS $$
  SELECT i.order_id, COALESCE(SUM(i.line_total), 0)::BIGINT
  FROM erp_order_items i
  WHERE i.order_id = ANY(p_order_ids)
    AND (i.is_canceled OR i.is_vip OR i.is_prepayment)
  GROUP BY i.order_id
$$;

-- 주문별 매칭된 수금액 합계 (미수금에서 차감할 금액)
CREATE OR REPLACE FUNCTION erp_order_payment_matches(p_order_ids UUID[])
RETURNS TABLE (order_id UUID, matched_amount BIGINT)
LANGUAGE sql STABLE
AS $$
  SELECT m.order_id, COALESCE(SUM(m.amount), 0)::BIGINT
  FROM erp_payment_matches m
  WHERE m.order_id = ANY(p_order_ids)
  GROUP BY m.order_id
$$;
