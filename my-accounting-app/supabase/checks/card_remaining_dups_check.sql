-- =====================================================
-- card_remaining_dups_check.sql  (읽기 전용 — 데이터 변경 없음)
-- 419(10-28 행 삭제) 뒤에도 남아 있는 "같은 거래로 보이는 행" 전부 (2026-10-28)
-- 판정: 같은 카드계좌 · 같은 이용일 · 순액(승인−취소) 절대값이 같은 행이 2개 이상 (시트·시각 무관)
-- 같은 날 같은 금액의 승인+취소 짝(정상)도 잡히므로 상태표기·시각을 같이 본다.
-- =====================================================
WITH g AS (
  SELECT card_account_id, tx_date, abs(approved_amount - cancel_amount) AS net, COUNT(*) n
  FROM card_expenses
  WHERE tx_date >= DATE '2026-06-30'
  GROUP BY card_account_id, tx_date, abs(approved_amount - cancel_amount)
  HAVING COUNT(*) > 1
)
SELECT ca.card_company AS 카드사, right(ca.card_number, 4) AS 카드끝4, e.tx_date AS 이용일, e.tx_time AS 시각,
       e.approved_amount AS 승인, e.cancel_amount AS 취소, e.merchant_name AS 가맹점, e.statement_status AS 상태표기,
       e.source_sheet AS 시트, e.created_at::date AS 업로드일, e.classify_status AS 분류,
       EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_type = 'card' AND je.source_id = e.id) AS 분개,
       g.n AS 묶음행수
FROM card_expenses e
JOIN g ON g.card_account_id = e.card_account_id AND g.tx_date = e.tx_date AND abs(e.approved_amount - e.cancel_amount) = g.net
JOIN card_accounts ca ON ca.id = e.card_account_id
ORDER BY ca.card_company, e.tx_date, g.net, e.source_sheet, e.tx_time;
