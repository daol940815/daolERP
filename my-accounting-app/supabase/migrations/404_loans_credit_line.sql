-- =====================================================
-- 404_loans_credit_line.sql  (회계 트랙)
-- 마이너스 통장(한도대출)을 일반 대출과 분리해서 관리 (2026-08-19 결정)
--
-- 배경: 일반 대출은 약정 원금이 정해지고 상환 스케줄대로 줄어들지만,
--   마이너스 통장은 한도만 약정하고 사용액이 매일 변하며 이자도
--   사용액 x 사용일수로 붙는다. 같은 표에 두면 '현 잔액'·'월 이자'의 의미가
--   달라 합계가 왜곡된다(미사용 한도 3.5억이 0원으로 표시되던 문제).
--
-- 설계: 마이너스 통장은 loans에 잔액을 수기로 적지 않는다.
--   loans에는 계약 정보(약정한도·이율·만기·연결 계좌)만 두고,
--   **사용액·미사용 한도는 통장 원본에서 자동 산출**한다
--   (bank_accounts.account_type='overdraft' + overdraft_limit,
--    lib/cash-reports.ts의 buildCashPositionRows가 이미 계산 중).
--   원본이 있으면 원본을 쓴다는 원칙에 맞고 수기 갱신이 필요 없다.
-- =====================================================

-- ── 1. 컬럼 추가 ────────────────────────────────────────
ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS product_type TEXT NOT NULL DEFAULT 'term'
    CHECK (product_type IN ('term', 'credit_line')),
  ADD COLUMN IF NOT EXISTS credit_limit BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN loans.product_type IS
  'term: 일반 대출(약정 원금·상환 스케줄) / credit_line: 한도대출(마이너스 통장 — 사용액은 통장에서 자동 산출)';
COMMENT ON COLUMN loans.credit_limit IS
  '한도대출 약정한도(양수). 일반 대출은 0. 사용액·미사용 한도는 저장하지 않고 통장 잔액에서 계산한다.';

CREATE INDEX IF NOT EXISTS idx_loans_product_type ON loans(product_type);

-- ── 2. 드라이런 (읽기 전용) ─────────────────────────────
-- 전환 대상 확인: 대출명에 '마이너스'가 들어간 건 (기대: 2건 — 하나 1.5억·우리 2억)
SELECT seq, bank_name, title, original_amount, current_balance, status
FROM loans
WHERE title LIKE '%마이너스%' AND product_type = 'term'
ORDER BY seq;

-- ── 3. 전환 실행 (드라이런 확인 후) ─────────────────────
-- 약정한도 = 기존 '원 대출금액'. 현 잔액은 통장에서 산출하므로 0으로 둔다.
UPDATE loans
   SET product_type    = 'credit_line',
       credit_limit    = original_amount,
       current_balance = 0,
       monthly_principal = 0,
       memo = coalesce(nullif(memo, '') || ' | ', '')
              || '한도대출 전환 2026-08 (사용액은 통장 잔액에서 자동 산출)'
 WHERE title LIKE '%마이너스%' AND product_type = 'term';

-- ── 4. 검증 ────────────────────────────────────────────
-- 기대: credit_line 2건(약정한도 합 350,000,000) / term 7건(잔액 합 3,417,000,000)
SELECT product_type,
       count(*)                    AS loans,
       sum(credit_limit)           AS limit_total,
       sum(current_balance)        AS balance_total,
       sum(monthly_principal)      AS monthly_principal_total
FROM loans
GROUP BY product_type
ORDER BY product_type;

-- 한도대출의 연결 계좌가 통장에서 마이너스통장으로 잡혀 있는지 확인
-- (account_type='overdraft'가 아니면 사용액이 0으로 나온다 — 계좌 설정 확인 필요)
SELECT l.seq, l.title, b.bank_name, b.account_number,
       b.account_type, b.overdraft_limit
FROM loans l
LEFT JOIN bank_accounts b ON b.id = l.bank_account_id
WHERE l.product_type = 'credit_line'
ORDER BY l.seq;
