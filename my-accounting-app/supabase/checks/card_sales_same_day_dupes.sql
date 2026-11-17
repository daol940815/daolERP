-- ③ 상세: 같은 날 · 같은 카드 · 같은 금액 승인 2건 이상 — 한 문장. 그룹마다 승인번호 · 시각 · CPID · 결제상태 · 거래처 · 분개를 나열 (2026-11-17)
-- 보는 법: 경로가 'PG+단말기 섞임'이면 같은 결제가 두 경로로 잡혔을 가능성(중복 의심). 같은 경로에 시각이 다르면 나눠 결제(정상)일 수 있다.
WITH g AS (
  SELECT tx_date, card_number, amount, count(*) AS cnt
  FROM card_sales WHERE transaction_type = 'approval' AND amount <> 0
  GROUP BY tx_date, card_number, amount HAVING count(*) > 1)
SELECT c.tx_date AS 거래일, c.card_number AS 카드번호, c.amount AS 금액, g.cnt AS 건수,
       CASE WHEN count(DISTINCT (c.cpid IS NULL)) OVER (PARTITION BY c.tx_date, c.card_number, c.amount) > 1 THEN 'PG+단말기 섞임' WHEN c.cpid IS NULL THEN '단말기' ELSE 'PG' END AS 경로,
       c.tx_time AS 시각, c.approval_number AS 승인번호, c.cpid, c.acquirer AS 매입사, c.processing_status AS 결제상태,
       v.name AS 거래처, (SELECT sum(abs(amount)) FROM card_sales x WHERE x.transaction_type = 'cancel' AND x.approval_number = c.approval_number) AS 취소합,
       (SELECT count(*) FROM erp_payment_matches m WHERE m.source_type = 'card' AND m.source_id = c.id) AS 주문매칭수,
       c.created_at::date AS 등록일
FROM g JOIN card_sales c ON c.transaction_type = 'approval' AND c.tx_date = g.tx_date AND c.card_number IS NOT DISTINCT FROM g.card_number AND c.amount = g.amount
LEFT JOIN vendors v ON v.id = c.vendor_id
ORDER BY c.tx_date DESC, c.card_number, c.amount, c.tx_time, c.approval_number;
