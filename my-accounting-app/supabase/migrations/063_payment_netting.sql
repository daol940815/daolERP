-- =====================================================
-- 063_payment_netting.sql
-- 수정(음수) 계산서의 상계 연결 허용.
--
-- 사례(이음전산): 계산서 319,500 + 수정계산서 -297,500 → 실제 출금은 순액 22,000.
-- 두 계산서를 같은 출금에 연결하려면 음수 계산서는 음수 금액으로 연결되어야
-- 거래 배분 합(319,500 - 297,500 = 22,000)이 실제 출금과 일치한다.
-- 기존 CHECK (amount > 0)이 이를 막고 있었다 → 0만 금지로 완화.
-- 부호 검증(양수 계산서=양수, 음수 계산서=음수)은 addInvoicePayment가 담당.
-- =====================================================

ALTER TABLE tax_invoice_payments
  DROP CONSTRAINT IF EXISTS tax_invoice_payments_amount_check;
ALTER TABLE tax_invoice_payments
  ADD CONSTRAINT tax_invoice_payments_amount_check CHECK (amount <> 0);
