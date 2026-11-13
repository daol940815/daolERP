-- =====================================================
-- 709_consultation_close_delete_reason.sql
-- 상담일지 종결 · 삭제 사유와 처리 기록 (사용자 확정 2026-11-10, 시안 승인)
--
-- 1) 종결: 사유 필수 + 종결한 직원 · 시각 저장. 종결된 상담은 수정 잠금(재개해야 수정).
--    재개하면 closed_* 를 비우고, 이전 종결 사유는 업무일지(erp_work_logs)에 남긴다.
-- 2) 삭제: 물리 삭제를 그만두고 숨김 삭제 — deleted_at 이 있으면 목록 · 알림에서 빠진다.
--    삭제 사유 필수 + 삭제한 직원 · 시각 저장. 행 · 품목은 그대로 보존된다(원본 보존 원칙).
--    상태 CHECK(진행중 · 주문전환 · 종결)는 바꾸지 않는다 — 삭제는 상태값이 아니라 별도 열.
--
-- 기존 데이터: 모두 NULL (이미 종결된 상담은 사유 기록 없음으로 보인다). 재실행 안전 (IF NOT EXISTS).
-- =====================================================

ALTER TABLE erp_consultations
  ADD COLUMN IF NOT EXISTS closed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by     UUID REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS close_reason  TEXT,
  ADD COLUMN IF NOT EXISTS deleted_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by    UUID REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT;

COMMENT ON COLUMN erp_consultations.closed_at     IS '종결 시각 — 상태가 종결일 때만 값 (709)';
COMMENT ON COLUMN erp_consultations.closed_by     IS '종결한 직원 (709)';
COMMENT ON COLUMN erp_consultations.close_reason  IS '종결 사유 — "빠른 선택 · 덧붙인 글" (709)';
COMMENT ON COLUMN erp_consultations.deleted_at    IS '숨김 삭제 시각 — 값이 있으면 목록 · 알림에서 제외 (709)';
COMMENT ON COLUMN erp_consultations.deleted_by    IS '삭제한 직원 (709)';
COMMENT ON COLUMN erp_consultations.delete_reason IS '삭제 사유 (709)';

-- 목록은 대부분 삭제 안 된 행만 본다
CREATE INDEX IF NOT EXISTS idx_consultations_not_deleted ON erp_consultations(consult_date DESC) WHERE deleted_at IS NULL;

-- 검증 (실행 후):
-- SELECT column_name, data_type
--   FROM information_schema.columns
--  WHERE table_name = 'erp_consultations'
--    AND column_name IN ('closed_at', 'closed_by', 'close_reason', 'deleted_at', 'deleted_by', 'delete_reason')
--  ORDER BY column_name;   -- 6행이어야 함
