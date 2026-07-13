-- =====================================================
-- 045_fix_derive_bank_opening_robust.sql
-- derive_bank_opening_balances 계산식 교정.
--
-- (문제) 043/044는 "최초거래 직전 잔액 = 첫 행 balance - 첫 행 net"으로 계산했으나,
-- 동일자 다건·tx_time NULL 때문에 "첫 행"이 진짜 최초 거래가 아니어서 값이 틀렸다.
-- (예: 보통예금 합계가 실제 ~0인데 3,969,000으로 잘못 도출)
--
-- (교정) running balance 항등식: B0 = Bn - 총net.
--   기초잔액(opening_cash) = 현재(최종) 거래후잔액 - SUM(입금 - 출금)
--   · 총net은 정렬과 무관(합계)이라 안정적이고, 최종잔액은 "현재 통장잔액"이라 가장 신뢰도가 높다.
--   · 자산이면 +cash, 부채(마통)면 -cash(=갚을 차입)로 정상방향 부호 변환.
-- =====================================================

DROP FUNCTION IF EXISTS derive_bank_opening_balances();

CREATE OR REPLACE FUNCTION derive_bank_opening_balances()
RETURNS TABLE (out_account_id uuid, out_code varchar, out_name varchar, out_amount bigint)
LANGUAGE plpgsql AS $$
BEGIN
  CREATE TEMP TABLE _bank_open ON COMMIT DROP AS
  WITH last_tx AS (
    -- 통장별 최종(현재) 거래후잔액
    SELECT DISTINCT ON (t.bank_account_id)
           t.bank_account_id,
           COALESCE(t.balance, 0) AS final_balance
    FROM transactions t
    WHERE t.bank_account_id IS NOT NULL
    ORDER BY t.bank_account_id, t.tx_date DESC, t.tx_time DESC NULLS LAST, t.created_at DESC
  ),
  net AS (
    SELECT t.bank_account_id,
           SUM(COALESCE(t.amount_in, 0) - COALESCE(t.amount_out, 0)) AS total_net
    FROM transactions t
    WHERE t.bank_account_id IS NOT NULL
    GROUP BY t.bank_account_id
  ),
  per_bank AS (
    SELECT lt.bank_account_id,
           lt.final_balance - COALESCE(n.total_net, 0) AS opening_cash
    FROM last_tx lt
    LEFT JOIN net n ON n.bank_account_id = lt.bank_account_id
  )
  SELECT ba.gl_account_id AS acc_id,
         a.type           AS acc_type,
         SUM(pb.opening_cash) AS cash_sum
  FROM per_bank pb
  JOIN bank_accounts ba ON ba.id = pb.bank_account_id
  JOIN accounts a       ON a.id = ba.gl_account_id
  WHERE ba.gl_account_id IS NOT NULL
  GROUP BY ba.gl_account_id, a.type;

  INSERT INTO account_opening_balances (account_id, amount, source, note)
  SELECT bo.acc_id,
         CASE WHEN bo.acc_type IN ('asset', 'expense') THEN bo.cash_sum ELSE -bo.cash_sum END,
         'auto_bank',
         '은행 거래후잔액 역산 (현재잔액 - 총net, 자동)'
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
