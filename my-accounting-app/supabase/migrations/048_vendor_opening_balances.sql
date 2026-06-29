-- =====================================================
-- 048_vendor_opening_balances.sql
-- 거래처별 기초잔액(전기이월) — 도입 이전 미수금/미지급금.
--
-- amount 부호 = 거래처원장 규약(차변-대변): 양수=미수(채권), 음수=미지급(채무).
-- vendor_ledger_balances / vendor_ledger_detail 의 전월이월 시작점이 된다.
-- =====================================================

CREATE TABLE IF NOT EXISTS vendor_opening_balances (
  vendor_id   UUID        PRIMARY KEY REFERENCES vendors(id) ON DELETE CASCADE,
  as_of_date  DATE        NOT NULL DEFAULT '2026-01-01',
  amount      BIGINT      NOT NULL DEFAULT 0,   -- 양수=미수, 음수=미지급
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_vob_updated_at ON vendor_opening_balances;
CREATE TRIGGER trg_vob_updated_at
  BEFORE UPDATE ON vendor_opening_balances
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 거래처별 원장: 잔액 탭 (기초잔액 반영) ──────────────────────────
CREATE OR REPLACE FUNCTION vendor_ledger_balances(
  p_from date,
  p_to   date
) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH j AS (
    SELECT jl.vendor_id,
           SUM(CASE WHEN je.entry_date <  p_from
                    THEN (CASE WHEN jl.side = 'debit' THEN jl.amount ELSE -jl.amount END)
                    ELSE 0 END) AS j_before,
           SUM(CASE WHEN je.entry_date BETWEEN p_from AND p_to AND jl.side = 'debit'
                    THEN jl.amount ELSE 0 END) AS period_debit,
           SUM(CASE WHEN je.entry_date BETWEEN p_from AND p_to AND jl.side = 'credit'
                    THEN jl.amount ELSE 0 END) AS period_credit,
           COUNT(*) FILTER (WHERE je.entry_date BETWEEN p_from AND p_to) AS period_count
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE jl.vendor_id IS NOT NULL
      AND je.entry_date <= p_to
    GROUP BY jl.vendor_id
  ),
  -- 분개가 있는 거래처 ∪ 기초잔액이 있는 거래처
  ids AS (
    SELECT vendor_id FROM j
    UNION
    SELECT vendor_id FROM vendor_opening_balances WHERE amount <> 0
  ),
  agg AS (
    SELECT i.vendor_id,
           COALESCE(o.amount, 0)               AS base_open,
           COALESCE(j.j_before, 0)             AS j_before,
           COALESCE(j.period_debit, 0)         AS period_debit,
           COALESCE(j.period_credit, 0)        AS period_credit,
           COALESCE(j.period_count, 0)         AS period_count
    FROM ids i
    LEFT JOIN j ON j.vendor_id = i.vendor_id
    LEFT JOIN vendor_opening_balances o ON o.vendor_id = i.vendor_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'vendor_id',     a.vendor_id,
           'vendor_name',   v.name,
           'opening',       a.base_open + a.j_before,
           'period_debit',  a.period_debit,
           'period_credit', a.period_credit,
           'closing',       a.base_open + a.j_before + a.period_debit - a.period_credit,
           'period_count',  a.period_count
         ) ORDER BY v.name), '[]'::jsonb)
  FROM agg a
  JOIN vendors v ON v.id = a.vendor_id
  WHERE a.base_open <> 0 OR a.j_before <> 0 OR a.period_count > 0;
$$;

-- ── 거래처별 원장: 내용 탭 (기초잔액 반영) ──────────────────────────
CREATE OR REPLACE FUNCTION vendor_ledger_detail(
  p_vendor_id uuid,
  p_from      date,
  p_to        date
) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_vendor       jsonb;
  v_base         numeric;
  v_opening      numeric;
  v_rows         jsonb;
  v_total_debit  numeric;
  v_total_credit numeric;
BEGIN
  SELECT jsonb_build_object('id', v.id, 'name', v.name) INTO v_vendor
  FROM vendors v WHERE v.id = p_vendor_id;
  IF v_vendor IS NULL THEN
    RETURN jsonb_build_object('error', '거래처를 찾을 수 없습니다.');
  END IF;

  SELECT COALESCE((SELECT amount FROM vendor_opening_balances WHERE vendor_id = p_vendor_id), 0)
    INTO v_base;

  SELECT v_base + COALESCE(SUM(CASE WHEN jl.side = 'debit' THEN jl.amount ELSE -jl.amount END), 0)
    INTO v_opening
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  WHERE jl.vendor_id = p_vendor_id
    AND je.entry_date < p_from;

  WITH base AS (
    SELECT jl.id, je.entry_date, je.entry_no, je.description, jl.account_id, jl.note,
           CASE WHEN jl.side = 'debit'  THEN jl.amount ELSE 0 END AS debit,
           CASE WHEN jl.side = 'credit' THEN jl.amount ELSE 0 END AS credit,
           (CASE WHEN jl.side = 'debit' THEN jl.amount ELSE -jl.amount END) AS delta
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE jl.vendor_id = p_vendor_id
      AND je.entry_date >= p_from
      AND je.entry_date <= p_to
  ),
  enriched AS (
    SELECT b.*, a.code AS account_code, a.name AS account_name,
           v_opening + SUM(b.delta) OVER (
             ORDER BY b.entry_date, b.entry_no, b.id
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
           ) AS balance
    FROM base b
    LEFT JOIN accounts a ON a.id = b.account_id
  )
  SELECT jsonb_agg(jsonb_build_object(
           'entry_date', entry_date, 'entry_no', entry_no, 'description', description,
           'account_code', account_code, 'account_name', account_name,
           'debit', debit, 'credit', credit, 'balance', balance, 'note', note
         ) ORDER BY entry_date, entry_no, id),
         COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO v_rows, v_total_debit, v_total_credit
  FROM enriched;

  RETURN jsonb_build_object(
    'vendor',       v_vendor,
    'opening',      v_opening,
    'rows',         COALESCE(v_rows, '[]'::jsonb),
    'total_debit',  v_total_debit,
    'total_credit', v_total_credit,
    'closing',      v_opening + (v_total_debit - v_total_credit)
  );
END;
$$;
