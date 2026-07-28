-- =====================================================
-- 104_employee_roles_login_id.sql
-- 직원·계정 관리 보완
--  1) 등급 세분화: sales(영업) / manager(중간 관리자) / admin(전체 관리자)
--     - manager: 주문 관리에서 관리자 기능(수정·삭제 승인 등) 가능,
--       회계·경영 모드 접근 불가
--  2) ID 방식 로그인: login_id 저장. 인증은 내부 도메인 이메일
--     (login_id@daol.internal)로 처리하며 화면에는 ID만 노출.
-- =====================================================

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_role_check;
ALTER TABLE employees ADD CONSTRAINT employees_role_check
  CHECK (role IN ('sales', 'manager', 'admin'));

ALTER TABLE employees ADD COLUMN IF NOT EXISTS login_id TEXT UNIQUE;

COMMENT ON COLUMN employees.role IS
  'sales: 주문 관리(본인 업무) / manager: 주문 관리 + 관리자 기능(수정·승인), 회계 접근 불가 / admin: 전체';
COMMENT ON COLUMN employees.login_id IS
  '로그인 ID. 인증 계정 이메일은 login_id@daol.internal 로 자동 구성';
