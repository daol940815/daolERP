-- =====================================================
-- 007_bank_accounts.sql
-- 은행 계좌 테이블 - 업로드 시 자동 생성
-- =====================================================

CREATE TABLE IF NOT EXISTS bank_accounts (
  id             UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  -- 은행명 (우리은행, 하나은행 등) — 파일 업로드 시 자동 생성, UNIQUE로 중복 방지
  bank_name      VARCHAR(50)  NOT NULL UNIQUE,
  -- 계좌번호 (선택, 예: 1005-804-575410)
  account_number VARCHAR(50),
  -- 화면 표시용 별칭 (예: 우리은행 법인)
  alias          VARCHAR(100),
  -- 비활성화 시 사이드바에서 숨김
  is_active      BOOLEAN      DEFAULT true,
  created_at     TIMESTAMPTZ  DEFAULT now(),
  updated_at     TIMESTAMPTZ  DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_bank_name ON bank_accounts(bank_name);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_is_active ON bank_accounts(is_active);

-- transactions 테이블에 bank_account_id 컬럼 추가
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_bank_account ON transactions(bank_account_id);

-- updated_at 자동 갱신 트리거
DROP TRIGGER IF EXISTS trg_bank_accounts_updated_at ON bank_accounts;
CREATE TRIGGER trg_bank_accounts_updated_at
  BEFORE UPDATE ON bank_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
