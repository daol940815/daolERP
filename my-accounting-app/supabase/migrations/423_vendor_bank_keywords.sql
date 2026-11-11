-- =====================================================
-- 423_vendor_bank_keywords.sql  (회계 트랙 — 스키마)
-- 거래처 통장 키워드 — 계산서 매칭 키워드(match_aliases)와 분리 (2026-11-11 사용자 승인)
--
-- 배경: vendors.match_aliases(014) 한 칸을 계산서 자동 매칭과 통장 거래처 자동 매칭이 같이 썼고,
--   계산서 결제를 수동 매칭하면 통장 적요가 그 칸에 자동 학습돼 두 용도가 섞였다.
--   매입처 상세에서 "그 매입처의 통장 키워드로 연결된 입출금 합계 ↔ 계산서 합계" 대사를 하려면
--   통장 적요 표현(입금자명·약칭)을 담는 칸이 따로 있어야 한다.
-- 내용: bank_keywords TEXT[] 추가 + 시작값으로 match_aliases 복사(지금 통장 매칭이 그걸로 돌고 있어
--   비워 두면 자동 연결이 끊긴다). 이후 두 목록은 따로 간다 — 통장 자동 매칭·학습은 bank_keywords만,
--   계산서 자동 매칭은 match_aliases만 본다.
-- 원본 거래 데이터 변경 없음. 기존 연결(transactions.vendor_id) 변경 없음.
-- =====================================================

-- ① 드라이런 — 실행 전에 이 SELECT만 먼저 돌려 복사 대상 규모를 본다
SELECT COUNT(*)                                         AS 거래처_전체,
       COUNT(*) FILTER (WHERE cardinality(match_aliases) > 0) AS 키워드_있는_거래처,
       COALESCE(SUM(cardinality(match_aliases)), 0)           AS 키워드_총개수
FROM vendors;

-- ② 스키마
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS bank_keywords TEXT[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN vendors.bank_keywords IS
  '통장 적요·보낸분/받는분에서 이 거래처를 찾는 키워드(입금자명·약칭). 통장 거래처 자동 매칭·학습 전용. 계산서 매칭은 match_aliases.';
COMMENT ON COLUMN vendors.match_aliases IS
  '계산서 공급자 상호가 거래처명과 다를 때 쓰는 계산서 매칭 키워드. 통장 매칭은 bank_keywords(423부터).';

-- ③ 시작값 복사 — 아직 비어 있는 거래처만 (재실행해도 사람이 고친 값을 덮지 않는다)
UPDATE vendors
SET    bank_keywords = match_aliases
WHERE  cardinality(bank_keywords) = 0
  AND  cardinality(match_aliases) > 0;

-- ④ 검증 — ①의 키워드_있는_거래처 = 통장키워드_있는_거래처, 키워드_총개수 = 통장키워드_총개수 이면 정상
SELECT COUNT(*) FILTER (WHERE cardinality(bank_keywords) > 0) AS 통장키워드_있는_거래처,
       COALESCE(SUM(cardinality(bank_keywords)), 0)           AS 통장키워드_총개수,
       COUNT(*) FILTER (WHERE bank_keywords <> match_aliases)  AS 두_목록이_다른_거래처
FROM vendors;
