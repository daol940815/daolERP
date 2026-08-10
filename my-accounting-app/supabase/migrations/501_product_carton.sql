-- =====================================================
-- 501_product_carton.sql
-- 품목 마스터 카톤 단위 — 배송비 자동 계산 기준
--
-- carton_unit: 1카톤에 들어가는 수량. 주문 입력 시
--   배송비 = ceil(갯수 / carton_unit) × carton_shipping_fee 로 자동 채움
--   (칸은 수정 가능 — 시스템은 추천만, 확정은 사용자).
-- NULL 또는 0 = 카톤 개념 없음(배송비 자동 계산 안 함).
-- =====================================================

ALTER TABLE erp_products
  ADD COLUMN IF NOT EXISTS carton_unit         INTEGER,
  ADD COLUMN IF NOT EXISTS carton_shipping_fee BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN erp_products.carton_unit         IS '1카톤당 수량. NULL/0 = 카톤 미사용(배송비 자동 계산 안 함)';
COMMENT ON COLUMN erp_products.carton_shipping_fee IS '카톤당 배송비 — 주문 입력 시 ceil(갯수/카톤단위)×이 값으로 배송비 자동 채움';
