-- =====================================================
-- 515_order_replies.sql  (주문시스템 트랙)
-- 2026-11-05 사용자 확정 — 시안 docs/mockups/완료회신_시안.html
--
-- 완료 회신: 주문 · 발주를 처리한 직원이 요청자 · 상담자에게 처리 결과를 회신한다.
--  - 회신 대상 = 상담일지 주문 진행 요청 건 + 요청 없이도 상담자 ≠ 입력자인 주문 (직접 입력 · 취소 안 된 주문)
--  - 적용 시작 = 2026-11-06 입력분부터 (lib/order-reply.ts REPLY_START — 지난 주문은 대상 아님)
--  - 받는 사람 = {요청자, 상담자} − 입력자, 로그인 계정 있는 재직 직원만 (없으면 회신 대상 아님)
--  - 회신해야 완료. 결과 3종 done(완료) / changed(완료 · 변경 있음) / unable(처리 불가)
--  - 회신은 이력으로 쌓는다(수정 · 삭제 없음) — 최신 회신이 상태
--  - 전환 전 처리 불가 회신은 상담일지에 남긴다(order_id NULL) — 요청은 요청자에게 되돌아감
--  - 회신은 주문 수정 권한자 누구나 가능 (사용자 결정 "회신은 모두 가능하게")
--  - 재발행 시 회신 이력은 새 주문으로 옮긴다 (앱 inheritToReissued)
-- 기존 데이터 변경 없음 (표 2개 추가만)
-- =====================================================

-- ── 1) 회신 이력 ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_order_replies (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         UUID REFERENCES erp_orders(id) ON DELETE CASCADE,          -- 주문 회신
  consultation_id  UUID REFERENCES erp_consultations(id) ON DELETE CASCADE,   -- 상담 회신(전환 전 처리 불가) 또는 주문의 근거 상담
  result           TEXT NOT NULL CHECK (result IN ('done', 'changed', 'unable')),
  memo             TEXT,
  employee_id      UUID REFERENCES employees(id) ON DELETE SET NULL,          -- 회신한 직원
  employee_name    TEXT,                                                      -- 회신 시점 이름 보존
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (order_id IS NOT NULL OR consultation_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_order_replies_order   ON erp_order_replies (order_id, created_at DESC) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_replies_consult ON erp_order_replies (consultation_id, created_at DESC) WHERE consultation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_replies_created ON erp_order_replies (created_at DESC);

COMMENT ON TABLE erp_order_replies IS
  '완료 회신 이력 (515, 2026-11-05). 주문 · 발주 처리 직원 → 요청자 · 상담자. 최신 회신이 상태, 수정 · 삭제 없음.';

-- ── 2) 회신 대기 아침 알림 보낸 기록 (주문당 1회) ─────────
CREATE TABLE IF NOT EXISTS erp_order_reply_reminders (
  order_id     UUID PRIMARY KEY REFERENCES erp_orders(id) ON DELETE CASCADE,
  reminded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 3) RLS — 서비스 키 경유 API만 (다른 트랙 테이블과 동일) ──
ALTER TABLE erp_order_replies          ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_order_reply_reminders  ENABLE ROW LEVEL SECURITY;

-- ── 검증 (실행 후) ───────────────────────────────────────
-- 기대: 표_기대2 = 2 / 회신_건수_기대0 = 0 / 주문_건수 = 실행 전과 동일
SELECT
  (SELECT COUNT(*) FROM information_schema.tables
    WHERE table_name IN ('erp_order_replies', 'erp_order_reply_reminders')) AS 표_기대2,
  (SELECT COUNT(*) FROM erp_order_replies) AS 회신_건수_기대0,
  (SELECT COUNT(*) FROM erp_orders) AS 주문_건수;
