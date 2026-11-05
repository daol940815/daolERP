-- 902: 업무 요청 담당자 다수 지정 · 진행 방식(선착/공동) — 업무요청 트랙 2차 (docs/work-request-track.md)
--
-- 사용자 결정(2026-11-02): 담당자 다수 지정 · 팀 단위 빠른 선택 · 진행 방식 2가지
--   선착(first): 먼저 수락한 1명이 담당, 나머지는 자동 해제(할 일에서 제거, 참고 표시만)
--   공동(all):   지정된 전원이 각자 수락·진행·보고, 전원 보고 시 요청이 '처리 보고', 요청자가 1회 완료 확정(조기 확정 허용)
--   단일(single): 담당자 1명 — 기존 요청은 전부 이 방식으로 이행
--
-- 요청 전체 상태(work_requests.status)는 담당자별 상태의 집계로 유지한다(목록·알림·경영 현황은 그대로 동작).
-- 담당자별 상태는 work_request_assignees 에 둔다. 서비스 키 경유 API만 접근(RLS).

-- 1) 요청: 진행 방식 + 담당자 열을 NULL 허용 (공동 = NULL, 선착 = 수락자가 정해지면 채움)
ALTER TABLE work_requests ADD COLUMN IF NOT EXISTS assign_mode TEXT NOT NULL DEFAULT 'single'
  CHECK (assign_mode IN ('single', 'first', 'all'));
ALTER TABLE work_requests ALTER COLUMN assignee_id DROP NOT NULL;
COMMENT ON COLUMN work_requests.assign_mode IS 'single=담당자 1명 / first=선착(먼저 수락한 1명) / all=공동(전원 각자)';
COMMENT ON COLUMN work_requests.assignee_id IS '단일·선착 수락자. 공동 요청과 수락 전 선착 요청은 NULL. 담당자 전원은 work_request_assignees.';

-- 2) 담당자별 상태
CREATE TABLE IF NOT EXISTS work_request_assignees (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    UUID NOT NULL REFERENCES work_requests(id) ON DELETE CASCADE,
  employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  status        TEXT NOT NULL DEFAULT 'invited'
                CHECK (status IN ('invited', 'accepted', 'in_progress', 'done_reported', 'rejected', 'released')),
  accepted_at   TIMESTAMPTZ,
  reported_at   TIMESTAMPTZ,
  rejected_at   TIMESTAMPTZ,
  reject_reason TEXT,
  last_memo     TEXT,
  last_memo_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (request_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_wra_employee_status ON work_request_assignees(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_wra_request         ON work_request_assignees(request_id);
ALTER TABLE work_request_assignees ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE work_request_assignees IS '업무 요청 담당자별 상태. invited(미확인)·accepted·in_progress·done_reported·rejected·released(선착에서 다른 사람이 수락).';

-- 3) 기존 요청 이행 — 담당자 1명을 single 방식의 담당자 행으로 (요청 상태에서 담당자 상태를 역산)
INSERT INTO work_request_assignees (request_id, employee_id, status, accepted_at, reported_at, rejected_at, reject_reason, last_memo, last_memo_at, created_at)
SELECT r.id, r.assignee_id,
       CASE r.status
         WHEN 'requested'     THEN 'invited'
         WHEN 'accepted'      THEN 'accepted'
         WHEN 'in_progress'   THEN 'in_progress'
         WHEN 'done_reported' THEN 'done_reported'
         WHEN 'completed'     THEN 'done_reported'
         WHEN 'rejected'      THEN 'rejected'
         WHEN 'canceled'      THEN CASE WHEN r.accepted_at IS NULL THEN 'invited' ELSE 'accepted' END
       END,
       r.accepted_at, r.reported_at, r.rejected_at, r.reject_reason, r.last_memo, r.last_memo_at, r.created_at
FROM work_requests r
WHERE r.assignee_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM work_request_assignees a WHERE a.request_id = r.id AND a.employee_id = r.assignee_id);

-- 4) 이력 종류 확장 — 담당자 추가
ALTER TABLE work_request_events DROP CONSTRAINT IF EXISTS work_request_events_event_check;
ALTER TABLE work_request_events ADD CONSTRAINT work_request_events_event_check
  CHECK (event IN ('created', 'accepted', 'rejected', 'memo', 'reported', 'completed', 'canceled', 'edited', 'assignee_added'));

-- 검증 (실행 후 결과 확인)
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'work_requests' AND column_name = 'assign_mode') AS assign_mode_열_기대1,
  (SELECT is_nullable FROM information_schema.columns WHERE table_name = 'work_requests' AND column_name = 'assignee_id') AS assignee_null허용_기대YES,
  (SELECT count(*) FROM work_requests)                                                      AS 요청_건수,
  (SELECT count(*) FROM work_request_assignees)                                             AS 담당자행_건수_요청과_동일,
  (SELECT count(*) FROM work_requests r WHERE NOT EXISTS (SELECT 1 FROM work_request_assignees a WHERE a.request_id = r.id)) AS 담당자없는요청_기대0,
  (SELECT count(*) FROM pg_constraint WHERE conname = 'work_request_events_event_check'
     AND pg_get_constraintdef(oid) LIKE '%assignee_added%')                                 AS 이력_확장_기대1;
