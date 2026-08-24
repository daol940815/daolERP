-- =====================================================
-- 403_fix_long_term_borrowing_code.sql  (회계 트랙 — 긴급 복구)
--
-- 사고: 402_loans_master.sql이 장기차입금을 코드 '2003'으로 생성했는데,
--   '2003'은 이미 **부가세예수금**(047_vat_accounts.sql)이 쓰고 있던 코드다.
--   402의 INSERT ... ON CONFLICT (code) DO UPDATE 때문에 402를 실행한 DB에서는
--   부가세예수금 행의 name이 '장기차입금'으로 덮어써지고 side_on_in/side_on_out도
--   함께 설정됐다.
--
-- 영향 범위 (확인 결과):
--   · 분개 금액은 훼손되지 않았다. 계정 조회가 전부 코드('2003') 기준이라
--     매출 세금계산서·카드매출 분개는 같은 계정 행에 정상 전기됐고 차/대 금액도 그대로다.
--     (lib/journal/tax-invoice-posting.ts:77, lib/journal/card-sales-posting.ts:60)
--   · 잘못된 것은 계정의 '이름'과 'side' 값이다 → 원장·재무 화면에서 매출 부가세가
--     '장기차입금'으로 표시되고, 통장 분류 시 차/대 자동 판정이 바뀔 수 있었다.
--   · 대출 원리금 분개는 아직 생성 전(61건 보류)이라 장기차입금으로 전기된 분개는 없다.
--
-- 조치: 2003을 부가세예수금으로 원복하고, 장기차입금은 빈 코드 2004로 재생성한다.
--   402 파일도 2004를 쓰도록 수정했으므로 재실행해도 안전하다.
-- =====================================================

-- ── STEP 1. 사고 전 상태 확인 (읽기 전용) ────────────────
-- 402를 실행한 DB면 2003의 name이 '장기차입금'으로 나온다.
-- 2003에 전기된 분개가 있는지도 함께 본다(있어도 금액은 정상 — 이름만 잘못된 것).
SELECT a.code, a.name, a.type, a.side_on_in, a.side_on_out,
       (SELECT count(*) FROM journal_lines jl WHERE jl.account_id = a.id) AS journal_lines
FROM accounts a
WHERE a.code IN ('2003', '2004')
ORDER BY a.code;

-- ── STEP 2. 2003 원복 — 부가세예수금 (047 원래 정의) ─────
-- 047은 code/name/type/is_active만 설정했으므로 side 값은 NULL로 되돌린다.
UPDATE accounts
   SET name        = '부가세예수금',
       type        = 'liability',
       side_on_in  = NULL,
       side_on_out = NULL,
       is_active   = true
 WHERE code = '2003';

-- ── STEP 3. 장기차입금을 2004로 재생성 ───────────────────
-- 일반 계좌 관점: 입금 = 차입 실행 → 대변 / 출금 = 원금 상환 → 차변.
-- (2002 단기차입금은 마이너스통장 관점이라 side가 반대 — 042 참조)
INSERT INTO accounts (code, name, type, side_on_in, side_on_out, is_active)
VALUES ('2004', '장기차입금', 'liability', 'credit', 'debit', true)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      type = EXCLUDED.type,
      side_on_in = EXCLUDED.side_on_in,
      side_on_out = EXCLUDED.side_on_out;

-- ── STEP 4. 검증 ────────────────────────────────────────
-- 기대: 2003=부가세예수금(side NULL) · 2004=장기차입금(credit/debit).
-- 2003의 journal_lines 건수는 STEP 1과 동일해야 한다(분개는 건드리지 않았다).
SELECT a.code, a.name, a.type, a.side_on_in, a.side_on_out,
       (SELECT count(*) FROM journal_lines jl WHERE jl.account_id = a.id) AS journal_lines
FROM accounts a
WHERE a.code IN ('2002', '2003', '2004')
ORDER BY a.code;
