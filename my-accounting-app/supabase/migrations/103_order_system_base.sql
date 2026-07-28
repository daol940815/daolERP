-- =====================================================
-- 103_order_system_base.sql
-- 주문관리 시스템 1단계 — 직원·계정 기반 + 주문 출처 구분
--
-- 1) employees 확장: 담당 배정용 마스터(100)를 직원·계정 관리의 단일
--    마스터로 승격. 관리자가 직원을 등록하면 로그인 계정(auth)을 함께
--    발급하고 auth_user_id로 연결한다. 추후 근태·직원 관리의 기반.
-- 2) erp_orders.source: 'upload'(기존 ERP 파일 업로드) / 'direct'(신규
--    시스템 직접 입력) 구분. 병행 운용과 전환(업로드 경로 제거)의 스위치.
-- =====================================================

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS position     TEXT,           -- 직급 (대리/과장 등)
  ADD COLUMN IF NOT EXISTS phone        TEXT,
  ADD COLUMN IF NOT EXISTS email        TEXT,
  ADD COLUMN IF NOT EXISTS hire_date    DATE,
  ADD COLUMN IF NOT EXISTS role         TEXT NOT NULL DEFAULT 'sales'
    CHECK (role IN ('sales', 'admin')),                 -- sales=주문 관리만, admin=전체
  ADD COLUMN IF NOT EXISTS auth_user_id UUID UNIQUE;    -- Supabase auth.users 연결

COMMENT ON COLUMN employees.role IS 'sales: 주문 관리 모드만 접근 / admin: 회계·경영 관리 포함 전체 접근';
COMMENT ON COLUMN employees.auth_user_id IS '로그인 계정 연결. NULL이면 담당 배정용으로만 등록된 직원(계정 미발급)';

ALTER TABLE erp_orders
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'upload'
    CHECK (source IN ('upload', 'direct'));

CREATE INDEX IF NOT EXISTS idx_erp_orders_source ON erp_orders(source);

COMMENT ON COLUMN erp_orders.source IS 'upload: 기존 ERP 파일 업로드 / direct: 주문관리 시스템 직접 입력';
