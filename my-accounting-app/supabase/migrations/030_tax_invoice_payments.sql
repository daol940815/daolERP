-- =====================================================
-- 030_tax_invoice_payments.sql
-- 세금계산서 ↔ 거래내역 다대다 결제 연결 테이블
-- 기존 tax_invoices.matched_transaction_id(계산서 1건 ↔ 거래 1건, 전액 매칭 전제)로는
-- "한 계산서를 여러 번에 나눠 입금" 또는 "여러 계산서를 한 번에 합산 입금" 같은
-- 분할/합산 결제를 금액 단위로 추적할 수 없어, 연결 건마다 금액을 기록하는 테이블을 추가한다.
-- 같은 계산서에 여러 행이 쌓이면 합계가 계산서 금액에 도달했을 때만 결제완료로 처리한다.
-- =====================================================

CREATE TABLE IF NOT EXISTS tax_invoice_payments (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  tax_invoice_id  UUID        NOT NULL REFERENCES tax_invoices(id) ON DELETE CASCADE,
  transaction_id  UUID        NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  amount          BIGINT      NOT NULL CHECK (amount > 0),
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tax_invoice_id, transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_tax_invoice_payments_invoice     ON tax_invoice_payments(tax_invoice_id);
CREATE INDEX IF NOT EXISTS idx_tax_invoice_payments_transaction ON tax_invoice_payments(transaction_id);

-- 기존에 matched_transaction_id로 1:1 매칭되어 있던 건은 전액 결제로 간주해 그대로 이전
INSERT INTO tax_invoice_payments (tax_invoice_id, transaction_id, amount)
SELECT id, matched_transaction_id, total_amount
FROM tax_invoices
WHERE matched_transaction_id IS NOT NULL
ON CONFLICT (tax_invoice_id, transaction_id) DO NOTHING;
