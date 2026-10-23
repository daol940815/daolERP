-- 900: 업무 요청 (임직원 간 업무 요청·지시 기록) — 업무요청 트랙 1차 (docs/work-request-track.md)
--
-- 사용자 결정(2026-10-15~16): 개인 대상 · 마감 일시 필수 + 긴급 체크 · 담당자 수락/반려(사유 필수) ·
-- 요청자 취소/완료 확정 · 수락·완료 시 업무일지 자동 기재 · 사장님용 전 직원 현황 · 아르바이트 포함 전원 ·
-- 본인 요청 허용 · 자동 완료 없음 · 첨부 없음(관련 링크 1칸) · 알림은 앱 내 배지만.
--
-- 상태: requested → accepted → in_progress → done_reported → completed / canceled / rejected
-- 이력은 work_request_events 에 전부 남긴다 (누가·언제·무엇을·메모). 서비스 키 경유 API만 접근(RLS).

-- 1) 요청
CREATE TABLE IF NOT EXISTS work_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id  UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  assignee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  title         TEXT NOT NULL,
  content       TEXT,
  link          TEXT,                                -- 관련 링크·서버 경로 (첨부 대신)
  due_at        TIMESTAMPTZ NOT NULL,                -- 마감 일시 (필수)
  is_urgent     BOOLEAN NOT NULL DEFAULT false,
  status        TEXT NOT NULL DEFAULT 'requested'
                CHECK (status IN ('requested', 'accepted', 'in_progress', 'done_reported', 'completed', 'canceled', 'rejected')),
  accepted_at   TIMESTAMPTZ,
  reported_at   TIMESTAMPTZ,                         -- 담당자 처리 완료 보고
  completed_at  TIMESTAMPTZ,                         -- 요청자 완료 확정
  canceled_at   TIMESTAMPTZ,
  rejected_at   TIMESTAMPTZ,
  reject_reason TEXT,
  last_memo     TEXT,                                -- 목록 표시용 최근 진행 메모 (이력은 events)
  last_memo_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wr_assignee_status  ON work_requests(assignee_id, status);
CREATE INDEX IF NOT EXISTS idx_wr_requester_status ON work_requests(requester_id, status);
CREATE INDEX IF NOT EXISTS idx_wr_due              ON work_requests(due_at) WHERE status IN ('requested', 'accepted', 'in_progress');
CREATE INDEX IF NOT EXISTS idx_wr_created          ON work_requests(created_at);

COMMENT ON TABLE work_requests IS '임직원 간 업무 요청. 요청자·담당자·마감·상태. 이력은 work_request_events.';

-- 2) 이력
CREATE TABLE IF NOT EXISTS work_request_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID NOT NULL REFERENCES work_requests(id) ON DELETE CASCADE,
  actor_id    UUID REFERENCES employees(id) ON DELETE SET NULL,
  event       TEXT NOT NULL CHECK (event IN ('created', 'accepted', 'rejected', 'memo', 'reported', 'completed', 'canceled', 'edited')),
  memo        TEXT,                                  -- 진행 메모 · 반려 사유 · 수정 요약
  snapshot    JSONB,                                 -- edited: 수정 전 값 (title, content, link, due_at, is_urgent)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wre_request ON work_request_events(request_id, created_at);

-- 3) RLS — 서비스 키 경유 API만 (다른 트랙 테이블과 동일)
ALTER TABLE work_requests        ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_request_events  ENABLE ROW LEVEL SECURITY;

-- 4) 업무일지 자동 기재용 제약 확장 (700 트랙 테이블 — consultation-journal 트랙에 알림)
--    수락 → '업무요청수락', 완료 확정 → '업무요청완료'. ref_type 'work_request' 로 요청 상세에 드릴다운.
ALTER TABLE erp_work_logs DROP CONSTRAINT IF EXISTS erp_work_logs_action_check;
ALTER TABLE erp_work_logs ADD CONSTRAINT erp_work_logs_action_check CHECK (action IN (
  '상담작성', '상담수정', '주문전환', '주문작성', '주문수정', '영업일지', '직접기재',
  '업무요청수락', '업무요청완료'));
ALTER TABLE erp_work_logs DROP CONSTRAINT IF EXISTS erp_work_logs_ref_type_check;
ALTER TABLE erp_work_logs ADD CONSTRAINT erp_work_logs_ref_type_check
  CHECK (ref_type IN ('consultation', 'order', 'activity', 'work_request'));

-- 5) updated_at 자동 갱신
CREATE OR REPLACE FUNCTION work_requests_touch() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_work_requests_touch ON work_requests;
CREATE TRIGGER trg_work_requests_touch BEFORE UPDATE ON work_requests
  FOR EACH ROW EXECUTE FUNCTION work_requests_touch();

-- 검증 (실행 후 결과 확인)
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_name IN ('work_requests', 'work_request_events')) AS 테이블_기대2,
  (SELECT count(*) FROM pg_constraint WHERE conname = 'erp_work_logs_action_check'
     AND pg_get_constraintdef(oid) LIKE '%업무요청수락%') AS 업무일지_action_확장_기대1,
  (SELECT count(*) FROM pg_constraint WHERE conname = 'erp_work_logs_ref_type_check'
     AND pg_get_constraintdef(oid) LIKE '%work_request%') AS 업무일지_ref_type_확장_기대1;
