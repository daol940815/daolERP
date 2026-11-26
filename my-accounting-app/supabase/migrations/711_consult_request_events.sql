-- =====================================================
-- 711_consult_request_events.sql
-- 상담일지 주문 진행 요청 이력 — 사용자 승인 2026-11-26 (시안 docs/mockups/상담_요청흐름_시안.html)
--
-- 요청자 → 진행자1 → 진행자2 흐름을 요청자가 볼 수 있게 요청 · 전달 · 재요청 · 취소를 쌓는다.
--   request   처음 요청 (reason = 요청 메모)
--   transfer  진행자가 다른 직원에게 전달 (사유 필수)
--   rerequest 요청자가 다른 직원에게 다시 요청 — 진행자 교체 또는 처리 불가로 되돌아온 뒤 (사유 필수)
--   cancel    요청자가 요청 취소 (사유 선택)
-- 처리 불가 · 주문 입력 · 완료 회신은 기존 기록(erp_order_replies 515 · erp_orders)을 이어 붙여 보여주므로 여기 넣지 않는다.
-- 실행 전 데이터 변경 없음 (테이블 생성만). 미적용이면 기록 없이 요청 · 전달 · 취소는 동작한다.
-- =====================================================

CREATE TABLE IF NOT EXISTS erp_consult_request_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id   UUID NOT NULL REFERENCES erp_consultations(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL CHECK (kind IN ('request', 'transfer', 'rerequest', 'cancel')),
  from_employee_id  UUID REFERENCES employees(id) ON DELETE SET NULL,   -- 이전 진행자 (처음 요청이면 NULL)
  to_employee_id    UUID REFERENCES employees(id) ON DELETE SET NULL,   -- 새 진행자 (취소면 NULL)
  by_employee_id    UUID REFERENCES employees(id) ON DELETE SET NULL,   -- 한 사람
  by_name           TEXT,                                                -- 그 시점 이름 보존
  reason            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consult_request_events ON erp_consult_request_events(consultation_id, created_at);
ALTER TABLE erp_consult_request_events ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE erp_consult_request_events IS '상담 주문 진행 요청 이력 — 요청 · 전달 · 재요청 · 취소 (711)';

-- 검증: 테이블_기대1 = 1
SELECT COUNT(*) AS 테이블_기대1
  FROM information_schema.tables
 WHERE table_name = 'erp_consult_request_events';
