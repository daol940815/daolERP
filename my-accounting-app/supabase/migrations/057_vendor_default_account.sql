-- =====================================================
-- 057_vendor_default_account.sql
-- 거래처 기본계정 — 분류 도구(1단계)의 토대.
--
-- "이 거래처 매입은 항상 이 계정" 을 거래처에 저장해,
-- 확정 이력이 없는 거래처도 첫 지정 이후 자동 추천되게 한다.
-- 추천 우선순위: ① 확정 이력 과반 → ② 기본계정 → ③ 품목/적요 키워드.
-- (자동은 추천까지만 — 확정은 항상 사용자)
-- =====================================================

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS default_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL;

COMMENT ON COLUMN vendors.default_account_id IS
  '거래처 기본계정 — 매입 세금계산서/통장 거래 분류 시 추천에 사용 (확정 이력이 우선)';

CREATE INDEX IF NOT EXISTS idx_vendors_default_account ON vendors(default_account_id);
