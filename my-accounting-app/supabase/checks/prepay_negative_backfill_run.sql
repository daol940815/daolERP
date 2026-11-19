-- =====================================================
-- prepay_negative_backfill_run.sql  (결제처리 트랙 — 실행 파일, 2026-11-19)
-- 드라이런 결과(사용자 회신): D261105-013 하나은행 서린지점 380,000 1건 · 지금 잔액 820,100 → 차감 후 440,100.
-- 아래 [2] 실행 → [3] 검증 결과를 알려 주세요. 재실행 안전(ON CONFLICT DO NOTHING).
-- =====================================================

-- [2] 실행 — 드라이런 확인 뒤 아래 주석을 풀고 실행
INSERT INTO erp_prepayments (direction, alias_id, entry_date, entry_type, amount, order_id, source_key, memo)
SELECT 'customer', o.customer_alias_id, o.order_date, 'deduction', -i.line_total, o.id,
       'pre:direct:' || o.id || ':u' || ROW_NUMBER() OVER (PARTITION BY o.id ORDER BY i.line_no),
       '주문 ' || COALESCE(o.order_no, '') || ' 자동 차감 (마이너스 선결제 품목, 소급)'
FROM erp_order_items i JOIN erp_orders o ON o.id = i.order_id
WHERE i.is_prepayment AND NOT i.is_canceled AND i.line_total < 0 AND o.canceled_at IS NULL
  AND COALESCE(o.source, 'upload') = 'direct' AND o.customer_alias_id IS NOT NULL
ON CONFLICT (source_key) DO NOTHING;

-- [3] 검증 — 실행 뒤: 마이너스 품목 합 = 자동 차감 합 (기대: 두 값이 같음)
SELECT (SELECT COALESCE(SUM(-i.line_total), 0) FROM erp_order_items i JOIN erp_orders o ON o.id = i.order_id
         WHERE i.is_prepayment AND NOT i.is_canceled AND i.line_total < 0 AND o.canceled_at IS NULL AND COALESCE(o.source, 'upload') = 'direct') AS 마이너스_품목_합,
       (SELECT COALESCE(SUM(amount), 0) FROM erp_prepayments WHERE source_key LIKE 'pre:direct:%:u%') AS 자동_차감_합;
