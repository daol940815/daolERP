-- 거래처별(매출처 alias) 매출/수익성 집계 RPC
-- 앱에서 erp_order_items를 전량 끌어와 합산하던 방식을 DB 집계로 대체한다.
-- (취소/VIP/선결제 품목 제외, 기간은 erp_orders.order_date 기준)
-- p_from / p_to 가 NULL이면 해당 방향 기간 제한 없음(전체).
CREATE OR REPLACE FUNCTION vendor_sales_analysis(
  p_from DATE,
  p_to   DATE
)
RETURNS TABLE (
  alias_id        UUID,
  erp_name        TEXT,
  vendor_id       UUID,
  vendor_name     TEXT,
  order_count     BIGINT,
  item_count      BIGINT,
  quantity        BIGINT,
  sales_amount    BIGINT,
  purchase_amount BIGINT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    o.customer_alias_id                         AS alias_id,
    a.erp_name                                  AS erp_name,
    a.vendor_id                                 AS vendor_id,
    v.name                                      AS vendor_name,
    COUNT(DISTINCT i.order_id)                  AS order_count,
    COUNT(*)                                    AS item_count,
    COALESCE(SUM(i.quantity), 0)::BIGINT        AS quantity,
    COALESCE(SUM(i.line_total), 0)::BIGINT      AS sales_amount,
    COALESCE(SUM(i.purchase_total), 0)::BIGINT  AS purchase_amount
  FROM erp_order_items i
  JOIN erp_orders o            ON o.id = i.order_id
  LEFT JOIN erp_vendor_aliases a ON a.id = o.customer_alias_id
  LEFT JOIN vendors v            ON v.id = a.vendor_id
  WHERE i.is_canceled   = false
    AND i.is_vip        = false
    AND i.is_prepayment = false
    AND (p_from IS NULL OR o.order_date >= p_from)
    AND (p_to   IS NULL OR o.order_date <= p_to)
  GROUP BY o.customer_alias_id, a.erp_name, a.vendor_id, v.name
$$;
