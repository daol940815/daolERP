-- 결제 확인 화면 '불일치' 원인 확인 (2026-11-16, 하나은행 철산동지점 11-09 주문 848,200)
-- 가설: 결제 기록(1차)과 별도로 카드 내역 › 매출 탭(또는 입금 매칭)에서 같은 카드 매출을 이 주문에 이미 매칭해서
--       카드 매출의 미배분 잔액이 0 → 결제 확인 화면이 "이미 다른 주문에 배분됨"으로 보고 불일치 판정.

-- ① 주문 · 결제 기록 · 기록의 주문별 금액
WITH o AS (
  SELECT id, order_no, order_date, total_amount, outstanding_amount, collect_status
  FROM erp_orders WHERE branch_name ILIKE '%철산동%' AND order_date = DATE '2026-11-09' AND canceled_at IS NULL
)
SELECT o.order_no, o.order_date, o.total_amount, o.outstanding_amount AS 주문_미수열, o.collect_status,
       r.id AS record_id, r.method, r.pay_date, r.amount AS 기록_금액, r.approval_number, r.card_last4, r.confirmed_at,
       ro.amount AS 기록_주문별_금액
FROM o
LEFT JOIN order_payment_record_orders ro ON ro.order_id = o.id
LEFT JOIN order_payment_records r ON r.id = ro.record_id
ORDER BY o.order_no;

-- ② 이 주문에 붙은 수금 매칭 (record_id 가 NULL 이면 결제 확인 화면이 아닌 다른 화면에서 붙인 매칭)
SELECT m.source_type, m.source_id, m.amount, m.paid_date, m.matched_by, m.record_id, m.memo, m.created_at
FROM erp_payment_matches m
JOIN erp_orders o ON o.id = m.order_id
WHERE o.branch_name ILIKE '%철산동%' AND o.order_date = DATE '2026-11-09'
ORDER BY m.created_at;

-- ③ 기록의 승인번호로 찾은 카드 매출과 그 매출의 배분 현황 (어느 주문에 얼마 배분됐는지)
SELECT c.tx_date, c.transaction_type, c.amount, c.approval_number, c.acquirer, c.vendor_id,
       m.order_id, o.order_no AS 배분된_주문, o.branch_name, m.amount AS 배분_금액, m.record_id
FROM card_sales c
LEFT JOIN erp_payment_matches m ON m.source_type = 'card' AND m.source_id = c.id
LEFT JOIN erp_orders o ON o.id = m.order_id
WHERE c.approval_number IN (
  SELECT r.approval_number FROM order_payment_records r
  JOIN order_payment_record_orders ro ON ro.record_id = r.id
  JOIN erp_orders o ON o.id = ro.order_id
  WHERE o.branch_name ILIKE '%철산동%' AND o.order_date = DATE '2026-11-09' AND r.approval_number IS NOT NULL)
ORDER BY c.tx_date, c.transaction_type;

-- ④ 미수 뷰 (결제 확인 화면 · 주문내역이 쓰는 값)
SELECT v.order_no, v.net_sales, v.matched_all, v.outstanding, v.collect_status
FROM v_erp_order_receivable v JOIN erp_orders o ON o.id = v.order_id
WHERE o.branch_name ILIKE '%철산동%' AND o.order_date = DATE '2026-11-09';
