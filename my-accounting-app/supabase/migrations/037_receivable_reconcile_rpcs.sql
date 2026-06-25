-- 매출처 미수금현황 / 거래처 대사의 ERP측 집계를 DB로 옮기는 RPC들 (RPC 우선 + 폴백).

-- ③-a 매출처 미수금현황: 매출처(고객 alias)별 주문 집계.
--   total_amount = Σ(주문 총액 − 취소/VIP/선결제 품목합)
--   outstanding  = Σ max(미수금 − 매칭수금, 0)  (미수금완료 제외)
--   p_staff 지정 시 해당 담당직원 주문만 (NULL=전체).
CREATE OR REPLACE FUNCTION erp_receivable_summary(p_from DATE, p_to DATE, p_staff TEXT)
RETURNS TABLE (
  alias_id          UUID,
  order_count       BIGINT,
  total_amount      BIGINT,
  excluded_amount   BIGINT,
  outstanding_amount BIGINT,
  outstanding_count BIGINT,
  staff_names       TEXT[]
)
LANGUAGE sql STABLE
AS $$
  WITH ord AS (
    SELECT
      o.id, o.customer_alias_id, o.total_amount, o.outstanding_amount, o.collect_status, o.staff_name,
      COALESCE((SELECT SUM(it.line_total) FROM erp_order_items it
                WHERE it.order_id = o.id AND (it.is_canceled OR it.is_vip OR it.is_prepayment)), 0) AS excluded,
      COALESCE((SELECT SUM(m.amount) FROM erp_payment_matches m WHERE m.order_id = o.id), 0) AS matched
    FROM erp_orders o
    WHERE (p_from IS NULL OR o.order_date >= p_from)
      AND (p_to   IS NULL OR o.order_date <= p_to)
      AND (p_staff IS NULL OR btrim(COALESCE(o.staff_name, '')) = p_staff)
  )
  SELECT
    customer_alias_id AS alias_id,
    COUNT(*)::BIGINT AS order_count,
    COALESCE(SUM(COALESCE(total_amount,0) - excluded), 0)::BIGINT AS total_amount,
    COALESCE(SUM(excluded), 0)::BIGINT AS excluded_amount,
    COALESCE(SUM(CASE WHEN collect_status <> 'collected'
                      THEN GREATEST(COALESCE(outstanding_amount,0) - matched, 0) ELSE 0 END), 0)::BIGINT AS outstanding_amount,
    COUNT(*) FILTER (WHERE collect_status <> 'collected'
                       AND GREATEST(COALESCE(outstanding_amount,0) - matched, 0) > 0)::BIGINT AS outstanding_count,
    COALESCE(ARRAY_AGG(DISTINCT btrim(staff_name)) FILTER (WHERE btrim(COALESCE(staff_name,'')) <> ''), '{}') AS staff_names
  FROM ord
  GROUP BY customer_alias_id
$$;

-- ③-b 미수금현황 담당직원 드롭다운 목록 (staff 필터와 무관하게 기간 내 전체)
CREATE OR REPLACE FUNCTION erp_receivable_staff_names(p_from DATE, p_to DATE)
RETURNS TABLE (staff_name TEXT)
LANGUAGE sql STABLE
AS $$
  SELECT DISTINCT btrim(o.staff_name)
  FROM erp_orders o
  WHERE (p_from IS NULL OR o.order_date >= p_from)
    AND (p_to   IS NULL OR o.order_date <= p_to)
    AND btrim(COALESCE(o.staff_name, '')) <> ''
$$;

-- ④-a 거래처 대사(매출): 매출처 alias별 순매출/미수금 (매칭수금 차감 없음 = 대사 화면 기준)
CREATE OR REPLACE FUNCTION erp_reconcile_sales_by_alias(p_from DATE, p_to DATE)
RETURNS TABLE (alias_id UUID, amount BIGINT, outstanding BIGINT)
LANGUAGE sql STABLE
AS $$
  WITH ord AS (
    SELECT o.id, o.customer_alias_id, o.total_amount, o.outstanding_amount, o.collect_status,
      COALESCE((SELECT SUM(it.line_total) FROM erp_order_items it
                WHERE it.order_id = o.id AND (it.is_canceled OR it.is_vip OR it.is_prepayment)), 0) AS excluded
    FROM erp_orders o
    WHERE o.customer_alias_id IS NOT NULL
      AND (p_from IS NULL OR o.order_date >= p_from)
      AND (p_to   IS NULL OR o.order_date <= p_to)
  )
  SELECT
    customer_alias_id AS alias_id,
    COALESCE(SUM(COALESCE(total_amount,0) - excluded), 0)::BIGINT AS amount,
    COALESCE(SUM(CASE WHEN collect_status <> 'collected' THEN COALESCE(outstanding_amount,0) ELSE 0 END), 0)::BIGINT AS outstanding
  FROM ord
  GROUP BY customer_alias_id
$$;

-- ④-b 거래처 대사(매입): 매입처 alias별 매입 합계 (취소/VIP/선결제 제외, order_date 기준)
CREATE OR REPLACE FUNCTION erp_reconcile_purchase_by_alias(p_from DATE, p_to DATE)
RETURNS TABLE (alias_id UUID, amount BIGINT)
LANGUAGE sql STABLE
AS $$
  SELECT i.purchase_alias_id AS alias_id,
         COALESCE(SUM(i.purchase_total), 0)::BIGINT AS amount
  FROM erp_order_items i
  JOIN erp_orders o ON o.id = i.order_id
  WHERE i.is_canceled = false AND i.is_vip = false AND i.is_prepayment = false
    AND i.purchase_alias_id IS NOT NULL
    AND (p_from IS NULL OR o.order_date >= p_from)
    AND (p_to   IS NULL OR o.order_date <= p_to)
  GROUP BY i.purchase_alias_id
$$;
