-- =====================================================
-- 054_card_sales_journal.sql
-- 카드매출 자동분개 토대: 카드사 거래처 구분 + 매입사별 거래처 확보.
--
-- 설계(합의):
--   · 카드 승인 = 사실 데이터 → 자동 전기 (source_type='card_sale', 멱등)
--       (차) 매출채권(1101) [거래처=카드사] / (대) 상품매출(4001) + 부가세예수금(2003)
--   · 카드 취소 = 역분개
--   · 정산 입금 = 통장 분류(추천→확정) 시 기존 은행 분개가 매출채권 상계
--   · 미수잔액은 차단 조건이 아니라 신뢰도 참고 신호
--   · 카드사 판정은 적요 문자열이 아니라 vendors.is_card_company 플래그 기반
--     ("하나카드 경영지원팀" 같은 일반 매출처와 혼동 방지)
-- =====================================================

-- 1) 카드사(정산용) 거래처 구분 플래그
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS is_card_company BOOLEAN NOT NULL DEFAULT false;

-- 2) 매입사 표준 카드사 거래처 확보 (없으면 생성, 있으면 플래그만)
--    · 하나카드/BC카드/롯데카드는 법인카드(사용내역)에서 이미 자동 생성됐을 수 있음 → 재사용
DO $$
DECLARE v_name TEXT;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['하나카드','BC카드','KB국민카드','신한카드','삼성카드','현대카드','NH농협카드','롯데카드']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM vendors WHERE name = v_name) THEN
      INSERT INTO vendors (name, type, note, is_card_company)
      VALUES (v_name, 'vendor', '카드사 (매입사 정산용, 자동 생성)', true);
    ELSE
      UPDATE vendors SET is_card_company = true WHERE name = v_name;
    END IF;
  END LOOP;
END $$;

-- 검증:
-- SELECT name, is_card_company FROM vendors WHERE is_card_company;  -- 8행
