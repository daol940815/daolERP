-- =====================================================
-- 204_leave_approval_steps.sql
-- 인사·총무 트랙 — 휴가 3단계 결재(1차 · 2차 · 3차) + 전결
--
-- 2026-11-04 사용자 결정 (docs/attendance-design.md "휴가 3단계 결재"):
--  1. 휴가 결재 권한은 1차 · 2차 · 3차. 숫자가 높을수록 상위(3차 > 2차 > 1차).
--     직원별 단계는 사용자가 직원 · 계정 · 권한 화면에서 직접 설정한다(이 파일은 값을 넣지 않는다).
--     현재 예정: 1차 홍창의 부장 / 2차 옥광일 대표 · 김재형 대표 / 3차 강시현 부사장.
--  2. 전결 = 승인권자 부재 시 다른 사람이 처리. 부재는 시스템이 판정하지 않으므로 자유 선택.
--  3. 신청자는 신청할 때 1차 · 2차를 전결로 넘길 수 있다.
--  4. 3차 전결은 2차 권한자만 할 수 있다(그 건의 2차를 승인한 사람도 가능).
--  5. 신청자 본인 단계 이하는 자동 통과.
--  6. 모든 휴가는 3단계를 거친다. 휴가 목록은 전 직원이 본다.
--
-- 구조:
--  - employees.leave_approve_level — 휴가 결재 단계. NULL = 결재 권한 없음.
--    기존 can_approve(109)는 업무 요청 결재와 공유하므로 건드리지 않고 별도 컬럼으로 둔다.
--  - attendance_leave_steps — 단계별 처리 이력. 한 휴가에 단계당 1행.
--    "지금 몇 차 차례인가"는 저장하지 않는다 — 이력이 없는 가장 낮은 단계가 현재 단계다.
--  - attendance_leaves.status 는 그대로 쓴다. 3차까지 끝나야 approved,
--    그 전에는 requested. 근태 판정 · 스케줄 · 집계 코드는 바뀌지 않는다.
--
-- 기존 데이터: 이미 승인된 휴가는 그대로 approved(이력 없음 = 기존 방식 승인으로 표시).
--             승인 대기 건은 1차부터 다시 시작한다.
-- 실행해도 화면 동작은 바뀌지 않는다 — 코드 배포 전까지는 기존 1단계 승인이 그대로 동작.
-- =====================================================

ALTER TABLE employees ADD COLUMN IF NOT EXISTS leave_approve_level SMALLINT
  CHECK (leave_approve_level IS NULL OR leave_approve_level BETWEEN 1 AND 3);

COMMENT ON COLUMN employees.leave_approve_level IS
  '휴가 결재 단계 1·2·3 (높을수록 상위). NULL = 권한 없음. 설정은 직원·계정·권한 화면(마스터).';

CREATE TABLE IF NOT EXISTS attendance_leave_steps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_id    UUID NOT NULL REFERENCES attendance_leaves(id) ON DELETE CASCADE,
  step        SMALLINT NOT NULL CHECK (step BETWEEN 1 AND 3),
  -- approve 승인(처리자 단계가 더 높으면 화면에 '상위 결재') / reject 반려 /
  -- auto 신청자 본인 단계 이하 자동 통과 / skip 신청자 전결(1·2차만) /
  -- proxy 3차 전결(2차 권한자)
  action      TEXT NOT NULL CHECK (action IN ('approve', 'reject', 'auto', 'skip', 'proxy')),
  actor_id    UUID REFERENCES employees(id) ON DELETE SET NULL,
  actor_level SMALLINT,          -- 처리 당시 처리자의 결재 단계 (나중에 단계가 바뀌어도 이력 유지)
  note        TEXT,              -- 전결 사유 · 반려 사유
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (leave_id, step),
  CHECK (action <> 'skip'  OR step IN (1, 2)),
  CHECK (action <> 'proxy' OR step = 3)
);
CREATE INDEX IF NOT EXISTS idx_att_leave_steps_leave ON attendance_leave_steps(leave_id);

COMMENT ON TABLE attendance_leave_steps IS
  '휴가 단계별 결재 이력 (204). 현재 단계 = 이력이 없는 가장 낮은 단계. 3차 처리 시 attendance_leaves.status=approved.';

-- 접근은 전부 서버 라우트(service role) 경유 — RLS enable, 정책 없음 (200과 동일)
ALTER TABLE attendance_leave_steps ENABLE ROW LEVEL SECURITY;
