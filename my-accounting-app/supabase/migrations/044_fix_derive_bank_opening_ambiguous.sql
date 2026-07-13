-- =====================================================
-- 044_fix_derive_bank_opening_ambiguous.sql
-- 043의 derive_bank_opening_balances 수정.
-- RETURNS TABLE의 OUT 파라미터 account_id가 ON CONFLICT (account_id)의
-- 컬럼 참조와 충돌하여 "column reference account_id is ambiguous" 발생.
-- OUT 파라미터명을 out_* 로 변경해 모호성을 제거한다.
-- =====================================================

DROP FUNCTION IF EXISTS derive_bank_opening_balances();

CREATE OR REPLACE FUNCTION derive_bank_opening_balances()
RETURNS TABLE (out_account_id uuid, out_code varchar, out_name varchar, out_amount bigint)
LANGUAGE plpgsql AS $$
BEGIN
  CREATE TEMP TABLE _bank_open ON COMMIT DROP AS
  WITH first_tx AS (
    SELECT DISTINCT ON (t.bank_account_id)
           t.bank_account_id,
           COALESCE(t.balance, 0)
             - (COALESCE(t.amount_in, 0) - COALESCE(t.amount_out, 0)) AS opening_cash
    FROM transactions t
    WHERE t.bank_account_id IS NOT NULL
    ORDER BY t.bank_account_id, t.tx_date, t.tx_time NULLS FIRST, t.created_at
  )
  SELECT ba.gl_account_id AS acc_id,
         a.type           AS acc_type,
         SUM(ft.opening_cash) AS cash_sum
  FROM first_tx ft
  JOIN bank_accounts ba ON ba.id = ft.bank_account_id
  JOIN accounts a       ON a.id = ba.gl_account_id
  WHERE ba.gl_account_id IS NOT NULL
  GROUP BY ba.gl_account_id, a.type;

  INSERT INTO account_opening_balances (account_id, amount, source, note)
  SELECT bo.acc_id,
         CASE WHEN bo.acc_type IN ('asset', 'expense') THEN bo.cash_sum ELSE -bo.cash_sum END,
         'auto_bank',
         '은행 거래후잔액 역산 (자동)'
  FROM _bank_open bo
  ON CONFLICT (account_id) DO UPDATE
    SET amount = EXCLUDED.amount,
        source = 'auto_bank',
        note   = EXCLUDED.note,
        updated_at = now();

  RETURN QUERY
  SELECT a.id, a.code, a.name, o.amount
  FROM account_opening_balances o
  JOIN accounts a ON a.id = o.account_id
  WHERE o.source = 'auto_bank'
  ORDER BY a.code;
END;
$$;
