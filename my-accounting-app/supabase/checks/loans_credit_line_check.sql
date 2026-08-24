-- =====================================================
-- loans_credit_line_check.sql  (읽기 전용 — 데이터 변경 없음)
-- 404 실행 후 한도대출이 1건만 전환된 원인 확인 (2026-08-19)
--
-- 404의 전환 조건: title LIKE '%마이너스%' AND product_type = 'term'
-- 기대: 하나 …7804 · 우리 …8607 두 건이 credit_line이 되어야 한다.
-- 한 건만 전환됐다면 (a) 나머지 대출 행이 없거나 (b) 대출명이 '마이너스'를
-- 포함하지 않는 경우다. 아래 결과로 어느 쪽인지 판정한다.
--
-- 함께 확인: 통장에 마이너스통장으로 등록된 계좌 목록.
--   loans가 맞게 전환돼도 계좌가 account_type='overdraft'가 아니면
--   화면 사용액이 0으로만 나온다.
-- =====================================================

SELECT jsonb_pretty(jsonb_build_object(

  -- [1] 대출 마스터 전체 (기대: 9건)
  'loans', (
    SELECT jsonb_agg(jsonb_build_object(
      'seq',            l.seq,
      'title',          l.title,
      'bank',           l.bank_name,
      'product_type',   l.product_type,
      'credit_limit',   l.credit_limit,
      'original',       l.original_amount,
      'balance',        l.current_balance,
      'status',         l.status,
      'linked_account', (SELECT b.bank_name || ' ' || coalesce(b.account_number, '(번호없음)')
                           FROM bank_accounts b WHERE b.id = l.bank_account_id)
    ) ORDER BY l.seq)
    FROM loans l
  ),

  -- [2] 전환 조건에 걸리는 행 (title에 '마이너스' 포함)
  'title_match', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'seq', seq, 'title', title, 'product_type', product_type
    ) ORDER BY seq), '[]'::jsonb)
    FROM loans WHERE title LIKE '%마이너스%'
  ),

  -- [3] 통장에 마이너스통장으로 등록된 계좌 (기대: 2개 — 하나·우리)
  'overdraft_accounts', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'bank', bank_name, 'account', account_number,
      'limit', overdraft_limit, 'active', is_active
    ) ORDER BY bank_name), '[]'::jsonb)
    FROM bank_accounts WHERE account_type = 'overdraft'
  ),

  -- [4] 참고: 전체 계좌의 유형 분포 (마이너스통장 설정 누락 확인용)
  'account_types', (
    SELECT jsonb_agg(jsonb_build_object(
      'bank', bank_name, 'account', account_number,
      'type', coalesce(account_type, 'normal'), 'limit', overdraft_limit
    ) ORDER BY bank_name, account_number)
    FROM bank_accounts WHERE is_active
  )

)) AS check_result;
