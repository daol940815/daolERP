-- =====================================================
-- 106_vat_manual_entries.sql
-- 예상 부가세 신고기간별 수동 입력 항목
--
-- 자동 집계가 불가능하거나 데이터 원천이 아직 없는 서식 항목을
-- 신고기간(period_key) x 항목(item_key) 단위로 저장한다.
--   현금 매출(cash_sales)          — 현금영수증 미발행 현금매출 (원천 생기면 자동 전환 예정)
--   영세율 세금계산서/기타(zero_*)  — 기본 0, 발생 시 기입
--   대손세액 가감(bad_debt)        — 음수 가능
--   경감공제(reduce_other, card_issue) / 예정신고미환급(prepaid_refund)
--   예정고지(prepaid_notice) / 가산세(penalty)
-- 원본 데이터는 손대지 않고, 신고서 보조 항목만 별도 보관한다.
-- =====================================================

CREATE TABLE IF NOT EXISTS vat_manual_entries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_key    TEXT NOT NULL,          -- 예: '2026-1-6' (연도-시작월-끝월)
  item_key      TEXT NOT NULL CHECK (item_key IN (
    'cash_sales','zero_invoice','zero_other','bad_debt',
    'reduce_other','card_issue','prepaid_refund','prepaid_notice','penalty'
  )),
  supply_amount BIGINT NOT NULL DEFAULT 0,
  tax_amount    BIGINT NOT NULL DEFAULT 0,
  memo          TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (period_key, item_key)
);

ALTER TABLE vat_manual_entries ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE vat_manual_entries IS
  '부가세 신고기간별 수동 입력(현금매출·영세율·대손·경감공제·예정고지 등). 원천 데이터 생기면 항목별 자동 전환.';
