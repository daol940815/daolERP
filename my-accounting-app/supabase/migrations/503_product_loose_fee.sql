-- =====================================================
-- 503_product_loose_fee.sql
-- 품목 마스터 — 실물 원가표 구조 반영 (사용자 확인 2026-08-08)
--
-- 원가표 검증 결과(2,358행 전수 대조):
--   개별매입가 = 지점매입가 + 카톤외택배비 (예외 0)
--   개별판매가 = 지점판매가 + 카톤외택배비 (예외 0)
-- 개별매입가는 기존 ERP가 배송비를 별도 표기 못해 만든 파생 개념 —
-- 새 시스템은 저장하지 않고 주문 입력 시 자동 계산한다.
--
-- 지점 배송비 공식(확정): 꽉 찬 카톤 수 × 카톤택배비
--                        + (나머지 낱개 있으면 카톤외택배비 1건)
-- =====================================================

ALTER TABLE erp_products
  ADD COLUMN IF NOT EXISTS loose_shipping_fee BIGINT NOT NULL DEFAULT 0,  -- 카톤외(낱개 1건) 택배비
  ADD COLUMN IF NOT EXISTS category           TEXT,                        -- 분류 (원가표 '목차': 타올/골프공 등)
  ADD COLUMN IF NOT EXISTS option_name        TEXT;                        -- 옵션명 (6구/1P 등 — 품번 마지막 세그먼트와 대응)

COMMENT ON COLUMN erp_products.loose_shipping_fee IS
  '카톤외(낱개 1건) 택배비. 지점 배송비 = floor(갯수/카톤단위)×카톤택배비 + (나머지>0 ? 이 값 : 0). 개별 구분 매입가·판매가 파생에도 사용';
COMMENT ON COLUMN erp_products.category    IS '분류 — 원가표 목차 컬럼 (검색·필터용)';
COMMENT ON COLUMN erp_products.option_name IS '옵션명 — 상품명에 이미 구분이 있어 참고 정보';

CREATE INDEX IF NOT EXISTS idx_erp_products_category ON erp_products(category) WHERE category IS NOT NULL;
