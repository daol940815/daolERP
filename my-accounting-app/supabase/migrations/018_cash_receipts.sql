-- =====================================================
-- 018_cash_receipts.sql
-- 현금영수증 보관 테이블
-- 홈택스에서 다운로드한 현금영수증 발행(매출)/수취(매입) 내역 저장
-- 부가세 신고 시 매출세액(발행) 및 매입세액 공제(수취·공제분) 집계에 활용
-- =====================================================

CREATE TABLE IF NOT EXISTS cash_receipts (
  id                      UUID         DEFAULT gen_random_uuid() PRIMARY KEY,

  -- ── 방향 ────────────────────────────────────────────
  -- sales: 발행(매출) — 부가세 매출세액 포함
  -- purchase: 수취(매입) — deductible=true 건만 매입세액 공제
  direction               VARCHAR(10)  NOT NULL CHECK (direction IN ('sales', 'purchase')),

  -- ── 원본 거래 정보 ─────────────────────────────────
  tx_date                 DATE         NOT NULL,
  tx_time                 TEXT,
  -- approval(승인거래) / cancel(취소거래)
  transaction_type        VARCHAR(10)  NOT NULL DEFAULT 'approval' CHECK (transaction_type IN ('approval', 'cancel')),
  -- 승인번호 (취소 건은 원거래와 동일)
  approval_number         VARCHAR(50)  NOT NULL,

  -- ── 거래처 정보 (매입·수취 측) ─────────────────────
  counterparty_name       VARCHAR(200),
  counterparty_biz_number VARCHAR(30),

  -- ── 매출·발행 측 추가 정보 ──────────────────────────
  issue_type              VARCHAR(20),   -- 발행구분 (사업자/소비자)
  purpose_type            VARCHAR(50),   -- 용도구분 (소비자소득공제용 / 사업자지출증빙용)

  -- ── 매입·수취 측 추가 정보 ──────────────────────────
  -- 공제여부: true=공제(세액공제 가능), false=불공제(비용처리)
  deductible              BOOLEAN,

  -- ── 금액 (취소 건은 음수) ──────────────────────────
  amount                  BIGINT       DEFAULT 0,
  supply_amount           BIGINT       DEFAULT 0,
  tax_amount              BIGINT       DEFAULT 0,
  service_charge          BIGINT       DEFAULT 0,

  -- ── 거래처 매칭 (매입 측: 가맹점사업자번호 기준) ────
  vendor_id               UUID REFERENCES vendors(id) ON DELETE SET NULL,

  note                    TEXT,
  created_at              TIMESTAMPTZ  DEFAULT now(),
  updated_at              TIMESTAMPTZ  DEFAULT now(),

  -- 동일 승인번호에 승인/취소가 쌍으로 존재하며, 매출/매입이 같은 번호를 가질 수도 있으므로 direction 포함
  UNIQUE (approval_number, transaction_type, direction)
);

CREATE INDEX IF NOT EXISTS idx_cash_receipts_tx_date    ON cash_receipts(tx_date DESC);
CREATE INDEX IF NOT EXISTS idx_cash_receipts_direction  ON cash_receipts(direction);
CREATE INDEX IF NOT EXISTS idx_cash_receipts_vendor     ON cash_receipts(vendor_id);
CREATE INDEX IF NOT EXISTS idx_cash_receipts_biz_number ON cash_receipts(counterparty_biz_number);

DROP TRIGGER IF EXISTS trg_cash_receipts_updated_at ON cash_receipts;
CREATE TRIGGER trg_cash_receipts_updated_at
  BEFORE UPDATE ON cash_receipts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
