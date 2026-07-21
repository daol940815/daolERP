-- =====================================================
-- 067_erp_order_invoices.sql
-- ERP 주문 ↔ 매출 세금계산서 문서 단위 연결 기록
--
-- 목표: "주문 → 계산서 발행 → 수금" 3단 대사의 가운데 변.
-- 021 erp_payment_matches(주문↔입금)와 동일한 배분 구조 —
-- 계산서 1장을 여러 주문에 나누거나(합산 발행),
-- 주문 1건에 계산서 여러 장을 충당(분할 발행)할 수 있다.
-- 자동확정(고신뢰 1:1)과 수동 확정 모두 이 테이블에 저장한다.
-- =====================================================

CREATE TABLE IF NOT EXISTS erp_order_invoices (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       UUID NOT NULL REFERENCES erp_orders(id) ON DELETE CASCADE,
  tax_invoice_id UUID NOT NULL REFERENCES tax_invoices(id) ON DELETE CASCADE,
  amount         BIGINT NOT NULL CHECK (amount > 0),  -- 이 주문에 충당된 계산서 금액
  issue_date     DATE NOT NULL,                       -- 계산서 발행일 (표시용 복제)
  matched_by     TEXT NOT NULL DEFAULT 'manual' CHECK (matched_by IN ('auto', 'manual')),
  memo           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_erp_order_inv_order   ON erp_order_invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_erp_order_inv_invoice ON erp_order_invoices(tax_invoice_id);

ALTER TABLE erp_order_invoices ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE erp_order_invoices IS
  'ERP 주문 ↔ 매출 계산서 연결. 계산서 1장을 여러 주문에 배분(합산 발행)하거나 주문 1건에 여러 계산서를 충당(분할 발행)할 수 있음.';
