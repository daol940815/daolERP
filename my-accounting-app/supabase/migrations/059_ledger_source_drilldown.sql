-- =====================================================
-- 059_ledger_source_drilldown.sql
-- 추적성(Drill-down) — 회계정책 §6.
--
-- 계정별 원장 행에 분개의 원천(source_type/source_id)을 포함시켜
-- 손익 → 원장 → 분개 → 원본 레코드로 내려갈 수 있게 한다.
-- account_ledger 함수를 동일 시그니처로 재생성 (rows에 source 필드 추가).
-- =====================================================

CREATE OR REPLACE FUNCTION account_ledger(
  p_account_id uuid,
  p_from       date,
  p_to         date
) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_type         text;
  v_account      jsonb;
  v_sign         int;       -- 차변정상 +1, 대변정상 -1
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

  SELECT COALESCE(SUM(v_sign * (CASE WHEN jl.side = 'debit' THEN jl.amount ELSE -jl.amount END)), 0)
    INTO v_opening
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  WHERE jl.account_id = p_account_id
    AND je.entry_date < p_from;

  WITH base AS (
    SELECT jl.id, je.id AS entry_id, je.entry_date, je.entry_no, je.description,
           je.source_type, je.source_id,
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
           'note',        note,
           'source_type', source_type,
           'source_id',   source_id
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
