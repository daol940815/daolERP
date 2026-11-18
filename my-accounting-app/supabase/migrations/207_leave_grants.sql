-- =====================================================
-- 207_leave_grants.sql
-- 인사·총무 트랙 — 연차 관리 (부여 원장 · 휴가 출처 · 반차 미기재)
--
-- 2026-11-18 사용자 결정 (docs/hr-track.md "연차 관리"):
--  - 부여는 원장으로 관리: 기본(연초 법정) · 보상(주말근무 등) · 이월(지난해 남은 보상) · 조정(정정, +/-).
--    잘못 넣은 부여는 지우지 않고 취소 상태로 남긴다.
--  - 사용은 저장하지 않는다 — 승인된 휴가 중 연차 · 오전 반차 · 오후 반차 · 반차(미기재) · 병가에서 계산.
--    공가(경조 · 예비군) · 무급휴가 · 기타는 차감하지 않는다.
--  - 사용 순서: 기본 먼저, 넘치면 보상(보상 + 이월). 그래도 넘치면 초과로 표시(막지 않음 — 경고만).
--  - 남은 기본 연차는 연말 소멸, 보상 연차만 다음 해로 이월(연초 정리에서 추천 → 인사·총무 확정).
--  - 휴가 출처: request(본인 신청) · proxy(인사·총무 대리 등록 — 로그인 계정 없는 직원, 바로 승인) ·
--    excel(기존 엑셀 이관).
--  - leave_type 'half' = 반차(오전 · 오후 미기재) — 엑셀 이관 전용. 신청 양식에는 나오지 않는다.
-- =====================================================

CREATE TABLE IF NOT EXISTS attendance_leave_grants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  year         SMALLINT NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  kind         TEXT NOT NULL CHECK (kind IN ('base', 'comp', 'carry', 'adjust')),
  days         NUMERIC(5,1) NOT NULL,
  grant_date   DATE NOT NULL,
  reason       TEXT,
  source       TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'excel', 'recommend')),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled')),
  canceled_by  UUID REFERENCES employees(id) ON DELETE SET NULL,
  canceled_at  TIMESTAMPTZ,
  cancel_note  TEXT,
  created_by   UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (kind = 'adjust' OR days > 0),
  CHECK (days <> 0)
);
CREATE INDEX IF NOT EXISTS idx_leave_grants_emp_year ON attendance_leave_grants(employee_id, year) WHERE status = 'active';

COMMENT ON TABLE attendance_leave_grants IS
  '연차 부여 원장 (207). 사용은 승인된 휴가에서 계산. 취소는 status=canceled 로 남긴다.';

ALTER TABLE attendance_leaves ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'request';
ALTER TABLE attendance_leaves DROP CONSTRAINT IF EXISTS attendance_leaves_source_check;
ALTER TABLE attendance_leaves ADD CONSTRAINT attendance_leaves_source_check
  CHECK (source IN ('request', 'proxy', 'excel'));
ALTER TABLE attendance_leaves ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES employees(id) ON DELETE SET NULL;
COMMENT ON COLUMN attendance_leaves.source IS '출처: request 본인 신청 · proxy 인사·총무 대리 등록 · excel 엑셀 이관 (207)';
COMMENT ON COLUMN attendance_leaves.created_by IS '등록한 사람 (대리 등록 · 이관). 본인 신청은 NULL 가능';

-- 반차(오전 · 오후 미기재) — 엑셀 이관 전용
ALTER TABLE attendance_leaves DROP CONSTRAINT IF EXISTS attendance_leaves_leave_type_check;
ALTER TABLE attendance_leaves ADD CONSTRAINT attendance_leaves_leave_type_check
  CHECK (leave_type IN ('annual', 'half_am', 'half_pm', 'half', 'sick', 'official', 'unpaid', 'other'));

-- 접근은 전부 서버 라우트(service role) 경유 — RLS enable, 정책 없음 (200과 동일)
ALTER TABLE attendance_leave_grants ENABLE ROW LEVEL SECURITY;
