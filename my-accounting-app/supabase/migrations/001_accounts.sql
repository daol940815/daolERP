-- =====================================================
-- 001_accounts.sql
-- 계정과목(Chart of Accounts) 테이블
-- 거래 내역을 분류하기 위한 회계 계정 목록을 저장
-- =====================================================

CREATE TABLE IF NOT EXISTS accounts (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  -- 계정과목 코드 (예: 1001, 2001 등 - 향후 계정체계 확장용)
  code        VARCHAR(20) UNIQUE,
  -- 계정과목명 (예: 매출, 급여, 보통예금)
  name        VARCHAR(100) NOT NULL,
  -- 계정 유형: income(수익), expense(비용), asset(자산), liability(부채), equity(자본)
  type        VARCHAR(20)  NOT NULL CHECK (type IN ('income', 'expense', 'asset', 'liability', 'equity')),
  -- AI 자동 분류에 사용할 키워드 배열 (예: ["택시","카카오T","KTX"])
  keywords    TEXT[]       DEFAULT '{}',
  -- 활성 여부 (false면 선택 목록에서 숨김)
  is_active   BOOLEAN      DEFAULT true,
  created_at  TIMESTAMPTZ  DEFAULT now(),
  updated_at  TIMESTAMPTZ  DEFAULT now()
);

-- 계정과목명으로 빠른 검색을 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_accounts_name ON accounts(name);

-- 계정 유형별 조회를 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_accounts_type ON accounts(type);

-- 활성 계정만 조회하기 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_accounts_is_active ON accounts(is_active);

-- keywords 배열을 GIN 인덱스로 검색 최적화 (AI 분류 시 키워드 매칭 속도 향상)
CREATE INDEX IF NOT EXISTS idx_accounts_keywords ON accounts USING GIN(keywords);

-- updated_at 자동 갱신을 위한 트리거 함수
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- accounts 테이블에 updated_at 트리거 적용
DROP TRIGGER IF EXISTS trg_accounts_updated_at ON accounts;
CREATE TRIGGER trg_accounts_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
