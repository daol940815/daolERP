-- =====================================================
-- card_void_paid_check.sql  (읽기 전용 — 2026-11-24)
-- 정산상태 '중복해제'인 카드 매출 전부 + 처리현황 · 입금예정일, 그리고 같은 카드 · 같은 금액의 짝 승인(±3일)
-- 목적: "중복해제여도 처리현황이 입금완료면 정산된 건"으로 규칙을 바꿀 때 어떤 건이 되살아나는지 미리 본다.
-- =====================================================
SELECT c.tx_date, c.approval_number, c.card_number, c.amount, c.settlement_status AS 정산상태,
       c.processing_status AS 처리현황, c.deposit_expected_date AS 입금예정일,
       v.name AS 매출처,
       (SELECT string_agg(p.approval_number || ' ' || COALESCE(p.settlement_status, '-') || '/' || COALESCE(p.processing_status, '-'), ', ')
          FROM card_sales p
         WHERE p.id <> c.id AND p.transaction_type = 'approval' AND p.card_number = c.card_number AND p.amount = c.amount
           AND p.tx_date BETWEEN c.tx_date - 3 AND c.tx_date + 3) AS 짝_승인_정산상태_처리현황,
       (SELECT COALESCE(SUM(m.amount), 0) FROM erp_payment_matches m WHERE m.source_type = 'card' AND m.source_id = c.id) AS 주문에_붙은_금액
FROM card_sales c LEFT JOIN vendors v ON v.id = c.vendor_id
WHERE c.transaction_type = 'approval' AND TRIM(c.settlement_status) = '중복해제'
ORDER BY c.tx_date DESC;
