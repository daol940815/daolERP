-- =====================================================
-- prepay_direct_backfill.sql  (주문시스템 트랙 — 데이터 보정, 마이그레이션 아님)
-- 2026-11-05 사용자 승인 ("1~5번 진행")
--
-- 자체 입력(direct) 주문의 '선결제' 품목이 선결제 원장(erp_prepayments)에 입금으로
-- 기록되지 않던 누락을 소급 등록한다. (예: 하나은행 여의도금융센터)
-- 규칙은 코드 lib/orders-portal.ts syncPrepayDeposits와 동일:
--   대상 = 취소되지 않은 direct 주문의 유효 선결제 품목(취소 아님 · 금액 > 0)
--   source_key = 'pre:direct:<주문id>:<n>' (n = 선결제 품목 line_no 순번) — 다시 실행해도 중복 없음
--
-- 실행 순서: [1]만 먼저 실행해 결과를 회신 → 확인 후 [2] → [3]
-- =====================================================

-- ── [1] 드라이런: 등록 대상 (쓰기 없음) ─────────────────
-- 기존_원장건수 > 0 인 주문은 누가 수동으로 이미 입금을 넣었을 수 있음 → 회신 시 함께 확인
WITH t AS (
  SELECT o.id AS order_id, o.order_no, o.order_date, o.bank_name, o.branch_name, o.customer_alias_id,
         i.line_no, i.line_total,
         ROW_NUMBER() OVER (PARTITION BY o.id ORDER BY i.line_no) AS n
  FROM erp_orders o
  JOIN erp_order_items i ON i.order_id = o.id
  WHERE o.source = 'direct' AND o.canceled_at IS NULL
    AND i.is_prepayment AND NOT i.is_canceled AND COALESCE(i.line_total, 0) > 0
)
SELECT t.order_no AS 주문번호, t.order_date AS 주문일,
       CONCAT_WS(' ', t.bank_name, t.branch_name) AS 주문처,
       t.line_total AS 선결제금액,
       'pre:direct:' || t.order_id || ':' || t.n AS 등록키,
       (t.customer_alias_id IS NULL) AS 별칭없음_등록불가,
       (SELECT COUNT(*) FROM erp_prepayments p WHERE p.order_id = t.order_id) AS 기존_원장건수,
       EXISTS (SELECT 1 FROM erp_prepayments p WHERE p.source_key = 'pre:direct:' || t.order_id || ':' || t.n) AS 이미등록됨
FROM t
ORDER BY t.order_date, t.order_no, t.n;


-- ── [2] 실행: 소급 등록 ([1] 확인 후 실행) ──────────────
-- INSERT INTO erp_prepayments (direction, entry_type, alias_id, entry_date, amount, order_id, source_key, memo)
-- SELECT 'customer', 'deposit', t.customer_alias_id, t.order_date, t.line_total, t.order_id,
--        'pre:direct:' || t.order_id || ':' || t.n,
--        '주문 ' || COALESCE(t.order_no, '') || ' 자동 등록 (품명: 선결제) — 소급 2026-11-05'
-- FROM (
--   SELECT o.id AS order_id, o.order_no, o.order_date, o.customer_alias_id, i.line_total,
--          ROW_NUMBER() OVER (PARTITION BY o.id ORDER BY i.line_no) AS n
--   FROM erp_orders o
--   JOIN erp_order_items i ON i.order_id = o.id
--   WHERE o.source = 'direct' AND o.canceled_at IS NULL
--     AND i.is_prepayment AND NOT i.is_canceled AND COALESCE(i.line_total, 0) > 0
-- ) t
-- WHERE t.customer_alias_id IS NOT NULL
-- ON CONFLICT (source_key) DO NOTHING;


-- ── [3] 검증 ([2] 실행 후) ──────────────────────────────
-- 기대: 대상품목수 = 등록된건수, 금액도 같음, 누락_기대0 = 0
-- SELECT
--   (SELECT COUNT(*) FROM erp_orders o JOIN erp_order_items i ON i.order_id = o.id
--     WHERE o.source = 'direct' AND o.canceled_at IS NULL AND o.customer_alias_id IS NOT NULL
--       AND i.is_prepayment AND NOT i.is_canceled AND COALESCE(i.line_total, 0) > 0) AS 대상품목수,
--   (SELECT COUNT(*) FROM erp_prepayments WHERE source_key LIKE 'pre:direct:%') AS 등록된건수,
--   (SELECT COALESCE(SUM(i.line_total), 0) FROM erp_orders o JOIN erp_order_items i ON i.order_id = o.id
--     WHERE o.source = 'direct' AND o.canceled_at IS NULL AND o.customer_alias_id IS NOT NULL
--       AND i.is_prepayment AND NOT i.is_canceled AND COALESCE(i.line_total, 0) > 0) AS 대상금액,
--   (SELECT COALESCE(SUM(amount), 0) FROM erp_prepayments WHERE source_key LIKE 'pre:direct:%') AS 등록금액,
--   (SELECT COUNT(*) FROM erp_orders o JOIN erp_order_items i ON i.order_id = o.id
--     WHERE o.source = 'direct' AND o.canceled_at IS NULL AND o.customer_alias_id IS NOT NULL
--       AND i.is_prepayment AND NOT i.is_canceled AND COALESCE(i.line_total, 0) > 0
--       AND NOT EXISTS (SELECT 1 FROM erp_prepayments p WHERE p.order_id = o.id AND p.source_key LIKE 'pre:direct:%')) AS 누락_기대0;
