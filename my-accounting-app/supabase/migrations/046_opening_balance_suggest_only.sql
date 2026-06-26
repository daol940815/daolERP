-- =====================================================
-- 046_opening_balance_suggest_only.sql
-- 은행 기초잔액 "자동확정" → "읽기전용 추정값 제안"으로 강등.
--
-- (배경) 거래에 순서 정보(tx_time 전부 NULL)가 없고 created_at이 실제 거래순서와
-- 불일치하여, balance 역산 기초잔액이 부정확/비결정적이었다(보통예금 3.9M↔1.06M, 실제 ~0).
-- → 수기 확정 중심으로 전환한다. 자동값은 참고용 추정치로만 제공하고, 직접 저장하지 않는다.
--
--  1) 기존 자동(auto_bank) 행 제거 — 허위 노이즈 정리. 보통예금 등은 기본 0으로 복귀.
--  2) derive_*(쓰기) 제거, suggest_*(읽기전용) 신설.
-- =====================================================

DELETE FROM account_opening_balances WHERE source = 'auto_bank';

DROP FUNCTION IF EXISTS derive_bank_opening_balances();

-- 읽기전용 추정값: 현재(최종) 거래후잔액 - 총net (계정 정상방향). 저장하지 않는다.
CREATE OR REPLACE FUNCTION suggest_bank_opening_balances()
RETURNS TABLE (account_id uuid, code varchar, name varchar, suggested bigint)
LANGUAGE sql STABLE AS $$
  WITH last_tx AS (
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
  per_gl AS (
    SELECT ba.gl_account_id AS acc_id,
           a.type           AS acc_type,
           SUM(lt.final_balance - COALESCE(n.total_net, 0)) AS cash_sum
    FROM last_tx lt
    JOIN bank_accounts ba ON ba.id = lt.bank_account_id
    JOIN accounts a       ON a.id = ba.gl_account_id
    LEFT JOIN net n       ON n.bank_account_id = lt.bank_account_id
    WHERE ba.gl_account_id IS NOT NULL
    GROUP BY ba.gl_account_id, a.type
  )
  SELECT pg.acc_id, a.code, a.name,
         (CASE WHEN pg.acc_type IN ('asset', 'expense') THEN pg.cash_sum ELSE -pg.cash_sum END)::bigint
  FROM per_gl pg
  JOIN accounts a ON a.id = pg.acc_id
  ORDER BY a.code;
$$;
