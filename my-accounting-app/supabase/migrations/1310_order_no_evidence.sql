-- 1310_order_no_evidence.sql  (결제처리 트랙 — docs/payment-track.md, 시안 docs/mockups/증빙없이처리_현금매출_시안.html)
-- 증빙 없이 처리 (2026-11-25 사용자 결정): 계산서 · 현금영수증 없이 통장 입금으로 받은 주문을 "증빙 없이 처리"로 확인한 기록.
--   한 줄 = 주문 1건 × 통장 입금 1건 (주문에 붙은 입금이 여러 건이면 여러 줄 — 입금일이 달의 귀속을 정한다).
--   taxable_amount = 과세분(부가세 포함 금액) → 예상 부가세 "현금 매출(자동)" 입금일 달에 공급가 = 과세분 ÷ 1.1.
--   exempt_amount  = 면세분 → 신고 줄이 아니라 참고 표시.
--   confirmed_by_us = 이 처리로 통장 입금을 상품매출(4001)로 확정했는지. 해제할 때 그 입금만 처리 전 상태(prev_status · prev_account_id)로 되돌린다.
-- 주문 · 통장 원본은 고치지 않는다(통장 분류 확정은 사용자가 누른 처리의 일부 — 통장 내역 확정과 같은 동작).
-- 재실행 안전.

CREATE TABLE IF NOT EXISTS order_no_evidence (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         UUID NOT NULL REFERENCES erp_orders(id) ON DELETE CASCADE,
  transaction_id   UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  paid_date        DATE NOT NULL,
  amount           BIGINT NOT NULL,                 -- 이 주문에 붙은 이 입금의 금액
  vat_kind         TEXT NOT NULL CHECK (vat_kind IN ('taxable', 'exempt', 'mixed')),
  taxable_amount   BIGINT NOT NULL DEFAULT 0,
  exempt_amount    BIGINT NOT NULL DEFAULT 0,
  reason_code      TEXT NOT NULL,
  reason_text      TEXT NOT NULL,
  confirmed_by_us  BOOLEAN NOT NULL DEFAULT false,
  prev_status      TEXT,
  prev_account_id  UUID,
  created_by       UUID,
  created_by_name  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at      TIMESTAMPTZ,
  released_by      UUID,
  released_by_name TEXT,
  release_reason_code TEXT,
  release_reason_text TEXT,
  CHECK (taxable_amount + exempt_amount = amount)
);

-- 살아 있는 처리는 (주문, 입금)당 하나
CREATE UNIQUE INDEX IF NOT EXISTS uq_order_no_evidence_live ON order_no_evidence(order_id, transaction_id) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_order_no_evidence_paid ON order_no_evidence(paid_date) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_order_no_evidence_tx ON order_no_evidence(transaction_id);

ALTER TABLE order_no_evidence ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE order_no_evidence IS '증빙 없이 처리 (1310, 2026-11-25) — 계산서 · 현금영수증 없이 통장으로 받은 주문의 확인 기록. 과세분은 예상 부가세 현금 매출(입금일 기준)에 자동 반영.';

-- 검증
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'order_no_evidence') AS table_created,
  (SELECT count(*) FROM order_no_evidence) AS rows_now;
