-- ================================================================
-- 012_transfer_pair.sql
-- 법인 내 타계좌 이체 거래 쌍 연결 컬럼 추가
-- 동일 법인 A통장 → B통장 이체 시 두 거래를 같은 UUID로 묶음
-- ================================================================

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS transfer_pair_id uuid;

CREATE INDEX IF NOT EXISTS idx_transactions_transfer_pair_id
  ON transactions (transfer_pair_id)
  WHERE transfer_pair_id IS NOT NULL;
