-- =====================================================
-- prepay_direct_backfill_run.sql — 선결제 원장 소급 등록 실행 + 검증
-- 2026-11-05 드라이런 회신 확인(7건 · 11,112,300원 · 별칭 누락 0 · 기존 원장 0) 후 실행
-- 한 번에 전체 실행. 다시 실행해도 중복 등록 없음(ON CONFLICT DO NOTHING).
-- 기대(실행 시점에 새 선결제 주문이 없다면): 대상품목수 7 = 등록된건수 7 / 대상금액 11112300 = 등록금액 / 누락_기대0 = 0
-- =====================================================

-- ── [2] 실행: 소급 등록 ([1] 확인 후 실행) ──────────────
INSERT INTO erp_prepayments (direction, entry_type, alias_id, entry_date, amount, order_id, source_key, memo)
SELECT 'customer', 'deposit', t.customer_alias_id, t.order_date, t.line_total, t.order_id,
       'pre:direct:' || t.order_id || ':' || t.n,
       '주문 ' || COALESCE(t.order_no, '') || ' 자동 등록 (품명: 선결제) — 소급 2026-11-05'
FROM (
  SELECT o.id AS order_id, o.order_no, o.order_date, o.customer_alias_id, i.line_total,
         ROW_NUMBER() OVER (PARTITION BY o.id ORDER BY i.line_no) AS n
  FROM erp_orders o
  JOIN erp_order_items i ON i.order_id = o.id
  WHERE o.source = 'direct' AND o.canceled_at IS NULL
    AND i.is_prepayment AND NOT i.is_canceled AND COALESCE(i.line_total, 0) > 0
) t
WHERE t.customer_alias_id IS NOT NULL
ON CONFLICT (source_key) DO NOTHING;


-- ── [3] 검증 ([2] 실행 후) ──────────────────────────────
-- 기대: 대상품목수 = 등록된건수, 금액도 같음, 누락_기대0 = 0
SELECT
  (SELECT COUNT(*) FROM erp_orders o JOIN erp_order_items i ON i.order_id = o.id
    WHERE o.source = 'direct' AND o.canceled_at IS NULL AND o.customer_alias_id IS NOT NULL
      AND i.is_prepayment AND NOT i.is_canceled AND COALESCE(i.line_total, 0) > 0) AS 대상품목수,
  (SELECT COUNT(*) FROM erp_prepayments WHERE source_key LIKE 'pre:direct:%') AS 등록된건수,
  (SELECT COALESCE(SUM(i.line_total), 0) FROM erp_orders o JOIN erp_order_items i ON i.order_id = o.id
    WHERE o.source = 'direct' AND o.canceled_at IS NULL AND o.customer_alias_id IS NOT NULL
      AND i.is_prepayment AND NOT i.is_canceled AND COALESCE(i.line_total, 0) > 0) AS 대상금액,
  (SELECT COALESCE(SUM(amount), 0) FROM erp_prepayments WHERE source_key LIKE 'pre:direct:%') AS 등록금액,
  (SELECT COUNT(*) FROM erp_orders o JOIN erp_order_items i ON i.order_id = o.id
    WHERE o.source = 'direct' AND o.canceled_at IS NULL AND o.customer_alias_id IS NOT NULL
      AND i.is_prepayment AND NOT i.is_canceled AND COALESCE(i.line_total, 0) > 0
      AND NOT EXISTS (SELECT 1 FROM erp_prepayments p WHERE p.order_id = o.id AND p.source_key LIKE 'pre:direct:%')) AS 누락_기대0;
