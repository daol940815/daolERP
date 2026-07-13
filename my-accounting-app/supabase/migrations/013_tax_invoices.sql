-- =====================================================
-- 013_tax_invoices.sql
-- 세금계산서 / 계산서(전자) 보관 테이블
-- 홈택스에서 내려받은 매출·매입 전자(세금)계산서 목록을 저장하고
-- 거래처(vendors) 및 입출금 거래(transactions)와 매칭하여
-- 줄 돈을 줬는지 / 받을 돈을 받았는지 확인하는 용도
-- =====================================================

CREATE TABLE IF NOT EXISTS tax_invoices (
  id                      UUID         DEFAULT gen_random_uuid() PRIMARY KEY,

  -- ── 원본 인보이스 정보 ──────────────────────────────
  -- 승인번호 (홈택스 고유 식별자, 중복 업로드 방지)
  approval_number         VARCHAR(50)  NOT NULL UNIQUE,
  -- 작성일자
  issue_date              DATE         NOT NULL,
  -- 매출(sales, 우리가 발행 = 받을 돈) / 매입(purchase, 우리가 수취 = 줄 돈)
  direction               VARCHAR(10)  NOT NULL CHECK (direction IN ('sales', 'purchase')),
  -- 과세(taxable, 전자세금계산서) / 면세(exempt, 전자계산서)
  tax_type                VARCHAR(10)  NOT NULL DEFAULT 'taxable' CHECK (tax_type IN ('taxable', 'exempt')),

  -- ── 거래상대방 ─────────────────────────────────────
  -- 매칭된 거래처 (사업자번호 또는 상호 기준 자동 연결, 수동 변경 가능)
  vendor_id               UUID REFERENCES vendors(id) ON DELETE SET NULL,
  -- 원본 상호 / 사업자등록번호 (거래처 매칭 실패 시에도 원본 보존)
  counterparty_name       VARCHAR(200),
  counterparty_biz_number VARCHAR(20),

  -- ── 금액 ──────────────────────────────────────────
  supply_amount           BIGINT       DEFAULT 0,
  tax_amount              BIGINT       DEFAULT 0,
  total_amount            BIGINT       DEFAULT 0,

  -- ── 기타 원본 정보 ─────────────────────────────────
  item_name               VARCHAR(300),
  note                    TEXT,

  -- ── 입출금 매칭 / 결제 확인 ────────────────────────
  -- 매칭된 거래내역 (transactions.id) - 자동 매칭 또는 수동 연결
  matched_transaction_id  UUID REFERENCES transactions(id) ON DELETE SET NULL,
  -- 결제(입금/출금) 확인 상태: unmatched(미확인) / matched(확인됨) - 수동 변경 가능
  payment_status          VARCHAR(20)  NOT NULL DEFAULT 'unmatched' CHECK (payment_status IN ('matched', 'unmatched')),
  -- 확인 관련 메모 (수동 확인 사유 등)
  payment_memo            TEXT,

  created_at              TIMESTAMPTZ  DEFAULT now(),
  updated_at              TIMESTAMPTZ  DEFAULT now()
);

-- 작성일자 기준 조회 (기간 조회 빈번)
CREATE INDEX IF NOT EXISTS idx_tax_invoices_issue_date ON tax_invoices(issue_date DESC);

-- 매출/매입 + 과세/면세 구분별 목록 조회
CREATE INDEX IF NOT EXISTS idx_tax_invoices_direction_tax_type ON tax_invoices(direction, tax_type);

-- 거래처별 세금계산서 집계
CREATE INDEX IF NOT EXISTS idx_tax_invoices_vendor ON tax_invoices(vendor_id);

-- 결제 확인 상태별 조회 (미확인 건만 보기 등)
CREATE INDEX IF NOT EXISTS idx_tax_invoices_payment_status ON tax_invoices(payment_status);

-- 매칭된 거래내역 역참조
CREATE INDEX IF NOT EXISTS idx_tax_invoices_matched_transaction ON tax_invoices(matched_transaction_id);

-- updated_at 자동 갱신 트리거
DROP TRIGGER IF EXISTS trg_tax_invoices_updated_at ON tax_invoices;
CREATE TRIGGER trg_tax_invoices_updated_at
  BEFORE UPDATE ON tax_invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
