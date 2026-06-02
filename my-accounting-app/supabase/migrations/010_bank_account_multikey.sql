-- ================================================================
-- 010_bank_account_multikey.sql
-- 같은 은행에 계좌번호가 다른 여러 계좌를 허용
-- ================================================================

-- bank_name 단독 UNIQUE 제약 제거
ALTER TABLE bank_accounts DROP CONSTRAINT IF EXISTS bank_accounts_bank_name_key;

-- (bank_name, account_number) 복합 유니크 인덱스 추가
-- account_number 가 NULL 인 경우는 제외 (NULL 은 PostgreSQL 에서 별개로 취급)
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_accounts_name_number
  ON bank_accounts(bank_name, account_number)
  WHERE account_number IS NOT NULL;
