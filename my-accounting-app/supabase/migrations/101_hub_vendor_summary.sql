-- =====================================================
-- 101_hub_vendor_summary.sql
-- 매출처 허브 목록 집계 RPC — 전체 주문(3만+행)을 앱으로 끌어오지 않고
-- DB에서 매출처별로 집계해 1회 왕복으로 반환한다 (목록 로딩 10초 → 1~2초).
--
-- 규칙은 lib/vendor-hub.ts의 JS 폴백과 동일해야 한다:
--   순매출  = GREATEST(0, 주문총액 - 취소/VIP/선결제 품목 합)
--   미수    = LEAST(GREATEST(0, ERP outstanding_amount), 순매출)
--   over90  = 미수 > 0 이고 주문일이 90일 이전인 주문의 미수 합 (기간 내)
--   VIP     = is_vip AND NOT is_canceled 품목 합 (기간 무관 누적)
--   last_order_date = 기간 무관 최근 주문일 (휴면 판정용)
-- =====================================================

CREATE OR REPLACE FUNCTION hub_vendor_summary(p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL)
RETURNS TABLE (
  vendor_id       UUID,
  order_count     INT,
  net             BIGINT,
  outstanding     BIGINT,
  over90          BIGINT,
  vip_total       BIGINT,
  last_order_date DATE
)
LANGUAGE sql
STABLE
AS $$
WITH flag AS (
  SELECT order_id,
         SUM(COALESCE(line_total, 0)) AS excluded,
         SUM(CASE WHEN is_vip AND NOT is_canceled THEN COALESCE(line_total, 0) ELSE 0 END) AS vip
  FROM erp_order_items
  WHERE is_canceled OR is_vip OR is_prepayment
  GROUP BY order_id
),
o AS (
  SELECT a.vendor_id AS vid,
         eo.order_date,
         GREATEST(0, COALESCE(eo.total_amount, 0) - COALESCE(f.excluded, 0)) AS net,
         LEAST(GREATEST(0, COALESCE(eo.outstanding_amount, 0)),
               GREATEST(0, COALESCE(eo.total_amount, 0) - COALESCE(f.excluded, 0))) AS outp,
         COALESCE(f.vip, 0) AS vip,
         ((p_from IS NULL OR eo.order_date >= p_from)
          AND (p_to IS NULL OR eo.order_date <= p_to)) AS inp
  FROM erp_orders eo
  JOIN erp_vendor_aliases a
    ON a.id = eo.customer_alias_id
   AND a.alias_type = 'customer'
   AND a.vendor_id IS NOT NULL
  LEFT JOIN flag f ON f.order_id = eo.id
)
SELECT vid,
       COALESCE(COUNT(*) FILTER (WHERE inp), 0)::INT,
       COALESCE(SUM(net)  FILTER (WHERE inp), 0)::BIGINT,
       COALESCE(SUM(outp) FILTER (WHERE inp), 0)::BIGINT,
       COALESCE(SUM(outp) FILTER (WHERE inp AND outp > 0 AND order_date < CURRENT_DATE - 90), 0)::BIGINT,
       COALESCE(SUM(vip), 0)::BIGINT,
       MAX(order_date)
FROM o
GROUP BY vid
$$;
