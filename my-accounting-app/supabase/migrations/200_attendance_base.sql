-- =====================================================
-- 200_attendance_base.sql
-- 인사·근태 트랙 1단계 — 출퇴근 기록 + 휴가 신청·승인 + 근태 정책
-- (번호 규칙: 인사·근태 트랙은 200번대 사용)
--
-- 원칙:
--  - 직원 마스터는 employees 단일 테이블. 새 직원 테이블을 만들지 않고
--    근태 대상 여부(attendance_target) 컬럼만 추가한다.
--  - 상태(지각·결근 등)는 저장하지 않는다 — 정책·기록·휴가에서 자동 판정.
--  - 관리자 보정은 덮어쓰되 edited_by·edit_note로 감사 이력을 남긴다.
--  - 접근은 전부 서버 라우트(service role) 경유 — RLS enable, 정책 없음
--    (기존 100번대 테이블과 동일한 패턴).
-- =====================================================

-- 1) 근태 대상 여부 — 거래처 엑셀 적재로 들어온 로그인 계정 없는
--    직원(상담자)은 기본 제외하고, 직원·계정 관리 화면에서 개별 변경한다.
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS attendance_target BOOLEAN NOT NULL DEFAULT true;

UPDATE employees SET attendance_target = false WHERE auth_user_id IS NULL;

COMMENT ON COLUMN employees.attendance_target IS
  '근태 관리 대상 여부. 기본: 로그인 계정 보유자만 대상. 근태 현황 화면에서 변경 가능';

-- 2) 출퇴근 기록 — 직원·날짜당 1행. 본인 웹 체크 또는 관리자 입력.
CREATE TABLE IF NOT EXISTS attendance_records (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date    DATE NOT NULL,                -- KST 기준 근무일
  check_in_at  TIMESTAMPTZ,
  check_out_at TIMESTAMPTZ,
  source       TEXT NOT NULL DEFAULT 'self'
    CHECK (source IN ('self', 'admin')),     -- self: 본인 체크 / admin: 관리자 입력
  edited_by    UUID REFERENCES employees(id) ON DELETE SET NULL,  -- 관리자 보정자
  edited_at    TIMESTAMPTZ,
  edit_note    TEXT,                          -- 보정 사유 (관리자 보정 시 필수)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_att_records_date     ON attendance_records(work_date);
CREATE INDEX IF NOT EXISTS idx_att_records_employee ON attendance_records(employee_id, work_date);

-- 3) 휴가 신청·승인 — 직원이 신청, 중간 관리자·전체 관리자가 승인.
--    반차(half_am/half_pm)는 하루짜리(start=end)만 허용(서버에서 검증).
CREATE TABLE IF NOT EXISTS attendance_leaves (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type  TEXT NOT NULL
    CHECK (leave_type IN ('annual', 'half_am', 'half_pm', 'sick', 'official', 'other')),
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'approved', 'rejected', 'canceled')),
  decided_by  UUID REFERENCES employees(id) ON DELETE SET NULL,   -- 승인·반려자
  decided_at  TIMESTAMPTZ,
  decide_note TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_att_leaves_employee ON attendance_leaves(employee_id, start_date);
CREATE INDEX IF NOT EXISTS idx_att_leaves_status   ON attendance_leaves(status) WHERE status = 'requested';
CREATE INDEX IF NOT EXISTS idx_att_leaves_range    ON attendance_leaves(start_date, end_date)
  WHERE status IN ('requested', 'approved');

-- 4) 근태 정책 — 단일 행. 지각 판정 기준(출근 시각 + 유예)에 사용.
CREATE TABLE IF NOT EXISTS attendance_policy (
  id             SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  work_start     TIME NOT NULL DEFAULT '09:00',
  work_end       TIME NOT NULL DEFAULT '18:00',
  late_grace_min INT  NOT NULL DEFAULT 0 CHECK (late_grace_min >= 0),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO attendance_policy (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_leaves  ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_policy  ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE attendance_records IS
  '출퇴근 기록. 직원·날짜당 1행. 지각·결근 등 상태는 저장하지 않고 정책·휴가와 조합해 자동 판정.';
COMMENT ON TABLE attendance_leaves IS
  '휴가 신청·승인 이력. requested → approved/rejected/canceled. 반차는 하루짜리만.';
COMMENT ON TABLE attendance_policy IS
  '근태 정책 (단일 행). 출근 기준 시각 + 유예(분)로 지각을 판정.';
