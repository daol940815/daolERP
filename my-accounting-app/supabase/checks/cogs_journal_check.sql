-- =====================================================
-- cogs_journal_check.sql  (읽기 전용 — 데이터 변경 없음)
-- 월별 손익(증빙 기준)에서 7·8월 상품매입(세금계산서)이 0원인 원인 (2026-11-03)
-- 증빙 기준 매출원가 = 5002(상품매입)·5001 계정의 분개(journal_lines) 합계. 분개는 계산서가 "확정"돼야 생긴다.
-- 후보: ① 7·8월 매입 계산서가 미분류 ② 분류는 됐는데 분개가 없음(동기화 누락) ③ 상품매입이 아닌 계정으로 분류됨
-- =====================================================
WITH inv AS (
  SELECT to_char(issue_date, 'YYYY-MM') m, t.*, a.code acc_code, a.name acc_name
  FROM tax_invoices t LEFT JOIN accounts a ON a.id = t.confirmed_account_id
  WHERE t.direction = 'purchase' AND t.issue_date BETWEEN DATE '2026-07-01' AND DATE '2026-10-31'
)
SELECT m AS 월,
       COUNT(*) AS 매입계산서,
       SUM(total_amount) AS 합계,
       COUNT(*) FILTER (WHERE confirmed_account_id IS NULL) AS 미분류건,
       SUM(total_amount) FILTER (WHERE confirmed_account_id IS NULL) AS 미분류합계,
       COUNT(*) FILTER (WHERE acc_code IN ('5001','5002')) AS 상품매입분류건,
       SUM(total_amount) FILTER (WHERE acc_code IN ('5001','5002')) AS 상품매입분류합계,
       COUNT(*) FILTER (WHERE confirmed_account_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_type = 'tax_invoice' AND je.source_id = inv.id)) AS 분류됐는데_분개없음,
       (SELECT COALESCE(SUM(CASE WHEN jl.side = 'debit' THEN jl.amount ELSE -jl.amount END), 0)
          FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
          JOIN accounts a2 ON a2.id = jl.account_id
         WHERE a2.code IN ('5001','5002') AND je.source_type = 'tax_invoice'
           AND to_char(je.entry_date, 'YYYY-MM') = inv.m) AS 상품매입_분개합계,
       string_agg(DISTINCT acc_name, ', ') FILTER (WHERE confirmed_account_id IS NOT NULL) AS 분류된_계정들
FROM inv
GROUP BY m ORDER BY m;
