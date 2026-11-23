-- =====================================================
-- 1401_stock_review_marks.sql  (재고 관리 트랙 — docs/inventory-track.md, 2차 확인 필요 탭)
-- 확인 필요 처리 기록: "재고가 있는데 새로 매입한 행"을 사람이 "맞음(실제 새로 매입)"으로 확인하면 다시 띄우지 않는다.
--
-- 원칙: 주문 행은 고치지 않는다. 확인 결과(연결 · 해석 정보)만 따로 남긴다.
--  - "재고 출고로 바꾸기"는 이 표가 아니라 주문 행 취소 + 새 행 등록(주문 변경 이력 erp_order_edit_logs)으로 남는다.
--  - 실사 차이는 이 표가 아니라 조정 행(erp_stock_adjustments.stocktake_id)으로 해소한다.
-- 1401 미적용이어도 확인 필요 목록은 보인다("맞음" 처리만 안내 문구로 막힘). 재실행 안전.
-- =====================================================

CREATE TABLE IF NOT EXISTS erp_stock_review_marks (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id UUID        NOT NULL REFERENCES erp_order_items(id) ON DELETE CASCADE,
  decision      TEXT        NOT NULL CHECK (decision IN ('new_purchase')),   -- 맞음(실제 새로 매입)
  reason        TEXT,
  employee_id   UUID        REFERENCES employees(id) ON DELETE SET NULL,
  employee_name TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_review_marks_item ON erp_stock_review_marks(order_item_id);

COMMENT ON TABLE erp_stock_review_marks IS
  '재고 확인 필요 처리 기록 (1401). 재고가 있는데 새로 매입한 주문 행을 "맞음(실제 새로 매입)"으로 확인한 기록 — 다시 띄우지 않는다. 주문 행은 수정하지 않는다.';

ALTER TABLE erp_stock_review_marks ENABLE ROW LEVEL SECURITY;

-- 확인: SELECT COUNT(*) FROM erp_stock_review_marks;  -- 0
