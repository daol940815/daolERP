-- =====================================================
-- order_vip_flag_backfill.sql  (데이터 작업 — 2026-11-09 사용자 승인 "제안대로 진행")
-- 직접 입력 주문에서 품명 'VIP' 품목의 VIP 표시(erp_order_items.is_vip)가 빠져 있던 문제 보정.
--  - 규칙: 품명 'VIP' = 매출 · 미수 · 손익 집계 제외 (2026-08 결정, 업로드 import와 같은 규칙)
--  - 원인: 직접 입력 저장 코드가 is_vip를 항상 false로 저장 (2026-11-09 코드 수정 — 이후 입력분은 자동)
--  - 대상: source='direct' 주문의 품목 중 TRIM(item_name)='VIP' AND is_vip = false
--  - 효과: 해당 주문의 순매출 · 미수(v_erp_order_receivable)가 VIP 금액만큼 줄어든다. 주문 총금액(total_amount)은 그대로
-- 실행 순서: [1] 드라이런 결과 회신 → [2] 실행 → [3] 검증
-- =====================================================

-- ── [1] 드라이런 (쓰기 없음) ─────────────────────────────
-- [1-1] 요약
SELECT
  COUNT(*)                                   AS 보정될_품목,
  COUNT(DISTINCT i.order_id)                 AS 해당_주문,
  COALESCE(SUM(i.line_total), 0)             AS VIP_금액_합계_매출에서_빠짐,
  COUNT(*) FILTER (WHERE o.canceled_at IS NOT NULL) AS 그중_취소주문_품목,
  COUNT(*) FILTER (WHERE i.is_canceled)      AS 그중_취소품목
FROM erp_order_items i
JOIN erp_orders o ON o.id = i.order_id
WHERE o.source = 'direct' AND TRIM(i.item_name) = 'VIP' AND i.is_vip IS NOT TRUE;

-- [1-2] 주문별 목록 — 순매출 · 미수가 이렇게 바뀐다
SELECT o.order_no AS 주문번호, o.order_date AS 주문일, CONCAT_WS(' ', o.bank_name, o.branch_name) AS 주문처,
       COUNT(*) AS VIP_품목, SUM(i.line_total) AS VIP_금액,
       r.net_sales AS 지금_순매출, r.net_sales - SUM(CASE WHEN i.is_canceled THEN 0 ELSE i.line_total END) AS 보정후_순매출_예상,
       r.outstanding AS 지금_미수,
       CASE WHEN o.canceled_at IS NOT NULL THEN '취소 주문' ELSE '' END AS 비고
FROM erp_order_items i
JOIN erp_orders o ON o.id = i.order_id
LEFT JOIN v_erp_order_receivable r ON r.order_id = o.id
WHERE o.source = 'direct' AND TRIM(i.item_name) = 'VIP' AND i.is_vip IS NOT TRUE
GROUP BY o.id, o.order_no, o.order_date, o.bank_name, o.branch_name, o.canceled_at, r.net_sales, r.outstanding
ORDER BY o.order_date, o.order_no;


-- ── [2] 실행 ([1] 확인 후, 주석 해제해 실행) ─────────────
-- UPDATE erp_order_items i
-- SET is_vip = true
-- FROM erp_orders o
-- WHERE o.id = i.order_id
--   AND o.source = 'direct' AND TRIM(i.item_name) = 'VIP' AND i.is_vip IS NOT TRUE;


-- ── [3] 검증 ([2] 실행 후) ──────────────────────────────
-- 기대: 남은_미보정_기대0 = 0 / VIP_표시_직접입력 = [1-1] 보정될_품목 (이전에 이미 표시된 것이 없다면)
-- SELECT
--   (SELECT COUNT(*) FROM erp_order_items i JOIN erp_orders o ON o.id = i.order_id
--     WHERE o.source = 'direct' AND TRIM(i.item_name) = 'VIP' AND i.is_vip IS NOT TRUE) AS 남은_미보정_기대0,
--   (SELECT COUNT(*) FROM erp_order_items i JOIN erp_orders o ON o.id = i.order_id
--     WHERE o.source = 'direct' AND i.is_vip) AS VIP_표시_직접입력,
--   (SELECT COUNT(*) FROM erp_order_items i JOIN erp_orders o ON o.id = i.order_id
--     WHERE o.source = 'direct' AND i.is_vip AND TRIM(i.item_name) <> 'VIP') AS 품명다른데_VIP_기대0;
