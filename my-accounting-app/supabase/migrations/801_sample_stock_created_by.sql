-- =====================================================
-- 801_sample_stock_created_by.sql
-- 샘플 재고 입력 계정 로그 (2026-08-24 사용자 확정)
--
-- 샘플 재고 화면을 주문 포털(전 직원)로 이동하면서, 입출고·실사 입력을
-- 어느 로그인 계정이 했는지 행마다 기록한다.
-- - created_by_employee_id: 입력 계정의 직원 마스터 연결 (로그인 세션에서 자동)
-- - created_by_name: 입력 시점 이름 스냅샷 (직원 정보가 바뀌어도 감사 기록 보존.
--   직원 미연결 관리자 계정은 이메일 기록)
-- 담당 직원(employee_id·staff_name)은 "누구 몫의 출고인가"이고,
-- created_by는 "누가 입력했는가" — 서로 다른 개념이라 별도 컬럼.
-- 이관분(source=excel)은 시스템 적재라 NULL 유지.
-- =====================================================

ALTER TABLE erp_sample_moves
  ADD COLUMN IF NOT EXISTS created_by_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by_name TEXT;

ALTER TABLE erp_sample_stocktakes
  ADD COLUMN IF NOT EXISTS created_by_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by_name TEXT;

COMMENT ON COLUMN erp_sample_moves.created_by_employee_id IS
  '입력한 로그인 계정의 직원 (감사 로그). 담당 직원 employee_id와 별개.';
COMMENT ON COLUMN erp_sample_moves.created_by_name IS
  '입력 시점 계정 이름 스냅샷 (직원 미연결 계정은 이메일).';
COMMENT ON COLUMN erp_sample_stocktakes.created_by_employee_id IS
  '실사를 입력한 로그인 계정의 직원 (감사 로그).';
COMMENT ON COLUMN erp_sample_stocktakes.created_by_name IS
  '입력 시점 계정 이름 스냅샷.';
