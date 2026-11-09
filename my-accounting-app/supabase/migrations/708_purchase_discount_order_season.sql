-- =====================================================
-- 708_purchase_discount_order_season.sql
-- 상담 품목 · 주문 품목에 매입할인 · 주문시기 추가 (사용자 확정 2026-11-09)
--
-- 1) 매입할인 — 판매할인(704)과 같은 구조
--    - purchase_discount_mode '정액': 행당 금액 직접 입력 (예: 1,060,000원에서 60,000원 할인)
--    - purchase_discount_mode '단가': 개당 purchase_discount_unit원 × 수량 (예: 단가 1,000원을 개당 100원 할인 → 900원)
--    - purchase_discount = 최종 매입할인액 (서버가 저장 시 재계산)
--    매입합계(purchase_total) = 매입가 × 수량 + 매입배송비 − 매입할인
--    → 발주서 금액 · 미지급금 · 매입 집계는 purchase_total을 쓰므로 그대로 반영된다.
--    발주서(507)는 발주 시점에 스냅샷: 개당 할인은 할인 후 단가, 정액 할인은 비고에 할인액 표기 (컬럼 추가 없음).
-- 2) 주문시기 — order_season 글자 (상시 · 26설 · 26추석 · 27설 · 27추석 …). 화면에서 '26 추석' · '2026추석'은 '26추석'으로 맞춘다.
--
-- 기존 데이터: 매입할인 0 · 주문시기 비어 있음 (데이터 이관 없음). 재실행 안전 (IF NOT EXISTS).
-- =====================================================

ALTER TABLE erp_consultation_items
  ADD COLUMN IF NOT EXISTS purchase_discount BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS purchase_discount_mode TEXT NOT NULL DEFAULT '정액'
    CHECK (purchase_discount_mode IN ('정액', '단가')),
  ADD COLUMN IF NOT EXISTS purchase_discount_unit BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS order_season TEXT;

ALTER TABLE erp_order_items
  ADD COLUMN IF NOT EXISTS purchase_discount BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS purchase_discount_mode TEXT NOT NULL DEFAULT '정액'
    CHECK (purchase_discount_mode IN ('정액', '단가')),
  ADD COLUMN IF NOT EXISTS purchase_discount_unit BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS order_season TEXT;

COMMENT ON COLUMN erp_consultation_items.purchase_discount IS '매입할인 최종 금액(원). 매입합계 = 매입가×수량 + 매입배송비 − 매입할인 (708)';
COMMENT ON COLUMN erp_consultation_items.purchase_discount_mode IS '매입할인 종류 — 정액(행당 금액) / 단가(개당 purchase_discount_unit원 × 수량) (708)';
COMMENT ON COLUMN erp_consultation_items.purchase_discount_unit IS '개당 매입할인액(원). 정액이면 0 (708)';
COMMENT ON COLUMN erp_consultation_items.order_season IS '주문시기 — 상시 · 26설 · 26추석 등 (708)';
COMMENT ON COLUMN erp_order_items.purchase_discount IS '매입할인 최종 금액(원). purchase_total에 반영됨 (708, 상담 품목과 같은 구조)';
COMMENT ON COLUMN erp_order_items.purchase_discount_mode IS '매입할인 종류 — 정액/단가 (708)';
COMMENT ON COLUMN erp_order_items.purchase_discount_unit IS '개당 매입할인액(원). 정액이면 0 (708)';
COMMENT ON COLUMN erp_order_items.order_season IS '주문시기 — 상시 · 26설 · 26추석 등 (708)';

-- 검증 (실행 후):
-- SELECT table_name, column_name, data_type, column_default
--   FROM information_schema.columns
--  WHERE table_name IN ('erp_consultation_items', 'erp_order_items')
--    AND column_name IN ('purchase_discount', 'purchase_discount_mode', 'purchase_discount_unit', 'order_season')
--  ORDER BY table_name, column_name;   -- 8행이어야 함
