-- =====================================================
-- 065_dedup_key_with_time.sql
-- 통장 거래 중복 키에 거래 시각 포함 (운영 DB 구버전 트리거 교정).
--
-- 발견 사례(2026-07-14): 우리은행 2025 파일의 성원애드피
-- "결제(17:08:59) → 취소(17:09:03) → 재결제(17:09:22)" 3건 중,
-- 재결제가 최초 결제와 날짜·금액·잔액·적요가 같아 중복으로 오판되어 누락.
-- 운영 DB의 트리거가 시각이 빠진 이전 버전이었다 (저장소 049에는 포함).
--
-- 적용 후 통장 파일을 재업로드하면(멱등) 건너뛰었던 행이 자동 삽입된다.
-- =====================================================

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

-- 기존 행 전체 백필 — BEFORE UPDATE 트리거가 시각 포함 키로 재계산한다.
-- (키가 더 세분화되므로 기존 UNIQUE 인덱스와 충돌하지 않는다)
UPDATE transactions SET dedup_key = NULL;
