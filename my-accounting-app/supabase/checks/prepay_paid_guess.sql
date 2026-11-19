-- =====================================================
-- prepay_paid_guess.sql  (결제처리 트랙 — 읽기 전용, DB를 바꾸지 않음)
-- 선결제 품목이 있는 주문(취소 제외)마다, 이미 들어온 것 같은 입금 · 카드 결제 후보를 찾는다.
--   같은 거래처 · 금액이 청구 금액 또는 선결제 금액과 같음 · 주문일 −14일 ~ +60일 · 아직 어느 주문에도 안 붙은 것
-- 후보가 있으면 "이미 받은 돈"일 가능성이 높다 — 1308 실행 후 입금대장에서 붙이면 된다.
-- =====================================================
WITH it AS (
  SELECT i.order_id,
         SUM(CASE WHEN i.is_canceled OR i.is_vip OR i.is_prepayment THEN 0 ELSE COALESCE(i.line_total, 0) END) AS net_amount,
         SUM(CASE WHEN i.is_prepayment AND NOT i.is_canceled AND NOT i.is_vip THEN COALESCE(i.line_total, 0) ELSE 0 END) AS prepay_amount
  FROM erp_order_items i GROUP BY i.order_id
), o AS (
  SELECT v.order_id, v.order_no, v.order_date, v.vendor_id, v.bank_name, v.branch_name,
         it.prepay_amount, it.net_amount + it.prepay_amount AS billable
  FROM v_erp_order_receivable v JOIN it ON it.order_id = v.order_id
  JOIN erp_orders eo ON eo.id = v.order_id AND eo.canceled_at IS NULL
  WHERE it.prepay_amount > 0
), used AS (
  SELECT source_type, source_id FROM erp_payment_matches GROUP BY source_type, source_id
)
SELECT o.order_no, o.order_date, o.bank_name, o.branch_name, o.billable AS 청구금액, o.prepay_amount AS 선결제,
       '통장' AS 원본, t.tx_date AS 날짜, t.amount_in AS 금액, t.counterparty_name AS 입금자,
       CASE WHEN t.amount_in = o.billable THEN '청구 금액과 같음' ELSE '선결제 금액과 같음' END AS 맞는것
FROM o
JOIN transactions t ON t.vendor_id = o.vendor_id AND t.amount_in IN (o.billable, o.prepay_amount)
 AND t.tx_date BETWEEN o.order_date - 14 AND o.order_date + 60
WHERE NOT EXISTS (SELECT 1 FROM used u WHERE u.source_type = 'bank' AND u.source_id = t.id)
UNION ALL
SELECT o.order_no, o.order_date, o.bank_name, o.branch_name, o.billable, o.prepay_amount,
       '카드', c.tx_date, c.amount, c.card_number,
       CASE WHEN c.amount = o.billable THEN '청구 금액과 같음' ELSE '선결제 금액과 같음' END
FROM o
JOIN card_sales c ON c.vendor_id = o.vendor_id AND c.transaction_type = 'approval' AND c.amount IN (o.billable, o.prepay_amount)
 AND c.tx_date BETWEEN o.order_date - 14 AND o.order_date + 60
WHERE NOT EXISTS (SELECT 1 FROM used u WHERE u.source_type = 'card' AND u.source_id = c.id)
ORDER BY 1, 8;
