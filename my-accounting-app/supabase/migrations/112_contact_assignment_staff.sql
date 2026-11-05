-- =====================================================
-- 112_contact_assignment_staff.sql  (매출처 허브 대역 — 주문 트랙 세션에서 작성, 고객관리 · 주문 트랙 문서에 기록)
-- 2026-11-05 사용자 확정: "데이터는 무조건 은행 - 지점 - 고객의 담당자가 기입되어야 해"
--
-- 다올 담당(자사 영업 직원)을 고객 배정(지점 × 고객 인물) 단위로 저장한다.
--  - 원본 = contact_assignments.staff_employee_id 한 곳. 지점 담당(vendor_staff)으로 대신 채우지 않는다
--  - 주문의 상담자 = 그 주문 지점 · 고객의 다올 담당 (주문서가 자동으로 채움)
--  - 비어 있는 고객은 주문 입력 시 상담자를 직접 고르면 그 사람이 다올 담당으로 자동 저장 (빈 경우만, 기존 값 덮어쓰지 않음)
--  - 사용자가 직접 고객을 등록 · 배정할 때(매출처) 다올 담당 선택 필수 — 앱에서 검사
--  - 처음 값은 고객관리문서 스냅샷(doc_sales_snapshot.daol_staff)으로 채움 — supabase/checks/contact_staff_backfill.sql
-- 데이터 변경 없음 (컬럼 추가만)
-- =====================================================

ALTER TABLE contact_assignments
  ADD COLUMN IF NOT EXISTS staff_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL;  -- 다올 담당

COMMENT ON COLUMN contact_assignments.staff_employee_id IS
  '다올 담당(자사 영업) — 은행 · 지점 · 고객 단위. 주문 상담자의 원천 (112, 2026-11-05)';

CREATE INDEX IF NOT EXISTS idx_contact_asgn_staff
  ON contact_assignments (staff_employee_id) WHERE ended_at IS NULL;

-- ── 검증 (실행 후) ───────────────────────────────────────
-- 기대: 다올담당컬럼_기대1 = 1 / 인덱스_기대1 = 1 / 현재배정_건수 = 실행 전과 동일
SELECT
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name = 'contact_assignments' AND column_name = 'staff_employee_id') AS 다올담당컬럼_기대1,
  (SELECT COUNT(*) FROM pg_indexes
    WHERE tablename = 'contact_assignments' AND indexname = 'idx_contact_asgn_staff') AS 인덱스_기대1,
  (SELECT COUNT(*) FROM contact_assignments WHERE ended_at IS NULL) AS 현재배정_건수;
