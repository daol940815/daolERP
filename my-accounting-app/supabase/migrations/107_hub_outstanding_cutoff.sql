-- =====================================================
-- 107_hub_outstanding_cutoff.sql
-- 미수 이중차감 방지 — 업로드 시점 컷오프 규칙 (2026-08 확정)
--
-- 규칙 (lib/vendor-hub.ts JS 폴백과 동일해야 한다):
--   · upload 주문(기존 ERP): ERP가 들고 온 outstanding_amount가 1차 진실.
--     입금 매칭(erp_payment_matches)은 "마지막 업로드(updated_at) 이후 입금분"만
--     추가 차감한다. 업로드 이전 입금은 ERP 값에 이미 반영된 것으로 간주(연결 정보만).
--     재업로드하면 기준선이 이동해 그 이전 매칭은 자동으로 차감 대상에서 빠진다.
--   · direct 주문(자체 주문시스템): 재업로드가 없으므로 모든 매칭이 차감 대상.
--   잔여 미수 = LEAST(GREATEST(0, outstanding_amount - 차감액), 순매출)
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
pay AS (
  -- 업로드 컷오프: upload 주문은 마지막 업로드 이후 입금만, direct 주문은 전액
  SELECT m.order_id, SUM(m.amount) AS alloc
  FROM erp_payment_matches m
  JOIN erp_orders eo2 ON eo2.id = m.order_id
  WHERE COALESCE(eo2.source, 'upload') = 'direct'
     OR m.paid_date > eo2.updated_at::date
  GROUP BY m.order_id
),
o AS (
  SELECT a.vendor_id AS vid,
         eo.order_date,
         GREATEST(0, COALESCE(eo.total_amount, 0) - COALESCE(f.excluded, 0)) AS net,
         LEAST(GREATEST(0, COALESCE(eo.outstanding_amount, 0) - COALESCE(p.alloc, 0)),
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
  LEFT JOIN pay  p ON p.order_id = eo.id
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

-- hub_vendor_summary_json은 위 함수를 감싸므로 자동으로 새 규칙을 따른다.
