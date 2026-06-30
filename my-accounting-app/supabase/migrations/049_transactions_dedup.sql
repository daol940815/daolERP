-- =====================================================
-- 049_transactions_dedup.sql
-- 통장 입출금 거래 행 단위 중복 방지.
--
-- 통장 거래는 고유번호가 없어 파일 단위 중복(파일 해시)만 막혀 있었다.
-- 기간이 겹치거나 재추출(해시 다름)한 파일을 올리면 같은 거래가 중복 등록됐다.
-- → 중복키(dedup_key)를 트리거로 생성하고 UNIQUE 인덱스로 막는다.
--   key = 계좌 + 일자 + 시간 + 입금 + 출금 + 거래후잔액 + 적요
--   (거래후잔액이 거래마다 달라 강력한 식별자)
-- 업로드는 ON CONFLICT DO NOTHING(ignoreDuplicates)로 신규만 삽입한다.
-- =====================================================

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS dedup_key TEXT;

CREATE OR REPLACE FUNCTION set_transaction_dedup_key()
RETURNS TRIGGER AS $$
BEGIN
  NEW.dedup_key :=
    COALESCE(NEW.bank_account_id::text, '') || '|' ||
    COALESCE(NEW.tx_date::text, '')         || '|' ||
    COALESCE(NEW.tx_time::text, '')         || '|' ||
    COALESCE(NEW.amount_in, 0)::text        || '|' ||
    COALESCE(NEW.amount_out, 0)::text       || '|' ||
    COALESCE(NEW.balance::text, '')         || '|' ||
    COALESCE(NEW.description, '');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transaction_dedup_key ON transactions;
CREATE TRIGGER trg_transaction_dedup_key
  BEFORE INSERT OR UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION set_transaction_dedup_key();

-- 기존 행 백필 (트리거가 NEW에서 재계산)
UPDATE transactions SET dedup_key = NULL;

-- 중복 방지 UNIQUE 인덱스
CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_dedup
  ON transactions(dedup_key) WHERE dedup_key IS NOT NULL;
