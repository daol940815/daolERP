-- 매입세금계산서 계정과목별 월별 합계 (confirmed_account_id 기준, 공급가액 기준)
CREATE OR REPLACE FUNCTION monthly_pl_tax_invoice_summary(
  p_from DATE,
  p_to   DATE
)
RETURNS TABLE (month TEXT, account_id UUID, amount BIGINT)
LANGUAGE sql STABLE
AS $$
  SELECT
    to_char(ti.issue_date, 'YYYY-MM') AS month,
    ti.confirmed_account_id            AS account_id,
    COALESCE(SUM(ti.supply_amount), 0)::BIGINT AS amount
  FROM tax_invoices ti
  WHERE ti.issue_date BETWEEN p_from AND p_to
    AND ti.direction = 'purchase'
    AND ti.confirmed_account_id IS NOT NULL
  GROUP BY 1, 2
$$;

-- 은행거래 계정과목별 월별 입출금 합계 (confirmed_account_id 기준)
CREATE OR REPLACE FUNCTION monthly_pl_tx_account_summary(
  p_from DATE,
  p_to   DATE
)
RETURNS TABLE (month TEXT, account_id UUID, amount_in BIGINT, amount_out BIGINT)
LANGUAGE sql STABLE
AS $$
  SELECT
    to_char(t.tx_date, 'YYYY-MM') AS month,
    t.confirmed_account_id          AS account_id,
    COALESCE(SUM(t.amount_in),  0)::BIGINT AS amount_in,
    COALESCE(SUM(t.amount_out), 0)::BIGINT AS amount_out
  FROM transactions t
  WHERE t.tx_date BETWEEN p_from AND p_to
    AND t.confirmed_account_id IS NOT NULL
  GROUP BY 1, 2
$$;
