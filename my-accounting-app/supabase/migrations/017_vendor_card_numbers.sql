-- =====================================================
-- 017_vendor_card_numbers.sql
-- 거래처 카드번호 컬럼 추가
-- 카드결제내역(매출)에는 상호명 없이 마스킹된 카드번호만 제공되므로,
-- 거래처에 카드번호를 등록해두면 자동으로 매칭/식별할 수 있다.
-- =====================================================

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS card_numbers TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN vendors.card_numbers IS
  '카드결제내역(매출) 매칭용 마스킹된 카드번호 목록 (예: 4025-96**-****-0302). 일부만 식별 가능해도 거래처 구분에는 충분.';
