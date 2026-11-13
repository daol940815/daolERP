-- =====================================================
-- 425_cash_receipt_payments.sql  (회계 트랙 — 스키마)
-- 현금영수증(매출 발행) ↔ 통장 입금 매칭 (2026-11-13 사용자 요청 "현금영수증 매칭 추가 먼저")
--
-- 목적: 매출 성격 통장 입금 중 어떤 것이 현금영수증 발행 건인지 연결해
--   ① 증빙(계산서·현금영수증·카드) 없는 매출 입금을 골라내고 ② 금액 대조 ③ 증빙 기준 손익의 중복 제거를 정확히 한다.
-- 분개에는 영향이 없다 — 현금영수증은 분개하지 않고(통장 입금이 상품매출 분개를 담당), 연결 정보만 더한다.
-- 모양은 tax_invoice_payments(계산서 결제연결)와 같다: 현금영수증 1건에 입금 여러 건을 부분 금액으로 연결할 수 있다.
-- 원본 데이터 변경 없음.
-- =====================================================

CREATE TABLE IF NOT EXISTS cash_receipt_payments (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  cash_receipt_id  UUID        NOT NULL REFERENCES cash_receipts(id) ON DELETE CASCADE,
  transaction_id   UUID        NOT NULL REFERENCES transactions(id)  ON DELETE CASCADE,
  amount           BIGINT      NOT NULL CHECK (amount > 0),
  -- 'auto' = 자동 매칭(금액 같음 · ±7일 · 후보 1건) / 'manual' = 사람이 연결
  matched_by       TEXT        NOT NULL DEFAULT 'manual' CHECK (matched_by IN ('auto', 'manual')),
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (cash_receipt_id, transaction_id)
);
CREATE INDEX IF NOT EXISTS idx_cash_receipt_payments_receipt     ON cash_receipt_payments(cash_receipt_id);
CREATE INDEX IF NOT EXISTS idx_cash_receipt_payments_transaction ON cash_receipt_payments(transaction_id);

-- 현금영수증 쪽 요약 상태 (연결 금액 합으로 서버가 갱신): unmatched / partial / matched
ALTER TABLE cash_receipts ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unmatched'
  CHECK (payment_status IN ('unmatched', 'partial', 'matched'));
CREATE INDEX IF NOT EXISTS idx_cash_receipts_payment_status ON cash_receipts(payment_status) WHERE direction = 'sales';
COMMENT ON COLUMN cash_receipts.payment_status IS '매출 발행 건의 통장 입금 확인 상태 — cash_receipt_payments 합으로 갱신. 매입(수취) 건은 사용하지 않음.';

-- 검증: 매출 발행(승인) 현금영수증 건수·금액 (= 매칭 대상 규모)
SELECT COUNT(*) AS 매출_승인_건수, COALESCE(SUM(amount), 0) AS 합계,
       MIN(tx_date) || ' ~ ' || MAX(tx_date) AS 기간
FROM cash_receipts WHERE direction = 'sales' AND transaction_type = 'approval';
