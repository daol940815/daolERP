-- =====================================================
-- 024_bank_account_overdraft.sql
-- 마이너스통장(한도대출) 계좌 유형 관리
-- - account_type: 'normal'(일반 입출금) | 'overdraft'(마이너스통장)
-- - overdraft_limit: 한도 (음수, 예: -200000000 = 2억원 한도)
-- - 원본 거래/잔액 데이터는 변경하지 않음 (조회/집계 단계에서만 구분 계산)
-- =====================================================

ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS account_type VARCHAR(20) NOT NULL DEFAULT 'normal'
    CHECK (account_type IN ('normal', 'overdraft')),
  ADD COLUMN IF NOT EXISTS overdraft_limit BIGINT;

CREATE INDEX IF NOT EXISTS idx_bank_accounts_account_type ON bank_accounts(account_type);

-- 기존 마이너스통장 계좌 2건 등록
-- 우리은행 1005-203-358607, 한도 -200,000,000원
UPDATE bank_accounts
SET account_type = 'overdraft', overdraft_limit = -200000000
WHERE bank_name = '우리은행' AND REPLACE(account_number, '-', '') = '1005203358607';

-- 하나은행 369-890010-57804, 한도 -150,000,000원
UPDATE bank_accounts
SET account_type = 'overdraft', overdraft_limit = -150000000
WHERE bank_name = '하나은행' AND REPLACE(account_number, '-', '') = '36989001057804';
