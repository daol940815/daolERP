-- =====================================================
-- 003_transactions.sql
-- 거래 원본(Transaction) 테이블 - 핵심 테이블
-- 은행 명세서, 카드 내역 등 원본 거래 데이터를 저장
-- AI 자동 분류 및 사람 검토 결과를 함께 기록
-- =====================================================

CREATE TABLE IF NOT EXISTS transactions (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,

  -- ── 원본 거래 정보 ──────────────────────────────────
  -- 거래 발생 일시
  tx_date         DATE        NOT NULL,
  -- 거래 설명 (은행/카드사에서 제공하는 원문)
  description     TEXT        NOT NULL,
  -- 입금액 (원화 기준, 없으면 0)
  amount_in       BIGINT      DEFAULT 0,
  -- 출금액 (원화 기준, 없으면 0)
  amount_out      BIGINT      DEFAULT 0,
  -- 잔액 (은행 명세서 기준)
  balance         BIGINT,
  -- 데이터 출처: bank(은행), card(카드), manual(수동입력)
  source          VARCHAR(20) DEFAULT 'bank' CHECK (source IN ('bank', 'card', 'manual')),
  -- 어느 계좌/카드에서 가져온 데이터인지 (예: "신한은행 001-123456")
  account_alias   VARCHAR(100),

  -- ── AI 자동 분류 결과 ───────────────────────────────
  -- AI가 추천한 계정과목 ID (accounts 테이블 참조)
  suggested_account_id  UUID REFERENCES accounts(id) ON DELETE SET NULL,
  -- AI 분류 신뢰도 (0.0 ~ 1.0, 높을수록 신뢰)
  ai_confidence         NUMERIC(4,3),
  -- AI 분류 근거 (어떤 키워드로 매칭했는지 등)
  ai_reason             TEXT,

  -- ── 사람 검토 결과 ─────────────────────────────────
  -- 최종 확정된 계정과목 ID (사람이 직접 선택하거나 AI 추천을 수락)
  confirmed_account_id  UUID REFERENCES accounts(id) ON DELETE SET NULL,
  -- 연결된 거래처 ID
  vendor_id             UUID REFERENCES vendors(id) ON DELETE SET NULL,
  -- 검토 상태: pending(미검토), reviewed(검토완료), confirmed(확정)
  status                VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'confirmed')),
  -- 검토자 메모
  memo                  TEXT,
  -- 분개 생성 여부
  is_journalized        BOOLEAN DEFAULT false,

  -- ── 업로드 추적 ────────────────────────────────────
  -- 이 거래가 포함된 업로드 이력 ID (upload_logs 테이블 참조)
  upload_log_id         UUID,

  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- 날짜 기준 조회를 위한 인덱스 (기간 조회 빈번)
CREATE INDEX IF NOT EXISTS idx_transactions_tx_date ON transactions(tx_date DESC);

-- 상태별 조회를 위한 인덱스 (미검토 건만 보기 등)
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);

-- 계정과목별 집계를 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_transactions_confirmed_account ON transactions(confirmed_account_id);

-- 거래처별 조회를 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_transactions_vendor ON transactions(vendor_id);

-- 업로드 이력별 조회를 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_transactions_upload_log ON transactions(upload_log_id);

-- 출처별 조회를 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_transactions_source ON transactions(source);

-- updated_at 자동 갱신 트리거
DROP TRIGGER IF EXISTS trg_transactions_updated_at ON transactions;
CREATE TRIGGER trg_transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
