-- =====================================================
-- 068_vob_collected_amount.sql
-- 거래처별 기초잔액 회수 누계 — Aging 차감용 (원장 이월과 분리)
--
-- 기초분이 회수/지급되면 amount를 깎지 않고 collected_amount에 누계로 기록한다.
--   · 미수·미지급 Aging의 기초이월 잔액 = |amount| - collected_amount
--   · 거래처원장의 전월이월 = amount 그대로 (회수는 통장 분개가 처리하므로
--     amount를 깎으면 원장이 이중 차감된다)
-- collected_amount는 부호 없이 회수/지급된 금액의 절대값 누계.
-- =====================================================

ALTER TABLE vendor_opening_balances
  ADD COLUMN IF NOT EXISTS collected_amount BIGINT NOT NULL DEFAULT 0
  CHECK (collected_amount >= 0);

COMMENT ON COLUMN vendor_opening_balances.collected_amount IS
  '기초분 회수/지급 누계(절대값). Aging 기초이월 잔액 = |amount| - collected_amount. 원장 이월은 amount 그대로 사용.';
