-- =====================================================
-- 504_product_addons.sql
-- 부가상품(포장지·쇼핑백 등) — 옵션 빠른 추가 (B안, 사용자 확정 2026-08-08)
--
-- 기존 ERP는 옵션 기능이 없어 부자재를 별도 품목으로 관리해왔다.
-- 새 시스템: 품목 마스터에 부가상품 플래그를 두고, 주문 입력에서 본 상품을
-- 고르면 "같은 매입처"의 부가상품이 옵션 추가 칩으로 표시된다 (사용자 확정:
-- 부자재는 같은 매입처 상품에만 사용, 특수 케이스는 일반 행 직접 입력).
-- 품목 행에는 어느 본 상품 행에 딸린 옵션인지 연결(parent_line_no)을 남긴다 —
-- 데이터는 평평한 행 구조 그대로라 발주서·회계 등 하류는 무변경.
-- =====================================================

ALTER TABLE erp_products
  ADD COLUMN IF NOT EXISTS is_addon BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN erp_products.is_addon IS
  '부가상품(포장지·쇼핑백 등). 주문 입력에서 같은 매입처 본 상품의 옵션 추가 칩으로 노출. 원가표 업로드 시 품번 XX-01 대역(VIP·선결제 제외)을 자동 표시하며 화면에서 수정 가능';

ALTER TABLE erp_order_items
  ADD COLUMN IF NOT EXISTS parent_line_no SMALLINT;

COMMENT ON COLUMN erp_order_items.parent_line_no IS
  '이 행이 옵션(부가상품)일 때 딸린 본 상품 행의 line_no. NULL=일반 품목';
