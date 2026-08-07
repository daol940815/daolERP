-- =====================================================
-- 502_product_individual_price.sql
-- 품목 마스터 지점판매가/개별판매가 분리 — 배송 형태별 가격 정책
--
-- 실무 배경: 한 곳(지점)으로 묶음 배송하면 카톤 기준 배송비를 별도 책정하지만,
-- 한 품목 여러 개를 여러 곳으로 개별 배송하면 배송비를 따로 청구하지 않고
-- 배송비를 포함한 개별판매가로 판매한다 (원가표에 두 판매가를 나눠 관리 중).
--
-- sale_price            = 지점판매가 (기존 컬럼 의미 확정. 배송비 별도 — 카톤 자동 계산)
-- individual_sale_price = 개별판매가 (배송비 포함가. 0 = 미지정 → 지점판매가 사용)
-- 주문 입력의 품목 구분(지점/개별/샘플)에 따라 자동 적용:
--   지점: 지점판매가 + 카톤 배송비 자동 / 개별: 개별판매가, 배송비 0 / 샘플: 자동 없음
-- =====================================================

ALTER TABLE erp_products
  ADD COLUMN IF NOT EXISTS individual_sale_price BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN erp_products.sale_price            IS '지점판매가 — 한 곳 묶음 배송, 배송비는 카톤 기준 별도 자동 계산';
COMMENT ON COLUMN erp_products.individual_sale_price IS '개별판매가 — 여러 곳 개별 배송, 배송비 포함가. 0=미지정(지점판매가 사용)';
