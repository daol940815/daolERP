-- =====================================================
-- 602_vendor_purchase_kind.sql
-- 매입처 구분: 정기 거래 매입처 vs 온라인 구매처 (2026-08-14 사용자 결정)
--
-- 배경: 매입처 목록에 롯데쇼핑·현대리바트처럼 "거래처"가 아니라 우리가 온라인에서
-- 상품을 구매했을 뿐인 곳이 섞여 있다. 이런 곳은 담당자·발주 이메일이 없고 결제도
-- 즉시(카드 등)라 발주·미지급 관리 대상이 아니며, 필요한 것은 "여기서 얼마나
-- 구매했는가" 하나뿐이다.
--
-- 규칙:
--   partner (기본) — 정기 거래 매입처. 발주·미지급·담당 관리 대상.
--   online         — 온라인 구매처. 발주 이메일·담당자 '미입력' 경고 제외,
--                    미지급 상태 판정·잔액 KPI 합계에서 제외. 매입 규모는 계속 집계.
--
-- 상태가 아니라 분류다 — 데이터에서 자동 판정하지 않고 사용자가 확정한다
-- (시스템은 후보 추천만, 확정은 사용자 — CLAUDE.md 원칙).
-- 집계 RPC(600/601)는 금액만 계산하므로 변경할 필요가 없다.
-- 구분은 lib/purchase-hub.ts가 vendors에서 함께 읽어 화면 판정에 쓴다.
-- =====================================================

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS purchase_kind TEXT NOT NULL DEFAULT 'partner'
  CHECK (purchase_kind IN ('partner', 'online'));

COMMENT ON COLUMN vendors.purchase_kind IS
  '매입처 구분: partner=정기 거래 매입처(발주·미지급 관리 대상) / online=온라인 구매처(구매 규모만 확인). 매입처 허브 화면 판정용, 매출 쪽에는 영향 없음.';

-- 목록에서 구분 필터로 자주 훑는 경로
CREATE INDEX IF NOT EXISTS idx_vendors_purchase_kind
  ON vendors(purchase_kind)
  WHERE purchase_kind = 'online';
