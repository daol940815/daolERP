-- ================================================================
-- 015_transaction_counterparty.sql
-- 거래내역에 보낸분/받는분(입금자명·수취인명) 컬럼 추가
-- 적요(description)와 별도로 저장해, 거래처 매칭 정확도를 높이는 데 활용한다.
-- ================================================================

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS counterparty_name TEXT;

COMMENT ON COLUMN transactions.counterparty_name IS
  '명세서의 보낸분/받는분(입금자명·수취인명) 원본 값 — 적요와 분리 저장하여 거래처 매칭에 활용.';
