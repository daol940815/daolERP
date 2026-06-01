-- accounts 테이블에 차변/대변 방향 규칙 컬럼 추가
-- side_on_in:  입금(amount_in > 0) 시 분류 계정의 방향 (기본: 대변)
-- side_on_out: 출금(amount_out > 0) 시 분류 계정의 방향 (기본: 차변)
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS side_on_in  VARCHAR(10) DEFAULT 'credit'
    CHECK (side_on_in  IN ('debit', 'credit')),
  ADD COLUMN IF NOT EXISTS side_on_out VARCHAR(10) DEFAULT 'debit'
    CHECK (side_on_out IN ('debit', 'credit'));

COMMENT ON COLUMN accounts.side_on_in  IS '입금 거래에서 이 계정의 방향: debit(차변) / credit(대변). 기본 대변.';
COMMENT ON COLUMN accounts.side_on_out IS '출금 거래에서 이 계정의 방향: debit(차변) / credit(대변). 기본 차변.';
