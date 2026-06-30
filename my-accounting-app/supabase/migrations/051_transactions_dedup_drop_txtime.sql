-- =====================================================
-- 051_transactions_dedup_drop_txtime.sql
-- 통장 거래 중복키(dedup_key)에서 tx_time 제거 + 기존 중복 정리.
--
-- 문제: dedup_key 에 tx_time 이 포함돼 있었다. 그런데 같은 거래라도
--   은행 export 포맷에 따라 거래시간이 있기도(09:43:41) 없기도(NULL) 하다.
--   → 동일 거래의 키가 달라져 중복 등록을 막지 못했다.
--   (실측: 하나은행 134건이 tx_time 만 다른 채로 중복 등록됨)
--
-- 해결:
--   1) 기존 중복 정리 — (계좌+일자+입금+출금+잔액+적요) 가 같은 행 중
--      분류가 더 진행된(확정>검토>제안有>pending) · 더 먼저 등록된 1건만 남기고 삭제.
--      잔액(balance)이 NULL 인 행은 안전을 위해 자동 삭제 대상에서 제외.
--   2) dedup_key 재정의 — tx_time 제외.
--      key = 계좌 + 일자 + 입금 + 출금 + 거래후잔액 + 적요
--      (거래후잔액은 거래마다 달라 가장 강력한 식별자)
--   3) UNIQUE 인덱스 재생성(non-partial, 050과 동일 형태).
-- =====================================================

-- ── 1) 기존 중복 정리 ────────────────────────────────────────
-- 보존 우선순위: 확정 > 검토 > (제안계정 있음) > 먼저 등록(created_at) > id
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY bank_account_id, tx_date, amount_in, amount_out, balance, description
      ORDER BY
        CASE status WHEN 'confirmed' THEN 0 WHEN 'reviewed' THEN 1 ELSE 2 END,
        (suggested_account_id IS NULL),   -- 제안 있는 행(false=0) 우선 보존
        created_at ASC NULLS LAST,
        id ASC
    ) AS rn
  FROM transactions
  WHERE balance IS NOT NULL              -- 잔액 없는 행은 자동 삭제 제외
)
DELETE FROM transactions t
USING ranked r
WHERE t.id = r.id AND r.rn > 1;

-- ── 2) dedup_key 재정의 (tx_time 제외) ───────────────────────
CREATE OR REPLACE FUNCTION set_transaction_dedup_key()
RETURNS TRIGGER AS $$
BEGIN
  NEW.dedup_key :=
    COALESCE(NEW.bank_account_id::text, '') || '|' ||
    COALESCE(NEW.tx_date::text, '')         || '|' ||
    COALESCE(NEW.amount_in, 0)::text        || '|' ||
    COALESCE(NEW.amount_out, 0)::text       || '|' ||
    COALESCE(NEW.balance::text, '')         || '|' ||
    COALESCE(NEW.description, '');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 트리거는 049에서 생성됨(BEFORE INSERT OR UPDATE). 함수만 교체하면 적용된다.

-- ── 3) 전체 재계산 + UNIQUE 인덱스 재생성 ────────────────────
DROP INDEX IF EXISTS uq_transactions_dedup;

UPDATE transactions SET dedup_key = NULL;   -- 트리거가 새 규칙으로 재계산

CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_dedup
  ON transactions(dedup_key);
