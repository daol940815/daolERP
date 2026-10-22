-- =====================================================
-- loan_number_mapping_check.sql  (읽기 전용 — 데이터 변경 없음)
-- 통장 적요의 대출번호 ↔ 대출 마스터(loans) 짝짓기 재료 (2026-10-22)
--
-- 통장에서 대출번호 6개가 나왔고 전부 loans.loan_account_no 가 비어 있다.
-- 번호별 월 이자·원금 실적과 loans의 월 이자·원금 계획을 나란히 놓아 사람이 짝을 짓는다.
-- 짝이 정해지면 대출 관리 화면의 '대출번호' 칸에 입력한다 (SQL로 밀어넣지 않는다 — 사용자 확정).
-- =====================================================

-- [1] 통장 쪽: 대출번호별 월 실적 (구분으로 이자/원금 분리)
WITH x AS (
  SELECT substring(btrim(t.description) from '^(\d{10,})') AS loan_no,
         to_char(t.tx_date, 'YYYY-MM') AS 월,
         t.tx_kind, t.amount_out, t.bank_account_id
  FROM transactions t
  WHERE btrim(t.description) ~ '^\d{10,}(-\d+)?$' AND t.tx_kind IS NOT NULL
)
SELECT x.loan_no                                   AS 대출번호,
       ba.bank_name || ' …' || right(ba.account_number, 5) AS 출금계좌,
       x.월,
       SUM(x.amount_out) FILTER (WHERE x.tx_kind IN ('대출이자','대출결산'))         AS 이자,
       SUM(x.amount_out) FILTER (WHERE x.tx_kind IN ('대출상환'))                    AS 원금,
       SUM(x.amount_out) FILTER (WHERE x.tx_kind IN ('원리금상환'))                  AS 원리금합산,
       COUNT(*)                                                                      AS 건수
FROM x
LEFT JOIN bank_accounts ba ON ba.id = x.bank_account_id
GROUP BY x.loan_no, ba.bank_name, ba.account_number, x.월
ORDER BY x.loan_no, x.월;

-- [2] 대출 마스터 쪽: 계획값 (월 이자·월 원금·잔액·금리) — 위 실적과 금액을 맞춰 본다
SELECT seq, title AS 대출명, bank_name AS 은행, product_type AS 상품,
       current_balance AS 잔액, interest_rate AS 금리,
       monthly_interest AS 월이자_계획, monthly_principal AS 월원금_계획,
       payment_day AS 상환일, loan_account_no AS 대출번호_입력됨,
       (SELECT ba.bank_name || ' …' || right(ba.account_number, 5)
          FROM bank_accounts ba WHERE ba.id = l.bank_account_id) AS 연결계좌
FROM loans l
WHERE status <> 'closed'
ORDER BY bank_name, seq;
