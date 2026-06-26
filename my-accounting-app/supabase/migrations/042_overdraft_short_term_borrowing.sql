-- =====================================================
-- 042_overdraft_short_term_borrowing.sql
-- 마이너스통장(당좌차월) → 단기차입금(부채) 분리
--
-- 039에서 모든 은행계좌의 gl_account_id를 보통예금(1001)으로 기본 매핑했으나,
-- 마이너스통장(account_type='overdraft')은 잔액이 차입(음수)이므로
-- 보통예금이 아니라 단기차입금(부채)으로 분개해야 한다.
--   · 입금(상환) → 부채 감소 → 차변
--   · 출금(차입) → 부채 증가 → 대변
-- buildBankPosting은 gl_account_id를 그대로 차/대에 쓰므로,
-- 매핑만 단기차입금으로 바꾸면 복식부기가 자동으로 맞는다.
--
-- 단기차입금 계정(2002)은 011/031에서 코드만 참조됐을 뿐 실제 행이 없어 새로 만든다.
-- (현재 마이너스통장 거래는 전기된 건이 0건이라, 재전기 없이 이후 확정분부터 정상 전기된다.)
-- =====================================================

-- 1) 단기차입금 계정 생성 (멱등)
INSERT INTO accounts (code, name, type, side_on_in, side_on_out, is_active)
VALUES ('2002', '단기차입금', 'liability', 'debit', 'credit', true)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      type = EXCLUDED.type,
      side_on_in = EXCLUDED.side_on_in,
      side_on_out = EXCLUDED.side_on_out;

-- 2) 마이너스통장 → 단기차입금 재매핑
UPDATE bank_accounts
   SET gl_account_id = (SELECT id FROM accounts WHERE code = '2002' LIMIT 1)
 WHERE account_type = 'overdraft';
