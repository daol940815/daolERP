-- =====================================================
-- 041_card_account_vendor.sql
-- 카드계좌 ↔ 카드사 거래처(매입처) 연결
--
-- 법인카드 사용 분개의 미지급금(2001)은 "카드사에 갚을 채무"다.
-- 따라서 미지급금 라인의 상대처(vendor)는 가맹점이 아니라 카드사여야 한다.
-- card_accounts에 vendor_id를 두어, 카드 분개가 일관되게 카드사를 태깅하도록 한다.
-- (가맹점명은 description/적요로만 남는다.)
-- =====================================================

ALTER TABLE card_accounts
  ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL;

COMMENT ON COLUMN card_accounts.vendor_id
  IS '카드사에 대응하는 거래처(매입처) — 카드 미지급금의 상대처';

-- 기존 카드사별로 거래처(매입처)를 확보하고 연결한다.
--  · 동일 이름의 거래처가 이미 있으면 재사용, 없으면 매입처로 생성.
DO $$
DECLARE
  r     RECORD;
  v_id  UUID;
BEGIN
  FOR r IN
    SELECT DISTINCT card_company
    FROM card_accounts
    WHERE vendor_id IS NULL AND card_company IS NOT NULL
  LOOP
    SELECT id INTO v_id FROM vendors WHERE name = r.card_company LIMIT 1;
    IF v_id IS NULL THEN
      INSERT INTO vendors(name, type, note)
      VALUES (r.card_company, 'vendor', '법인카드 카드사 (자동 생성)')
      RETURNING id INTO v_id;
    END IF;
    UPDATE card_accounts
       SET vendor_id = v_id
     WHERE card_company = r.card_company AND vendor_id IS NULL;
  END LOOP;
END $$;
