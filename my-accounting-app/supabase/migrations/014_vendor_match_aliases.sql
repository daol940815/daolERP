-- =====================================================
-- 014_vendor_match_aliases.sql
-- 거래처 매칭 별칭(키워드) 컬럼 추가
-- 입금자명/적요 표기가 거래처 공식 상호와 다른 경우가 많아,
-- 수동 매칭 시 학습된 표현을 저장해 이후 자동 매칭에 활용한다.
-- =====================================================

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS match_aliases TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN vendors.match_aliases IS
  '거래내역 적요에서 이 거래처를 식별하기 위한 별칭 목록 (입금자명, 약칭 등). 자동 매칭 시 사업자번호·상호명과 함께 검사.';
