-- =====================================================
-- 700_work_logs.sql
-- 업무일지 — 계정이 ERP에서 진행한 업무 내용의 자동 기록 + 직접 기재
-- (사용자 확정 2026-08-14, docs/consultation-journal-track.md)
--
-- 목표: 수기 업무일지 대체. 직원은 따로 쓰지 않아도 ERP 행위가 쌓이고,
--       ERP 밖 업무만 직접 한 줄 기재한다. 관리자는 집계로 한눈에 확인.
--
-- 용어 구분 (혼동 주의):
--   상담일지 erp_consultations   — 고객 상담 기록, 주문서로 전환되는 문서
--   영업일지 contact_activities  — 영업자가 직접 쓰는 영업계획·영업내용
--   업무일지 erp_work_logs (여기) — 계정의 ERP 업무 이력 (자동 + 직접 기재)
--
-- 1차 기록 범위: 상담일지 작성·수정·주문전환 / 주문서 작성·수정 / 영업일지 작성
--                + 직접 기재(ERP 밖 업무)
-- =====================================================

-- ── 1) 업무일지 본체 ──────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_work_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date    DATE NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date,
  logged_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- auto: ERP 행위로 시스템이 남긴 줄 (수정 불가)
  -- manual: 직원이 직접 기재한 줄 (본인 수정·삭제 가능)
  source       TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'manual')),
  action       TEXT NOT NULL CHECK (action IN (
                 '상담작성', '상담수정', '주문전환', '주문작성', '주문수정',
                 '영업일지', '직접기재')),
  category     TEXT,                    -- 직접 기재 구분 (회의·출고포장·재고·고객응대·기타)
  content      TEXT NOT NULL,           -- 표시 문구 ("00지점 00담당자와 상담 (주문)")
  -- 원본 드릴다운 (모든 집계는 원본으로 내려갈 수 있어야 한다)
  ref_type     TEXT CHECK (ref_type IN ('consultation', 'order', 'activity')),
  ref_id       UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_logs_emp_date ON erp_work_logs(employee_id, work_date DESC, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_logs_date     ON erp_work_logs(work_date DESC);
CREATE INDEX IF NOT EXISTS idx_work_logs_ref      ON erp_work_logs(ref_type, ref_id) WHERE ref_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_work_logs_updated_at ON erp_work_logs;
CREATE TRIGGER trg_work_logs_updated_at
  BEFORE UPDATE ON erp_work_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE erp_work_logs ENABLE ROW LEVEL SECURITY;   -- 서비스 키 경유 API만 접근

COMMENT ON TABLE erp_work_logs IS
  '업무일지 — 계정이 ERP에서 수행한 업무의 자동 기록(source=auto) + ERP 밖 업무의 직접 기재(source=manual). 영업일지(contact_activities)와 다른 개념.';

-- ── 2) 기존 잠정 구현 이관 (영업일지 → 업무일지) ──────
-- 506에서 상담 저장 시 contact_activities에 '상담' 활동을 자동 기재했다.
-- 상담일지 작성은 "ERP에서 한 업무"이므로 업무일지로 옮긴다 (사용자 확정).
-- 대상은 자동 기재분만 — 내용이 '…와 상담 (구분)' 형식인 '상담' 활동.
-- 직원이 직접 쓴 '상담' 활동은 영업일지에 그대로 둔다.

-- [드라이런] 실행 전 이 SELECT로 이관 대상 건수를 먼저 확인할 것.
--   SELECT count(*) AS 이관대상,
--          count(*) FILTER (WHERE employee_id IS NULL) AS 직원미상_제외분
--     FROM contact_activities
--    WHERE activity_type = '상담' AND content ~ '와 상담 \(.+\)$';

-- 2-1) 업무일지로 복사 (원본 상담일지와 연결 — 인물·날짜·작성자 일치분)
INSERT INTO erp_work_logs (employee_id, work_date, logged_at, source, action, content, ref_type, ref_id, created_at)
SELECT a.employee_id,
       a.activity_date,
       a.created_at,
       'auto',
       '상담작성',
       a.content,
       CASE WHEN c.id IS NOT NULL THEN 'consultation' ELSE NULL END,
       c.id,
       a.created_at
  FROM contact_activities a
  LEFT JOIN LATERAL (
       SELECT x.id
         FROM erp_consultations x
        WHERE x.contact_id = a.contact_id
          AND x.consult_date = a.activity_date
          AND x.employee_id IS NOT DISTINCT FROM a.employee_id
        ORDER BY x.created_at
        LIMIT 1
  ) c ON TRUE
 WHERE a.activity_type = '상담'
   AND a.content ~ '와 상담 \(.+\)$'
   AND a.employee_id IS NOT NULL
   AND NOT EXISTS (                       -- 재실행 대비 (중복 삽입 방지)
       SELECT 1 FROM erp_work_logs w
        WHERE w.source = 'auto' AND w.action = '상담작성'
          AND w.employee_id = a.employee_id
          AND w.work_date   = a.activity_date
          AND w.content     = a.content
   );

-- 2-2) 영업일지에서 자동 기재분 제거 (이관 — 복사가 아님)
DELETE FROM contact_activities a
 WHERE a.activity_type = '상담'
   AND a.content ~ '와 상담 \(.+\)$'
   AND a.employee_id IS NOT NULL;

-- [검증] 이관 후 아래 두 쿼리로 대사할 것.
--   SELECT count(*) FROM erp_work_logs WHERE action = '상담작성';       -- 이관 건수 이상
--   SELECT count(*) FROM contact_activities
--    WHERE activity_type = '상담' AND content ~ '와 상담 \(.+\)$';      -- 0이어야 함

-- 영업일지의 '상담' 활동 유형 자체는 유지한다 — 방문상담 등 직접 기재용으로 유효.
