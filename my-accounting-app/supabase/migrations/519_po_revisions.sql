-- =====================================================
-- 519_po_revisions.sql
-- 발주서 '수정 내용 반영' (2026-11-27 사용자 결정 — 나안, 시안 project-files mockups/발주서_수정반영_시안.html)
--
-- 발주 뒤 주문 품목을 고치면 바뀐 품목은 취소 + 새 행이 되고, 발주서 줄은 취소된 옛 행을 계속 가리켜
-- 새 행이 미발주(주문 = 부분발주)로 남는다. 직원이 고친 내용을 업체에 다시 보낸 뒤 '수정 내용 반영'을 누르면
-- 발주서 줄을 새 행에 다시 연결하고 발주서에 적힌 수량 · 금액을 새 값으로 바꾼다. 이 파일은 그 기록을 위한 것.
--
--  1) erp_purchase_order_items.removed_at — "짝 없음"(주문에서 빠진 품목)으로 반영한 줄. 지우지 않고 표시만 하며,
--     발주서 엑셀 · 합계 · 화면 내용에서 빠진다. 옛 내용은 2)의 이력에 남는다.
--  2) erp_po_revisions — 반영 1회 = 1행. 바뀐 줄의 이전 · 이후 값(changes JSONB), 합계 이전 · 이후, 근거 발송 기록, 누가 · 언제.
--
-- 기존 데이터는 바뀌지 않는다(컬럼 추가 · 새 표만). 앱은 미적용 DB에서 이 기능만 안내 문구를 낸다.
-- =====================================================

ALTER TABLE erp_purchase_order_items
  ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS erp_po_revisions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id             UUID NOT NULL REFERENCES erp_purchase_orders(id) ON DELETE CASCADE,
  basis_send_log_id UUID REFERENCES erp_po_send_logs(id) ON DELETE SET NULL,   -- 반영 근거: 주문 수정 뒤의 발송 기록
  total_before      BIGINT NOT NULL DEFAULT 0,
  total_after       BIGINT NOT NULL DEFAULT 0,
  -- [{ action: 'relink' | 'remove' | 'add', po_line_no, before: {order_item_id, item_name, quantity, purchase_price, purchase_shipping, purchase_total, memo} | null,
  --    after: {...} | null }]
  changes           JSONB NOT NULL DEFAULT '[]'::jsonb,
  revised_by        UUID REFERENCES employees(id) ON DELETE SET NULL,
  revised_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_po_revisions ON erp_po_revisions(po_id, revised_at DESC);

ALTER TABLE erp_po_revisions ENABLE ROW LEVEL SECURITY;   -- 서비스 키 경유 API만 접근 (510과 같은 방식)

-- ── 검증 ──────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'erp_purchase_order_items' AND column_name = 'removed_at') AS 빠진줄_칸_기대1,
  (SELECT count(*) FROM erp_po_revisions) AS 반영이력_기대0,
  (SELECT count(*) FROM erp_purchase_order_items WHERE removed_at IS NOT NULL) AS 빠진줄_기대0;
