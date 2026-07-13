-- =====================================================
-- 058_monthly_pl_journal_summary.sql
-- 월별 손익의 분개 기반 전환 (계획서 3단계·7번).
--
-- 손익 = 분개(journal_lines) 집계로 전환한다. 원천(세계/통장/카드)별
-- 하드코딩 집계를 버리고, 확정→분개→손익이 한 흐름으로 일치하게 한다.
-- 매출·매출원가만 ERP 기준 유지(사장님 결정 1) — 4001·5001·5002 등
-- 역할분리 계정은 조회 측에서 제외한다(결정 2).
-- =====================================================

CREATE OR REPLACE FUNCTION monthly_pl_journal_summary(
  p_from DATE,
  p_to   DATE
)
RETURNS TABLE (month TEXT, account_id UUID, debit BIGINT, credit BIGINT)
LANGUAGE sql STABLE
AS $$
  SELECT
    to_char(je.entry_date, 'YYYY-MM') AS month,
    jl.account_id                      AS account_id,
    COALESCE(SUM(jl.amount) FILTER (WHERE jl.side = 'debit'),  0)::BIGINT AS debit,
    COALESCE(SUM(jl.amount) FILTER (WHERE jl.side = 'credit'), 0)::BIGINT AS credit
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  WHERE je.entry_date BETWEEN p_from AND p_to
  GROUP BY 1, 2
$$;
