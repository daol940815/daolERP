-- =====================================================
-- prepay_negative_backfill.sql  (결제처리 트랙 — 2026-11-19 사용자 승인 A안)
-- 마이너스 선결제 품목(= 선결제 사용)을 선결제 원장 '차감'으로 소급 등록한다. 코드는 이제 주문 저장 때 자동으로 등록한다.
-- [1] 드라이런만 먼저 실행해 결과를 알려 주세요. [2] 실행은 결과 확인 뒤(아래 주석을 풀고 실행). 재실행 안전(source_key 멱등).
-- 키: pre:direct:<주문id>:u<n> — 코드(lib/orders-portal.ts syncPrepayDeposits)와 같은 규칙, n = 주문 안 마이너스 선결제 품목의 line_no 순서
-- =====================================================

-- [1] 드라이런 — 등록될 차감 · 차감 후 매출처 잔액
WITH neg AS (
  SELECT o.id AS order_id, o.order_no, o.order_date, o.customer_alias_id, o.bank_name, o.branch_name,
         -i.line_total AS amount,
         'pre:direct:' || o.id || ':u' || ROW_NUMBER() OVER (PARTITION BY o.id ORDER BY i.line_no) AS source_key
  FROM erp_order_items i JOIN erp_orders o ON o.id = i.order_id
  WHERE i.is_prepayment AND NOT i.is_canceled AND i.line_total < 0 AND o.canceled_at IS NULL AND COALESCE(o.source, 'upload') = 'direct'
), bal AS (
  SELECT a.vendor_id,
         SUM(CASE WHEN p.entry_type = 'deposit' THEN p.amount ELSE -p.amount END) AS balance_now
  FROM erp_prepayments p JOIN erp_vendor_aliases a ON a.id = p.alias_id
  WHERE p.direction = 'customer' GROUP BY a.vendor_id
)
SELECT n.order_no, n.order_date, n.bank_name, n.branch_name, n.amount AS 차감할_금액,
       (n.customer_alias_id IS NULL) AS 별칭없음_등록불가,
       EXISTS (SELECT 1 FROM erp_prepayments p WHERE p.source_key = n.source_key) AS 이미_등록됨,
       b.balance_now AS 지금_잔액, b.balance_now - n.amount AS 차감후_잔액
FROM neg n
LEFT JOIN erp_vendor_aliases a ON a.id = n.customer_alias_id
LEFT JOIN bal b ON b.vendor_id = a.vendor_id
ORDER BY n.order_date;

-- [2] 실행 — 드라이런 확인 뒤 아래 주석을 풀고 실행
-- INSERT INTO erp_prepayments (direction, alias_id, entry_date, entry_type, amount, order_id, source_key, memo)
-- SELECT 'customer', o.customer_alias_id, o.order_date, 'deduction', -i.line_total, o.id,
--        'pre:direct:' || o.id || ':u' || ROW_NUMBER() OVER (PARTITION BY o.id ORDER BY i.line_no),
--        '주문 ' || COALESCE(o.order_no, '') || ' 자동 차감 (마이너스 선결제 품목, 소급)'
-- FROM erp_order_items i JOIN erp_orders o ON o.id = i.order_id
-- WHERE i.is_prepayment AND NOT i.is_canceled AND i.line_total < 0 AND o.canceled_at IS NULL
--   AND COALESCE(o.source, 'upload') = 'direct' AND o.customer_alias_id IS NOT NULL
-- ON CONFLICT (source_key) DO NOTHING;

-- [3] 검증 — 실행 뒤: 마이너스 품목 합 = 자동 차감 합 (기대: 두 값이 같음)
-- SELECT (SELECT COALESCE(SUM(-i.line_total), 0) FROM erp_order_items i JOIN erp_orders o ON o.id = i.order_id
--          WHERE i.is_prepayment AND NOT i.is_canceled AND i.line_total < 0 AND o.canceled_at IS NULL AND COALESCE(o.source, 'upload') = 'direct') AS 마이너스_품목_합,
--        (SELECT COALESCE(SUM(amount), 0) FROM erp_prepayments WHERE source_key LIKE 'pre:direct:%:u%') AS 자동_차감_합;
