-- =====================================================
-- prepay_ibk_jungki_check.sql  (읽기 전용 — DB를 바꾸지 않음, 2026-11-23)
-- IBK기업은행 중기산업연구실 선결제 이관 전 확인: 거래처 · 별칭 · 지금 원장 · 2026-10-01 이후 주문 · 카드 선결제
-- SQL 편집기는 마지막 결과만 보여 주므로, 결과를 한 표로 모았다(구분 칸으로 나뉨).
-- =====================================================
WITH v AS (
  SELECT id, name, type FROM vendors
  WHERE name ILIKE '%중기산업%' OR (name ILIKE '%기업은행%' AND name ILIKE '%연구%')
), a AS (
  SELECT al.id, al.erp_name, al.vendor_id, al.alias_type FROM erp_vendor_aliases al JOIN v ON v.id = al.vendor_id
)
SELECT '1 거래처' AS 구분, v.name AS 이름, v.type AS 값1, v.id::text AS 값2, NULL::text AS 값3, NULL::text AS 값4 FROM v
UNION ALL
SELECT '2 별칭', a.erp_name, a.alias_type, a.id::text, NULL, NULL FROM a
UNION ALL
SELECT '3 지금 원장', p.entry_date::text, p.entry_type, p.amount::text, p.source_key, p.memo
FROM erp_prepayments p JOIN a ON a.id = p.alias_id WHERE p.direction = 'customer'
UNION ALL
SELECT '4 10월 이후 주문', o.order_no, o.order_date::text, COALESCE(o.total_amount, 0)::text,
       CASE WHEN o.canceled_at IS NOT NULL THEN '취소' ELSE '' END,
       (SELECT string_agg(i.item_name || ' ' || i.line_total || CASE WHEN i.is_prepayment THEN '(선결제)' ELSE '' END, ', ')
          FROM erp_order_items i WHERE i.order_id = o.id AND NOT i.is_canceled)
FROM erp_orders o JOIN a ON a.id = o.customer_alias_id WHERE o.order_date >= '2026-10-01'
UNION ALL
SELECT '5 카드 매출(9~10월, 금액 648,000 · 420,000)', c.tx_date::text, c.transaction_type, c.amount::text, c.approval_number, c.card_number
FROM card_sales c WHERE c.amount IN (648000, 420000) AND c.tx_date BETWEEN '2026-09-01' AND '2026-10-31'
ORDER BY 1, 2;
