-- =====================================================
-- 507_purchase_orders.sql
-- 발주서 (3단계 1차) — 주문 단위 발주 (사용자 확정 개념)
--
-- 업무 플로우: 상담일지 → 주문서 → 발주서 작성 → 발송 → 대금결제.
-- 발주는 "주문 1건의 품목을 매입처별로 발주서로 작성해 발송"하는
-- 주문 하위 작업이다 (여러 주문 일괄 발주 아님 — 시안 v2).
--
--  - erp_purchase_orders: 발주서 1장 = 주문 1건 × 매입처 1곳
--  - erp_purchase_order_items: 발주 품목. 주문 품목과 연결(중복 발주 방지)
--    + 스냅샷 보존 (주문 수정 시 품목 행이 교체되어도 발주서 내용 유지)
--  - vendors.uses_custom_po: 자체 양식 매입처 표시 (1차: 자사 양식 참고용
--    생성 + 수동 발송 기록, 2차에 빈도 높은 곳부터 템플릿 재현)
--  - 발송: 네이버 SMTP(백업 CC) 또는 수동 발송 기록. 성공·실패 이력 보존
--  - 대금결제 연결: 발주서의 매입처 별칭이 기존 매입처 정산(erp_purchase_
--    settlements)·허브와 같은 축 — 별도 구조 불필요
-- =====================================================

-- ── 1) 발주서 ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_purchase_orders (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_no              VARCHAR(20) NOT NULL UNIQUE,      -- POyymmdd-## 자동 발번
  order_id           UUID NOT NULL REFERENCES erp_orders(id) ON DELETE CASCADE,
  purchase_alias_id  UUID REFERENCES erp_vendor_aliases(id) ON DELETE SET NULL,
  vendor_id          UUID REFERENCES vendors(id) ON DELETE SET NULL,
  vendor_name        TEXT NOT NULL,                    -- 매입처 표기 (발주 시점 보존)
  total_amount       BIGINT NOT NULL DEFAULT 0,        -- 매입 합계
  delivery_note      TEXT,                             -- 배송 참고 (주문 메모+상담일지 취합, 수정 가능)
  -- 발송
  email_to           TEXT,
  send_method        TEXT CHECK (send_method IN ('email', 'manual')),  -- NULL=미발송
  sent_at            TIMESTAMPTZ,
  sent_by            UUID REFERENCES employees(id) ON DELETE SET NULL,
  send_error         TEXT,                             -- 마지막 발송 실패 사유
  -- 상태: active=유효, canceled=발주 취소 (품목은 미발주로 복귀)
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled')),
  created_by         UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_po_order  ON erp_purchase_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_po_vendor ON erp_purchase_orders(vendor_id) WHERE vendor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_po_status ON erp_purchase_orders(status, created_at DESC);

DROP TRIGGER IF EXISTS trg_po_updated_at ON erp_purchase_orders;
CREATE TRIGGER trg_po_updated_at
  BEFORE UPDATE ON erp_purchase_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 2) 발주 품목 (연결 + 스냅샷) ──────────────────────
CREATE TABLE IF NOT EXISTS erp_purchase_order_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id             UUID NOT NULL REFERENCES erp_purchase_orders(id) ON DELETE CASCADE,
  line_no           SMALLINT NOT NULL,
  -- 주문 품목 연결 — 미발주 판정·중복 발주 방지의 기준.
  -- 주문 수정으로 품목 행이 교체되면 NULL이 되고, 해당 품목은 다시 미발주로
  -- 보인다 (수정된 주문은 재발주 검토가 필요하므로 의도된 동작 — 화면에 경고 표시)
  order_item_id     UUID REFERENCES erp_order_items(id) ON DELETE SET NULL,
  -- 발주 시점 스냅샷 (발주서 내용은 주문 수정과 무관하게 보존)
  item_code         VARCHAR(50),
  item_name         VARCHAR(300),
  order_kind        VARCHAR(20),
  quantity          INTEGER NOT NULL DEFAULT 0,
  purchase_price    BIGINT NOT NULL DEFAULT 0,
  purchase_shipping BIGINT NOT NULL DEFAULT 0,
  purchase_total    BIGINT NOT NULL DEFAULT 0,
  memo              TEXT,                              -- 비고 (품목 메모·옵션 등)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (po_id, line_no)
);
CREATE INDEX IF NOT EXISTS idx_po_items ON erp_purchase_order_items(po_id);
-- 유효한 발주서에 담긴 주문 품목은 중복 발주 불가 (취소된 발주는 부분 유니크에서 제외 —
-- 앱에서 status='active' 검사와 병행. DB 강제는 트리거가 필요해 앱 검사로 갈음)
CREATE INDEX IF NOT EXISTS idx_po_items_order_item
  ON erp_purchase_order_items(order_item_id) WHERE order_item_id IS NOT NULL;

-- ── 3) 자체 양식 매입처 표시 ──────────────────────────
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS uses_custom_po BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN vendors.uses_custom_po IS
  '자체 발주서 양식을 요구하는 매입처. 1차: 자사 양식 참고용 생성 + 수동 발송 기록.';

-- ── RLS (서비스 키 경유 API만 접근) ───────────────────
ALTER TABLE erp_purchase_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_purchase_order_items ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE erp_purchase_orders IS
  '발주서 — 주문 1건 × 매입처 1곳. 발송(메일/수동)·취소 이력 보존. 대금결제는 기존 매입처 정산 축과 연결.';
