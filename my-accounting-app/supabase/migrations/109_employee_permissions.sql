-- =====================================================
-- 109_employee_permissions.sql
-- UI 재조정 1차 — 직원별 영역 권한 (docs/ui-reorg-track.md)
--
-- 목적: 임직원이 회계·재무 자료를 임의로 열람·수정하지 못하도록, 마스터 계정이
--       직원별로 그룹 단위 없음/조회/수정 권한을 부여한다. 메뉴는 업무 영역 기준,
--       노출·접근은 이 데이터로 판정 (담당 변경 = 권한 변경, 배포 없음).
--
-- 1) employees 확장
--    team              영업팀 / 영업지원팀 / 경영지원팀 (기존 자유 텍스트 값 정규화)
--    employment_type   regular(정규) / parttime(아르바이트)
--    work_start/end    아르바이트 근무 기간 — work_end 경과 시 로그인 차단(앱), 재고용 시 갱신
--    is_master         마스터 계정 (전 영역 수정 + 권한 편집). 초기: daol825, master
--    permissions       JSONB {그룹키: 'none'|'view'|'edit'}
--                      그룹키 8: customers(고객·영업) orders(주문·발주) collections(수금·정산)
--                               accounting(회계·재무) closing(결산·세무) tools(점검·정리)
--                               hr(인사·총무) mgmt(경영 현황, view만 의미 있음)
--    can_approve       승인권 (주문 수정·휴가 승인·팀 업무 현황)
--    can_view_salary   급여 정보 열람 (별도 잠금)
--    can_view_payment_info  상담일지 고객 결제정보 열람 (별도 잠금; 없으면 본인 작성분만)
-- 2) employee_permission_logs — 권한 변경 이력 (누가·언제·무엇을)
-- 3) 초기값 — 2026-09-29 확정 표(docs/mockups/업무선택_권한편집_시안.html ③) 이름 기준.
--    이미 permissions가 채워진 행은 건드리지 않는다 (재실행 안전).
-- 4) 사장님 계정: login_id 'master' 직원 행이 없으면 생성 (이름은 화면에서 수정 가능).
--    인증 계정은 직원·계정 관리에서 비밀번호 설정 시 자동 발급.
-- role 컬럼은 하위 호환용으로 유지 (109 미적용 환경 폴백). 홍창의는 admin → manager.
-- =====================================================

-- ── 1) employees 확장 ──────────────────────────────────
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS team                  TEXT,
  ADD COLUMN IF NOT EXISTS employment_type       TEXT NOT NULL DEFAULT 'regular',
  ADD COLUMN IF NOT EXISTS work_start            DATE,
  ADD COLUMN IF NOT EXISTS work_end              DATE,
  ADD COLUMN IF NOT EXISTS is_master             BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS permissions           JSONB   NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS can_approve           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_view_salary       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_view_payment_info BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_employment_type_check;
ALTER TABLE employees ADD CONSTRAINT employees_employment_type_check
  CHECK (employment_type IN ('regular', 'parttime'));

COMMENT ON COLUMN employees.team IS '영업팀 / 영업지원팀 / 경영지원팀';
COMMENT ON COLUMN employees.employment_type IS 'regular=정규, parttime=아르바이트(명절 단기)';
COMMENT ON COLUMN employees.work_end IS '아르바이트 근무 종료일 — 경과 시 로그인 차단, 재고용 시 갱신';
COMMENT ON COLUMN employees.is_master IS '마스터 계정: 전 영역 수정 + 권한 편집. 지정·해제는 마스터만, 자기 자신 해제 불가';
COMMENT ON COLUMN employees.permissions IS
  '{customers|orders|collections|accounting|closing|tools|hr|mgmt: none|view|edit}';

CREATE INDEX IF NOT EXISTS idx_employees_master ON employees(is_master) WHERE is_master;

-- ── 2) 권한 변경 이력 ──────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_permission_logs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  changed_by   UUID        REFERENCES employees(id) ON DELETE SET NULL,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  before_state JSONB       NOT NULL,   -- {team, employment_type, work_start, work_end, is_master, permissions, can_*}
  after_state  JSONB       NOT NULL,
  note         TEXT
);
CREATE INDEX IF NOT EXISTS idx_perm_logs_employee ON employee_permission_logs(employee_id, changed_at DESC);
ALTER TABLE employee_permission_logs ENABLE ROW LEVEL SECURITY;

-- ── 3) 팀 정규화 (기존 자유 텍스트 → 3팀) ──────────────
UPDATE employees SET team = '영업팀'    WHERE name IN ('김재형', '옥광일');
UPDATE employees SET team = '영업지원팀' WHERE name IN ('홍창의', '김주연', '김보현', '김승현', '한정호');
UPDATE employees SET team = '경영지원팀' WHERE name IN ('강시현', '오철준', 'daol825');
UPDATE employees SET team = '테스트'     WHERE login_id IN ('test001', 'test002');

-- ── 4) 사장님 마스터 계정 행 (없을 때만) ───────────────
INSERT INTO employees (name, login_id, role, is_active, attendance_target)
SELECT '사장님', 'master', 'admin', true, false
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE login_id = 'master');

-- ── 5) 초기 권한 (permissions가 비어 있는 행만) ────────
-- 마스터 2: daol825(ERP 총괄) · master(사장님) — 전 영역 수정
UPDATE employees SET
  is_master = true, can_approve = true, can_view_salary = true, can_view_payment_info = true,
  permissions = '{"customers":"edit","orders":"edit","collections":"edit","accounting":"edit","closing":"edit","tools":"edit","hr":"edit","mgmt":"view"}'
WHERE (name = 'daol825' OR login_id = 'master') AND permissions = '{}'::jsonb;

-- 경영지원팀: 강시현(총괄부사장) — 결산 조회, 점검 없음, 승인
UPDATE employees SET
  can_approve = true, can_view_salary = true, can_view_payment_info = true,
  permissions = '{"customers":"edit","orders":"edit","collections":"edit","accounting":"edit","closing":"view","tools":"none","hr":"edit","mgmt":"view"}'
WHERE name = '강시현' AND permissions = '{}'::jsonb;

-- 경영지원팀: 오철준(회계·재무·인사 담당, 마스터 아님)
UPDATE employees SET
  can_approve = true, can_view_salary = true, can_view_payment_info = true,
  permissions = '{"customers":"edit","orders":"edit","collections":"edit","accounting":"edit","closing":"edit","tools":"edit","hr":"edit","mgmt":"view"}'
WHERE name = '오철준' AND permissions = '{}'::jsonb;

-- 영업팀 대표: 영업·주문 수정 + 인사·총무 조회
UPDATE employees SET
  permissions = '{"customers":"edit","orders":"edit","collections":"none","accounting":"none","closing":"none","tools":"none","hr":"view","mgmt":"none"}'
WHERE name IN ('김재형', '옥광일') AND permissions = '{}'::jsonb;

-- 영업지원팀: 고객·주문·수금 수정. 팀장(홍창의) 승인권
UPDATE employees SET
  can_approve = (name = '홍창의'),
  permissions = '{"customers":"edit","orders":"edit","collections":"edit","accounting":"none","closing":"none","tools":"none","hr":"none","mgmt":"none"}'
WHERE name IN ('홍창의', '김주연', '김보현', '김승현', '한정호') AND permissions = '{}'::jsonb;

-- 홍창의: 레거시 role admin → manager (회계 모드 admin 접근 제거, 승인권은 can_approve)
UPDATE employees SET role = 'manager' WHERE name = '홍창의' AND role = 'admin';

-- 테스트 계정: 주문·발주만
UPDATE employees SET
  permissions = '{"customers":"none","orders":"edit","collections":"none","accounting":"none","closing":"none","tools":"none","hr":"none","mgmt":"none"}'
WHERE login_id IN ('test001', 'test002') AND permissions = '{}'::jsonb;

-- 나머지(조현수 등 미확정)는 permissions '{}' 유지 = 전 영역 없음. 권한 패널에서 수동 지정.

-- ── 검증 (실행 후 결과를 보고) ───────────────────────
-- SELECT name, team, role, is_master, can_approve, can_view_salary, can_view_payment_info, permissions
--   FROM employees ORDER BY team NULLS LAST, name;
-- 기대: is_master 2행(daol825·사장님) / team 영업팀 2·영업지원팀 4~5·경영지원팀 3 /
--       permissions '{}' = 조현수(+미등록 한정호 제외) / 홍창의 role=manager
-- SELECT count(*) FROM employee_permission_logs;  -- 0 (초기값은 이력 없음)
