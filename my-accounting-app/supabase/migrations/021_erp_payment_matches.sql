-- =====================================================
-- 021_erp_payment_matches.sql
-- 입금(은행/카드/현금영수증) ↔ ERP 주문 건 단위 매칭 기록
--
-- 자동확정(고신뢰: 같은 거래처 + 금액 정확 일치 + 날짜 근접 + 1:1)과
-- 수동 배분(합산입금을 여러 주문에 나누는 경우) 모두 이 테이블에 저장한다.
-- 품목별 결제일자는 저장하지 않고, 화면 표시 시 주문의 매칭 기록을
-- 날짜순으로 위 품목부터 차감(waterfall)해 계산한다.
-- =====================================================

CREATE TABLE IF NOT EXISTS erp_payment_matches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES erp_orders(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('bank', 'card', 'cash')),
  source_id   UUID NOT NULL,  -- transactions.id / card_sales.id / cash_receipts.id (타입별 상이라 FK 없음)
  amount      BIGINT NOT NULL CHECK (amount > 0),  -- 이 주문에 충당된 금액
  paid_date   DATE NOT NULL,                       -- 입금일/승인일
  matched_by  TEXT NOT NULL DEFAULT 'manual' CHECK (matched_by IN ('auto', 'manual')),
  memo        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_erp_matches_order  ON erp_payment_matches(order_id);
CREATE INDEX IF NOT EXISTS idx_erp_matches_source ON erp_payment_matches(source_type, source_id);

COMMENT ON TABLE erp_payment_matches IS
  '입금 ↔ ERP 주문 매칭. 한 입금을 여러 주문에 배분하거나(합산입금) 한 주문에 여러 입금을 충당할 수 있음.';
