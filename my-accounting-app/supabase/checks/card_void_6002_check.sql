-- =====================================================
-- card_void_6002_check.sql  (읽기 전용 — 2026-11-24)
-- 11-17 카드 뒤 6002 · 100,000 '중복해제' 건 확인: 같은 카드 · 같은 금액의 다른 승인(짝)이 있는지, 각각의 정산상태 · 매출처 · 주문 매칭
-- =====================================================
SELECT c.tx_date, c.tx_time, c.transaction_type, c.amount, c.approval_number, c.card_number, c.acquirer,
       c.settlement_status AS 정산상태, v.name AS 매출처,
       (SELECT COALESCE(SUM(m.amount), 0) FROM erp_payment_matches m WHERE m.source_type = 'card' AND m.source_id = c.id) AS 주문에_붙은_금액,
       (SELECT string_agg(o.order_no, ', ') FROM erp_payment_matches m JOIN erp_orders o ON o.id = m.order_id
         WHERE m.source_type = 'card' AND m.source_id = c.id) AS 붙은_주문,
       c.updated_at AS 마지막_업로드
FROM card_sales c LEFT JOIN vendors v ON v.id = c.vendor_id
WHERE c.card_number LIKE '%6002' AND ABS(c.amount) = 100000 AND c.tx_date BETWEEN '2026-11-10' AND '2026-11-24'
ORDER BY c.tx_date, c.tx_time, c.approval_number;
