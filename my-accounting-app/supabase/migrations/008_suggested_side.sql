-- 거래 내역에 차변/대변 제안 컬럼 추가
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS suggested_side VARCHAR(10)
    CHECK (suggested_side IN ('debit', 'credit'));

COMMENT ON COLUMN transactions.suggested_side IS
  'debit = 차변, credit = 대변. 계정과목 유형 + 입출금 방향으로 자동 결정되며 사용자가 수정 가능.';
