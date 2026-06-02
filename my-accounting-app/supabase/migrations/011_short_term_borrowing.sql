-- ================================================================
-- 011_short_term_borrowing.sql
-- 마이너스 통장(한도대출) 대응 — 단기차입금 부채 계정 추가
-- ================================================================
-- 마이너스 통장 거래의 기본 분류 계정.
--   side_on_in  = 'credit'  : 차입(돈 들어옴) → 부채 증가 → 대변
--   side_on_out = 'debit'   : 상환(돈 나감)   → 부채 감소 → 차변

INSERT INTO accounts (code, name, type, keywords, side_on_in, side_on_out)
VALUES (
  '2002',
  '단기차입금',
  'liability',
  ARRAY['마이너스', '마이너스통장', '한도대출', '차입', '대출실행', '대출금'],
  'credit',
  'debit'
)
ON CONFLICT (code) DO NOTHING;
