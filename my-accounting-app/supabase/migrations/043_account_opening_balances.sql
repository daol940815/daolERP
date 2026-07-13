-- =====================================================
-- 043_account_opening_balances.sql
-- 계정별 기초잔액(전기이월) — 시스템 도입 이전부터 넘어온 잔액
--
-- 대상: 잔액이 이월되는 영구계정(자산·부채·자본). 손익(수익·비용)은 제외.
-- amount는 "계정 정상방향(=원장 표시방향)" 부호로 저장한다:
--   자산·비용(차변정상): 양수 = 차변잔액
--   부채·자본·수익(대변정상): 양수 = 대변잔액
-- account_ledger가 이 값을 전월이월 시작점으로 그대로 더한다.
--
-- source: 'auto_bank'(은행 balance 역산) | 'manual'(수기)
-- =====================================================

CREATE TABLE IF NOT EXISTS account_opening_balances (
  account_id  UUID        PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  as_of_date  DATE        NOT NULL DEFAULT '2026-01-01',
  amount      BIGINT      NOT NULL DEFAULT 0,   -- 계정 정상방향 부호
  source      VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (source IN ('auto_bank', 'manual')),
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_aob_updated_at ON account_opening_balances;
CREATE TRIGGER trg_aob_updated_at
  BEFORE UPDATE ON account_opening_balances
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 은행 기초잔액 자동 도출 ─────────────────────────────────────────
-- 각 은행계좌의 "최초 거래 직전 잔액" = 최초거래 거래후잔액 - (입금-출금).
-- 이를 매핑된 GL 계정(gl_account_id)별로 합산하고, 계정 정상방향 부호로 저장한다.
--   현금성 cash 포지션 B(차변정상) → 자산이면 +B, 부채(마통)면 -B(=갚을 차입).
-- 멱등: source='auto_bank' 행을 재계산하여 upsert.
CREATE OR REPLACE FUNCTION derive_bank_opening_balances()
RETURNS TABLE (account_id uuid, code varchar, name varchar, amount bigint)
LANGUAGE plpgsql AS $$
BEGIN
  -- 통장별 최초거래 직전 잔액 B
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

  -- 계정 정상방향 부호로 변환하여 upsert
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

-- ── account_ledger: 기초잔액(전기이월) 반영하도록 갱신 ──────────────
CREATE OR REPLACE FUNCTION account_ledger(
  p_account_id uuid,
  p_from       date,
  p_to         date
) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_type         text;
  v_account      jsonb;
  v_sign         int;
  v_base         numeric;   -- 기초잔액(도입 t0, 계정 정상방향)
  v_opening      numeric;
  v_rows         jsonb;
  v_total_debit  numeric;
  v_total_credit numeric;
BEGIN
  SELECT a.type,
         jsonb_build_object('id', a.id, 'code', a.code, 'name', a.name, 'type', a.type)
    INTO v_type, v_account
  FROM accounts a WHERE a.id = p_account_id;

  IF v_type IS NULL THEN
    RETURN jsonb_build_object('error', '계정을 찾을 수 없습니다.');
  END IF;

  v_sign := CASE WHEN v_type IN ('asset', 'expense') THEN 1 ELSE -1 END;

  -- 기초잔액(없으면 0)
  SELECT COALESCE((SELECT amount FROM account_opening_balances WHERE account_id = p_account_id), 0)
    INTO v_base;

  -- 전월이월 = 기초잔액 + p_from 이전 분개 누적
  SELECT v_base + COALESCE(SUM(v_sign * (CASE WHEN jl.side = 'debit' THEN jl.amount ELSE -jl.amount END)), 0)
    INTO v_opening
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  WHERE jl.account_id = p_account_id
    AND je.entry_date < p_from;

  WITH base AS (
    SELECT jl.id, je.id AS entry_id, je.entry_date, je.entry_no, je.description,
           jl.side, jl.amount, jl.note, jl.vendor_id,
           CASE WHEN jl.side = 'debit'  THEN jl.amount ELSE 0 END AS debit,
           CASE WHEN jl.side = 'credit' THEN jl.amount ELSE 0 END AS credit,
           v_sign * (CASE WHEN jl.side = 'debit' THEN jl.amount ELSE -jl.amount END) AS delta
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE jl.account_id = p_account_id
      AND je.entry_date >= p_from
      AND je.entry_date <= p_to
  ),
  enriched AS (
    SELECT b.*,
           v.name AS vendor_name,
           (SELECT string_agg(DISTINCT a2.name, ', ')
              FROM journal_lines jl2
              JOIN accounts a2 ON a2.id = jl2.account_id
             WHERE jl2.journal_entry_id = b.entry_id
               AND jl2.side <> b.side) AS counterpart,
           v_opening + SUM(b.delta) OVER (
             ORDER BY b.entry_date, b.entry_no, b.id
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
           ) AS balance
    FROM base b
    LEFT JOIN vendors v ON v.id = b.vendor_id
  )
  SELECT jsonb_agg(jsonb_build_object(
           'entry_date',  entry_date,
           'entry_no',    entry_no,
           'description', description,
           'counterpart', counterpart,
           'vendor',      vendor_name,
           'debit',       debit,
           'credit',      credit,
           'balance',     balance,
           'note',        note
         ) ORDER BY entry_date, entry_no, id),
         COALESCE(SUM(debit), 0),
         COALESCE(SUM(credit), 0)
    INTO v_rows, v_total_debit, v_total_credit
  FROM enriched;

  RETURN jsonb_build_object(
    'account',      v_account,
    'opening',      v_opening,
    'rows',         COALESCE(v_rows, '[]'::jsonb),
    'total_debit',  v_total_debit,
    'total_credit', v_total_credit,
    'closing',      v_opening + v_sign * (v_total_debit - v_total_credit)
  );
END;
$$;
