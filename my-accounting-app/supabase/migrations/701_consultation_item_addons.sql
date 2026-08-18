-- =====================================================
-- 701_consultation_item_addons.sql
-- 상담일지 품목에 부가상품 옵션 연결 (사용자 확정 2026-08-18)
--
-- 504(주문 품목 옵션)와 동일 구조를 상담 품목에도 적용한다.
-- 상담일지가 504 이후에 생긴 화면이라 옵션 기능이 빠져 있었다 —
-- 상담 단계에서도 본 상품 아래 같은 매입처의 부자재(포장지·쇼핑백 등)를
-- 옵션 행으로 붙이고, 주문서 전환 시 연결이 그대로 넘어간다.
-- 데이터는 평평한 행 구조 그대로 (연결 표시만 추가) — 하류 무변경.
-- =====================================================

ALTER TABLE erp_consultation_items
  ADD COLUMN IF NOT EXISTS parent_line_no SMALLINT;

COMMENT ON COLUMN erp_consultation_items.parent_line_no IS
  '이 행이 옵션(부가상품)일 때 딸린 본 상품 행의 line_no. NULL=일반 품목 (504의 erp_order_items.parent_line_no와 동일 구조)';
