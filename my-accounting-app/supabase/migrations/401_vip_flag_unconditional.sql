-- =====================================================
-- 401_vip_flag_unconditional.sql  (회계 트랙)
-- VIP 판정 변경: 품명 'VIP'는 판매가=매입가 여부와 무관하게 무조건
-- 매출 집계 제외 (2026-08-06 사용자 결정).
-- 업로드 파서(app/api/erp-orders/import)도 동일하게 변경됨 — 이 마이그레이션은
-- 기존 데이터 중 품명='VIP'인데 is_vip=false로 남은 건을 보정한다.
-- 영향 범위: is_vip 기준 집계 전체가 실시간 함수라 즉시 반영됨 —
--   월별 손익 매출/원가(025), 주문 요약(020/022/026), 매출처 분석(035/036),
--   허브 VIP 누적(101), ERP 특수거래 화면.
-- =====================================================

-- ── STEP 1. 드라이런 (읽기 전용) ─────────────────────────
-- 보정 대상 규모 확인
SELECT count(*)                 AS target_rows,
       count(DISTINCT order_id) AS target_orders,
       sum(line_total)          AS sum_line_total,
       sum(purchase_total)      AS sum_purchase_total
FROM erp_order_items
WHERE item_name = 'VIP' AND NOT is_vip;

-- 월별 손익 영향(해당 월 매출·원가에서 빠지는 금액) 미리보기
SELECT to_char(o.order_date, 'YYYY-MM') AS month,
       count(*)              AS cnt,
       sum(i.line_total)     AS revenue_decrease,
       sum(i.purchase_total) AS cogs_decrease
FROM erp_order_items i
JOIN erp_orders o ON o.id = i.order_id
WHERE i.item_name = 'VIP' AND NOT i.is_vip
GROUP BY 1
ORDER BY 1;

-- ── STEP 2. 보정 실행 (STEP 1 확인 후) ───────────────────
UPDATE erp_order_items
SET is_vip = true
WHERE item_name = 'VIP' AND NOT is_vip;

COMMENT ON COLUMN erp_order_items.is_vip IS
  '품명이 VIP인 품목 — 매출 집계 제외, 별도 관리 (2026-08 판매가=매입가 조건 제거, 무조건 제외)';

-- ── STEP 3. 검증 (실행 후) ──────────────────────────────
-- 기대: remaining = 0 (품명 VIP인데 미플래그 건 없음)
SELECT count(*) AS remaining
FROM erp_order_items
WHERE item_name = 'VIP' AND NOT is_vip;
