-- 마이그레이션 011에서 단기차입금(2002)의 side_on_in/side_on_out이
-- 반대로 설정되어 있었음을 수정한다.
--
-- balance(t) = balance(t-1) + amount_in(t) - amount_out(t) 이고
-- 마이너스 통장의 부채 = -balance 이므로:
--   amount_in  (입금) → 부채 감소 → 상환 → 차변(debit)
--   amount_out (출금) → 부채 증가 → 차입 → 대변(credit)
UPDATE accounts
SET side_on_in = 'debit', side_on_out = 'credit'
WHERE code = '2002';
