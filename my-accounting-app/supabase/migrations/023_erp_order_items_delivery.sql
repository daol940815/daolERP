-- 품목별 배송 정보(송장번호/배송상태) 컬럼 추가
-- 배송조회 연동은 추후 추가 예정이며, 우선 입력/표시용 컬럼만 추가한다.
ALTER TABLE erp_order_items
  ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(20)
    CHECK (delivery_status IS NULL OR delivery_status IN ('in_transit', 'delivered', 'issue')),
  ADD COLUMN IF NOT EXISTS is_shipping_exempt BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN erp_order_items.tracking_number IS '송장번호 (배송조회 연동 전 수동 입력)';
COMMENT ON COLUMN erp_order_items.delivery_status IS '품목 배송상태: in_transit(이동중), delivered(배송완료), issue(확인필요)';
COMMENT ON COLUMN erp_order_items.is_shipping_exempt IS '주문 배송상태 집계 제외 품목 (배송비, 포장 등)';
