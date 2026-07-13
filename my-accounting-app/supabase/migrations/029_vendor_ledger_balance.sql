-- 거래처가 보내준 거래처원장 기준 잔액 스냅샷
-- (시스템이 계산한 미수금/미지급 잔액과 별개로, 거래처 측 장부를 대사할 때 수기로 입력/갱신)
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS ledger_balance            BIGINT,
  ADD COLUMN IF NOT EXISTS ledger_balance_updated_at  DATE;

COMMENT ON COLUMN vendors.ledger_balance
  IS '거래처원장 기준 잔액 (거래처가 통보한 미수/미지급액, 수기 입력)';
COMMENT ON COLUMN vendors.ledger_balance_updated_at
  IS '거래처원장 잔액을 마지막으로 확인/갱신한 날짜';
