-- tax_invoices에 계정과목 분류 컬럼 추가
ALTER TABLE tax_invoices
  ADD COLUMN IF NOT EXISTS confirmed_account_id UUID
    REFERENCES accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tax_invoices_account
  ON tax_invoices(confirmed_account_id);

COMMENT ON COLUMN tax_invoices.confirmed_account_id
  IS '매입세금계산서 계정과목 (손익계산서 집계 기준)';

-- 신규 계정과목 (판관비 확장 6개 + 영업외비용 3개 + 영업외수익 2개 + 자본 2개)
INSERT INTO accounts (code, name, type, keywords) VALUES
  ('5201', '운반비',      'expense', ARRAY['배송료', '운반비', '화물비', '운송비', '물류비']),
  ('5202', '외주용역비',  'expense', ARRAY['용역비', '도급', '하청', '위탁용역', '아웃소싱']),
  ('5203', '전기요금',    'expense', ARRAY['전기요금', '전력요금', '전기세', '한국전력', '한전']),
  ('5204', '청소비',      'expense', ARRAY['청소용역', '미화', '환경미화', '청소업체']),
  ('5205', '보안비',      'expense', ARRAY['경비용역', '보안용역', '방범', '감시', '경호']),
  ('5206', '기타판관비',  'expense', ARRAY[]::text[]),
  ('5301', '이자비용',    'expense', ARRAY['이자비용', '대출이자', '차입금이자', '할인료']),
  ('5302', '금융수수료',  'expense', ARRAY['금융수수료', '은행수수료', '이체수수료', '송금수수료']),
  ('5303', '잡손실',      'expense', ARRAY['잡손실', '기타손실']),
  ('4002', '이자수익',    'income',  ARRAY['이자수익', '예금이자', '정기이자', '이자입금']),
  ('4003', '잡이익',      'income',  ARRAY['잡이익', '잡수입', '기타수익']),
  ('3001', '자본금',      'equity',  ARRAY['자본금', '출자', '납입자본']),
  ('3002', '이익잉여금',  'equity',  ARRAY['이익잉여금', '당기순이익', '전기이월'])
ON CONFLICT (code) DO NOTHING;
