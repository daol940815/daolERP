-- =====================================================
-- 704_discount_modes.sql
-- 할인 종류 구분 — 정액 / 품목 단가 할인 (사용자 확정 2026-10-16)
--
-- 기존 discount_amount(행당 최종 할인액)는 그대로 유지 — 판매합계·마진·
-- 목록·주문 전환·하류 집계 공식 무변경. 종류와 입력값만 메타로 추가한다.
--  - discount_mode '정액': discount_amount에 직접 입력 (기존 동작, 기본값)
--  - discount_mode '단가': 개당 discount_unit원 × 수량 = discount_amount (자동 계산,
--    수량 변경 시 재계산 — 서버도 저장 시 재계산해 정합 보장)
-- 주문서에도 구분 표시 (사용자 확정 4번) — erp_order_items에 동일 컬럼.
-- 기존 데이터는 전부 '정액'으로 간주 (기본값, 데이터 이관 없음).
-- =====================================================

ALTER TABLE erp_consultation_items
  ADD COLUMN IF NOT EXISTS discount_mode TEXT NOT NULL DEFAULT '정액'
    CHECK (discount_mode IN ('정액', '단가')),
  ADD COLUMN IF NOT EXISTS discount_unit BIGINT NOT NULL DEFAULT 0;

ALTER TABLE erp_order_items
  ADD COLUMN IF NOT EXISTS discount_mode TEXT NOT NULL DEFAULT '정액'
    CHECK (discount_mode IN ('정액', '단가')),
  ADD COLUMN IF NOT EXISTS discount_unit BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN erp_consultation_items.discount_mode IS '할인 종류 — 정액(행당 금액 직접 입력) / 단가(개당 discount_unit원 × 수량). 최종 할인액은 discount_amount (704)';
COMMENT ON COLUMN erp_consultation_items.discount_unit IS '단가 할인의 개당 할인액(원). 정액이면 0 (704)';
COMMENT ON COLUMN erp_order_items.discount_mode IS '할인 종류 — 정액/단가. 최종 할인액은 discount_amount (704, 상담일지와 동일 구조)';
COMMENT ON COLUMN erp_order_items.discount_unit IS '단가 할인의 개당 할인액(원). 정액이면 0 (704)';
