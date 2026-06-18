-- =====================================================
-- 032_transactions_tx_time.sql
-- 거래 시각(시:분:초) 보관 — 같은 날짜 내 여러 거래의 정렬 순서를
-- 원본 파일의 실제 거래 순서와 일치시키기 위함 (card_sales.tx_time과 동일한 패턴)
-- =====================================================

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS tx_time TEXT;

-- 거래일자 + 거래시각 정렬 조회 최적화
CREATE INDEX IF NOT EXISTS idx_transactions_tx_date_time ON transactions(tx_date DESC, tx_time DESC);
