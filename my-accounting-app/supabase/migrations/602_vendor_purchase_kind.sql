-- =====================================================
-- 602_vendor_purchase_kind.sql
-- 매입처 구분: 거래 매입처 / 별도 구매처 / 경비성 (2026-08-14 사용자 결정)
--
-- 배경: 매입처 목록에 성격이 다른 셋이 섞여 있다.
--   1) 정기 거래 매입처 — 발주하고 정산하는 진짜 거래처 (관리 대상)
--   2) 별도 구매처      — 롯데쇼핑·백화점·쿠팡처럼 우리가 상품을 사 온 곳.
--                        담당자·발주 이메일이 없고 즉시 결제라 관리할 게 없다.
--                        "얼마나 구매했는가"만 보면 된다.
--   3) 경비성           — 택배·전기·보안·렌트·리스처럼 상품 매입이 아닌 비용.
--                        발주 대상은 아니지만 지급 의무는 있으므로 미지급 관리는 유지한다.
--
-- 상태가 아니라 분류다 — 데이터에서 자동 판정하지 않고 사용자가 확정한다
-- (시스템은 추천만, 확정은 사용자 — CLAUDE.md 원칙).
-- 집계 RPC(600/601)는 금액만 계산하므로 변경할 필요가 없다.
-- 구분은 lib/purchase-hub.ts가 vendors에서 함께 읽어 화면 판정에 쓴다.
--
-- 실행 방법: 1단계(컬럼) → 2단계(지정) → 3단계(검증) 순서로, 통째로 실행해도 된다.
-- 재실행해도 안전하다 (지정은 이름 일치 기준 덮어쓰기).
-- =====================================================

-- ── 1단계: 구분 컬럼 ────────────────────────────────────────────────
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS purchase_kind TEXT NOT NULL DEFAULT 'partner';

ALTER TABLE vendors DROP CONSTRAINT IF EXISTS vendors_purchase_kind_check;
ALTER TABLE vendors
  ADD CONSTRAINT vendors_purchase_kind_check
  CHECK (purchase_kind IN ('partner', 'retail', 'expense'));

COMMENT ON COLUMN vendors.purchase_kind IS
  '매입처 구분: partner=정기 거래 매입처(발주·미지급·담당 관리 대상) / retail=별도 구매처(온·오프라인에서 사 온 곳, 즉시 결제라 미지급 관리 제외) / expense=경비성(발주 대상 아님, 미지급 관리는 유지). 매입처 허브 화면 판정용 — 매출 쪽에는 영향 없음.';

CREATE INDEX IF NOT EXISTS idx_vendors_purchase_kind
  ON vendors(purchase_kind)
  WHERE purchase_kind <> 'partner';

-- ── (선택) 드라이런: 지정될 거래처 미리보기 ──────────────────────────
/*
SELECT v.name, v.purchase_kind AS 현재, x.kind AS 변경후
FROM vendors v
JOIN (VALUES
  ('롯데쇼핑㈜','retail'), ('롯데쇼핑(주) 인천점','retail'),
  ('롯데쇼핑(주)e커머스사업본부','retail'), ('롯데쇼핑(주)바샤커피 청담점','retail'),
  ('롯데쇼핑㈜ 바샤커피 인천점','retail'), ('(주)현대리바트 경인사업소','retail'),
  ('현대백화점','retail'), ('롯데백화점','retail'), ('롯데백화점 본점','retail'),
  ('카카오톡 선물하기','retail'), ('온라인','retail'), ('오프라인','retail'),
  ('씨제이대한통운㈜','expense'), ('폭스바겐파이낸셜서비스코리아주식회사','expense'),
  ('기아(주) 인천렌트','expense'), ('한국전력공사','expense'),
  ('(주)에스원 고양','expense'), ('(주)다우데이타','expense')
) AS x(name, kind) ON x.name = v.name
ORDER BY x.kind, v.name;
*/

-- ── 2단계: 지정 ────────────────────────────────────────────────────
-- 별도 구매처 12곳 — 유통·쇼핑몰 10곳 + 채널 묶음 2곳.
--   '온라인'·'오프라인'은 별칭에 실제 판매처가 들어 있는 묶음 거래처다
--   (온라인(쿠팡)·온-하이마트·인터넷(롯데온)·온라인(LG전자) 등 13개 별칭).
--   품목도 애플 에어팟·다이슨·즈월링 냄비처럼 사 온 상품이라 성격이 같아 함께 넣는다.
--   판매처별로 나눠 보고 싶어지면 별칭을 분리해 거래처를 쪼개면 된다.
UPDATE vendors SET purchase_kind = 'retail'
WHERE name IN (
  '롯데쇼핑㈜', '롯데쇼핑(주) 인천점', '롯데쇼핑(주)e커머스사업본부',
  '롯데쇼핑(주)바샤커피 청담점', '롯데쇼핑㈜ 바샤커피 인천점',
  '(주)현대리바트 경인사업소', '현대백화점', '롯데백화점', '롯데백화점 본점',
  '카카오톡 선물하기', '온라인', '오프라인'
);

-- 경비성 6곳 — 택배·차량리스·렌트·전기·보안·전산.
--   후보에 있던 '대상크리스탈시상품'은 상품 매입처가 맞아 제외(사용자 확인).
UPDATE vendors SET purchase_kind = 'expense'
WHERE name IN (
  '씨제이대한통운㈜', '폭스바겐파이낸셜서비스코리아주식회사', '기아(주) 인천렌트',
  '한국전력공사', '(주)에스원 고양', '(주)다우데이타'
);

-- ── 3단계: 검증 (숫자 확인용) ───────────────────────────────────────
SELECT purchase_kind, count(*) AS 거래처수
FROM vendors GROUP BY purchase_kind ORDER BY purchase_kind;
