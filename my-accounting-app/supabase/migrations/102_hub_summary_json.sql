-- =====================================================
-- 102_hub_summary_json.sql
-- 허브 집계 후속 최적화
--
-- 1) hub_vendor_summary_json: 101 함수를 JSONB 한 덩어리로 감싼 버전.
--    행 반환 RPC는 PostgREST max-rows 때문에 페이지로 나눠 읽는데,
--    페이지마다 함수가 재실행되어 집계가 2배로 돈다(1,176곳 = 2페이지).
--    JSONB는 단일 응답이라 1회 실행으로 끝나고 절단도 없다.
-- 2) 집계가 훑는 두 경로에 인덱스 보강.
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_erp_order_items_flagged
  ON erp_order_items(order_id)
  WHERE is_canceled OR is_vip OR is_prepayment;

CREATE INDEX IF NOT EXISTS idx_erp_orders_customer_alias2
  ON erp_orders(customer_alias_id)
  WHERE customer_alias_id IS NOT NULL;

CREATE OR REPLACE FUNCTION hub_vendor_summary_json(p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
  FROM hub_vendor_summary(p_from, p_to) x
$$;
