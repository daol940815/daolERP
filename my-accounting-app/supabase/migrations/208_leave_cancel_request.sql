-- =====================================================
-- 208_leave_cancel_request.sql
-- 인사·총무 트랙 — 승인된 휴가 "취소 요청"
--
-- 2026-11-24 사용자 요청: 승인된 휴가를 직원 본인이 취소하고 싶을 때 화면 안에서 요청할 방법.
-- 승인된 휴가의 취소는 인사·총무 수정 권한자만 한다는 결정(2026-10-12)은 그대로 — 직원은 "요청"만 하고,
-- 인사·총무가 확인 후 기존 "승인 취소"로 처리하거나 요청을 반려한다.
--
-- 흐름: 직원 취소 요청(사유 필수) → pending → 인사·총무 알림
--        → 승인 취소(휴가 status=canceled, 요청 done) 또는 요청 반려(rejected, 회신 사유) · 직원은 pending 중 철회 가능
-- 휴가 원본 행에 요청 정보만 덧붙인다 — 휴가 상태는 인사·총무의 승인 취소로만 바뀐다.
-- (연차 입사일 기준 전환용으로 예정했던 208은 209로 미룬다.)
-- =====================================================

ALTER TABLE attendance_leaves ADD COLUMN IF NOT EXISTS cancel_request_status TEXT
  CHECK (cancel_request_status IS NULL OR cancel_request_status IN ('pending', 'rejected', 'done'));
ALTER TABLE attendance_leaves ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ;
ALTER TABLE attendance_leaves ADD COLUMN IF NOT EXISTS cancel_request_note TEXT;      -- 직원이 적은 취소 사유
ALTER TABLE attendance_leaves ADD COLUMN IF NOT EXISTS cancel_request_reply TEXT;     -- 인사·총무 반려 사유
ALTER TABLE attendance_leaves ADD COLUMN IF NOT EXISTS cancel_replied_by UUID REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE attendance_leaves ADD COLUMN IF NOT EXISTS cancel_replied_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_att_leaves_cancel_req ON attendance_leaves(cancel_requested_at)
  WHERE cancel_request_status = 'pending';

COMMENT ON COLUMN attendance_leaves.cancel_request_status IS
  '승인된 휴가 취소 요청 (208): pending 요청 중 · rejected 반려 · done 승인 취소 처리됨. NULL = 요청 없음(또는 철회)';
