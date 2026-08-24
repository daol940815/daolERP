-- =====================================================
-- 405_fix_woori_credit_line.sql  (회계 트랙)
-- 404에서 누락된 우리은행 마이너스 통장을 한도대출로 전환 (2026-08-19)
--
-- 원인: 404의 전환 조건이 `title LIKE '%마이너스%'` 였는데, 우리은행 건(seq 7)의
--   대출명이 화면에서 실제 상품명 '우리큐브(CUBE) 기업자유예금'으로 수정되어 있어
--   조건에 걸리지 않았다. 하나은행 건(seq 1)만 전환됨.
--   → 대출명 문자열로 상품 종류를 판정한 것이 잘못. 종류는 product_type으로만 본다.
--
-- 확인된 사실 (진단 결과):
--   · seq 7 = 우리 …8607, 원 약정 2억, 사용자 입력 잔액 -194,670,112 (사용 중)
--   · 통장에도 우리 …8607이 account_type='overdraft', 한도 -200,000,000으로 등록됨
--     → 전환하면 사용액·미사용 한도가 통장에서 자동 산출된다.
--
-- 주의: 하나 …7804도 overdraft 계좌지만 일반 대출 5건(seq 2~6)의 출금 계좌이기도 하다.
--   따라서 "연결 계좌가 마이너스통장이면 한도대출"이라는 규칙은 쓸 수 없다.
--   전환 대상은 seq로 명시 지정한다.
-- =====================================================

-- ── STEP 1. 드라이런 (읽기 전용) ─────────────────────────
-- 기대: 1건 — seq 7 / 우리큐브(CUBE) 기업자유예금 / product_type='term'
SELECT l.seq, l.title, l.bank_name, l.product_type, l.original_amount, l.current_balance,
       b.account_number, b.account_type, b.overdraft_limit
FROM loans l
LEFT JOIN bank_accounts b ON b.id = l.bank_account_id
WHERE l.seq = 7;

-- ── STEP 2. 전환 실행 (드라이런 확인 후) ─────────────────
-- 약정한도 = 연결 계좌의 마이너스 한도(절대값), 없으면 원 대출금액.
-- 사용자가 입력해 둔 잔액은 메모에 남겨 이력을 보존한다.
UPDATE loans l
   SET product_type      = 'credit_line',
       credit_limit      = COALESCE(
                             (SELECT abs(b.overdraft_limit) FROM bank_accounts b
                               WHERE b.id = l.bank_account_id AND b.overdraft_limit IS NOT NULL),
                             l.original_amount),
       current_balance   = 0,
       monthly_principal = 0,
       monthly_interest  = 0,
       memo = COALESCE(NULLIF(l.memo, '') || ' | ', '')
              || '한도대출 전환 2026-08 (405). 전환 전 입력 잔액 '
              || to_char(l.current_balance, 'FM999,999,999,999') || '원 — '
              || '이후 사용액은 통장 잔액에서 자동 산출'
 WHERE l.seq = 7
   AND l.product_type = 'term';

-- ── STEP 3. 검증 ────────────────────────────────────────
-- 기대: credit_line 2건 / 약정한도 합 350,000,000 (하나 1.5억 + 우리 2억)
--       term 7건 / 잔액 합 3,396,500,000
SELECT product_type,
       count(*)               AS loans,
       sum(credit_limit)      AS limit_total,
       sum(current_balance)   AS balance_total
FROM loans
GROUP BY product_type
ORDER BY product_type;

-- 한도대출 2건의 계좌 연결·유형 확인 (둘 다 overdraft여야 사용액이 산출된다)
SELECT l.seq, l.title, l.credit_limit,
       b.bank_name, b.account_number, b.account_type, b.overdraft_limit
FROM loans l
LEFT JOIN bank_accounts b ON b.id = l.bank_account_id
WHERE l.product_type = 'credit_line'
ORDER BY l.seq;
