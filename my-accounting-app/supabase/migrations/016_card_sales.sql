-- =====================================================
-- 016_card_sales.sql
-- 카드결제내역(매출) 보관 테이블
-- PG/카드사에서 내려받은 카드 매출 거래 내역을 저장하고
-- 거래처(카드번호 기준)와 매칭하여 정산/입금 현황을 확인하는 용도
-- =====================================================

CREATE TABLE IF NOT EXISTS card_sales (
  id                      UUID         DEFAULT gen_random_uuid() PRIMARY KEY,

  -- ── 원본 거래 정보 ──────────────────────────────────
  tx_date                 DATE         NOT NULL,
  tx_time                 TEXT,
  -- 승인(approval, 정상 매출) / 취소(cancel, 매출 취소 — 동일 승인번호로 짝을 이룸)
  transaction_type        VARCHAR(10)  NOT NULL DEFAULT 'approval' CHECK (transaction_type IN ('approval', 'cancel')),
  -- 승인번호 (취소 건은 원거래와 동일한 승인번호를 가지므로 단독 UNIQUE 불가 — transaction_type과 조합)
  approval_number         VARCHAR(50)  NOT NULL,
  -- 마스킹된 카드번호 (예: 4025-96**-****-0302) — 거래처 식별의 핵심 단서
  card_number             VARCHAR(30),
  -- 매입사 (카드사/PG사)
  acquirer                VARCHAR(50),

  -- ── 금액 ──────────────────────────────────────────
  -- 결제금액 (취소 건은 음수)
  amount                  BIGINT       DEFAULT 0,
  supply_amount           BIGINT       DEFAULT 0,
  tax_amount              BIGINT       DEFAULT 0,

  -- ── 정산/입금 현황 (원본 그대로 보존 — PG사가 제공하는 확인 정보) ──
  processing_status       VARCHAR(30),
  deposit_expected_date   DATE,
  cancelled_at            TEXT,
  settlement_status       VARCHAR(30),

  -- ── 거래처 매칭 ────────────────────────────────────
  -- 카드번호 기준 자동 연결 (vendors.card_numbers), 수동 변경 가능
  vendor_id               UUID REFERENCES vendors(id) ON DELETE SET NULL,

  note                    TEXT,

  created_at              TIMESTAMPTZ  DEFAULT now(),
  updated_at              TIMESTAMPTZ  DEFAULT now(),

  -- 승인 건과 취소 건이 동일한 승인번호를 공유하므로 조합으로 중복 업로드 방지
  UNIQUE (approval_number, transaction_type)
);

-- 거래일자 기준 조회 (기간 조회 빈번)
CREATE INDEX IF NOT EXISTS idx_card_sales_tx_date ON card_sales(tx_date DESC);

-- 거래처별 카드 매출 집계
CREATE INDEX IF NOT EXISTS idx_card_sales_vendor ON card_sales(vendor_id);

-- 카드번호 기준 거래처 매칭 조회
CREATE INDEX IF NOT EXISTS idx_card_sales_card_number ON card_sales(card_number);

-- updated_at 자동 갱신 트리거
DROP TRIGGER IF EXISTS trg_card_sales_updated_at ON card_sales;
CREATE TRIGGER trg_card_sales_updated_at
  BEFORE UPDATE ON card_sales
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
