-- =====================================================
-- 004_journal_entries.sql
-- 분개(Journal Entry) 테이블
-- 확정된 거래를 복식부기 형태로 기록
-- 하나의 거래(transaction)에 여러 개의 분개 라인이 생성됨
-- =====================================================

-- 분개 헤더 (거래 1건 = 분개 1개)
CREATE TABLE IF NOT EXISTS journal_entries (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  -- 원본 거래 ID (transactions 테이블 참조)
  transaction_id  UUID        REFERENCES transactions(id) ON DELETE CASCADE,
  -- 분개 번호 (예: JE-2024-0001, 사람이 읽기 쉬운 식별자)
  entry_no        VARCHAR(50),
  -- 분개 일자 (거래일과 다를 수 있음 - 결산 조정 등)
  entry_date      DATE        NOT NULL,
  -- 분개 설명 (적요)
  description     TEXT,
  -- 분개 유형: normal(일반), adjustment(조정), closing(결산)
  entry_type      VARCHAR(20) DEFAULT 'normal' CHECK (entry_type IN ('normal', 'adjustment', 'closing')),
  -- 작성자 (Supabase Auth user id)
  created_by      UUID,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- 분개 라인 (한 분개에 차변/대변 각각 최소 1개 이상)
CREATE TABLE IF NOT EXISTS journal_lines (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  -- 속한 분개 ID
  journal_entry_id  UUID        NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  -- 계정과목 ID
  account_id        UUID        NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  -- 차변/대변 구분: debit(차변), credit(대변)
  side              VARCHAR(10) NOT NULL CHECK (side IN ('debit', 'credit')),
  -- 금액 (항상 양수)
  amount            BIGINT      NOT NULL CHECK (amount > 0),
  -- 거래처 (선택)
  vendor_id         UUID        REFERENCES vendors(id) ON DELETE SET NULL,
  -- 라인별 메모
  note              TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- 분개 일자별 조회 인덱스
CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(entry_date DESC);

-- 원본 거래 기준 조회 인덱스
CREATE INDEX IF NOT EXISTS idx_journal_entries_transaction ON journal_entries(transaction_id);

-- 분개 번호 조회 인덱스
CREATE INDEX IF NOT EXISTS idx_journal_entries_entry_no ON journal_entries(entry_no);

-- 분개 라인의 계정과목 기준 조회 인덱스 (계정별 원장 조회 시 사용)
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_id);

-- 분개 라인의 거래처 기준 조회 인덱스
CREATE INDEX IF NOT EXISTS idx_journal_lines_vendor ON journal_lines(vendor_id);

-- updated_at 자동 갱신 트리거
DROP TRIGGER IF EXISTS trg_journal_entries_updated_at ON journal_entries;
CREATE TRIGGER trg_journal_entries_updated_at
  BEFORE UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
