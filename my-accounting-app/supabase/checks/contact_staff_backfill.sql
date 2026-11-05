-- =====================================================
-- contact_staff_backfill.sql  (데이터 작업 — 112 실행 후)
-- 2026-11-05 사용자 승인. 고객관리문서 스냅샷(doc_sales_snapshot, 2026-11-02판)의 고객별 "다올 담당"으로
-- 현재 고객 배정(contact_assignments, ended_at IS NULL)의 다올 담당(staff_employee_id)을 채운다.
--  - 이미 값이 있는 배정은 건드리지 않는다 (기확정 값 보존)
--  - 같은 지점 · 고객에 문서 행이 여럿이고 다올 담당이 서로 다르면 채우지 않고 목록으로 보고
--  - 직원 이름은 공백 제거 후 employees.name과 일치해야 함 (불일치는 목록으로 보고)
-- 실행 순서: [1] 드라이런 결과 회신 → [2] 실행 → [3] 검증
-- =====================================================

-- ── [1] 드라이런 (쓰기 없음) ─────────────────────────────
-- [1-1] 요약
WITH doc AS (
  SELECT vendor_id, contact_id, REPLACE(TRIM(daol_staff), ' ', '') AS staff_name
  FROM doc_sales_snapshot
  WHERE vendor_id IS NOT NULL AND contact_id IS NOT NULL AND COALESCE(TRIM(daol_staff), '') <> ''
),
pair AS (
  SELECT vendor_id, contact_id, MIN(staff_name) AS staff_name, COUNT(DISTINCT staff_name) AS n_staff
  FROM doc GROUP BY vendor_id, contact_id
),
emp AS (
  SELECT REPLACE(name, ' ', '') AS key, MIN(id::text)::uuid AS id, COUNT(*) AS n
  FROM employees GROUP BY REPLACE(name, ' ', '')
),
target AS (
  SELECT a.id AS assignment_id, p.staff_name, p.n_staff, e.id AS employee_id, e.n AS n_emp, a.staff_employee_id
  FROM contact_assignments a
  JOIN pair p ON p.vendor_id = a.vendor_id AND p.contact_id = a.contact_id
  LEFT JOIN emp e ON e.key = p.staff_name
  WHERE a.ended_at IS NULL
)
SELECT
  (SELECT COUNT(*) FROM contact_assignments a JOIN vendors v ON v.id = a.vendor_id
    WHERE a.ended_at IS NULL AND v.type IN ('customer', 'both')) AS 매출처_현재배정_전체,
  (SELECT COUNT(*) FROM target WHERE staff_employee_id IS NULL AND n_staff = 1 AND employee_id IS NOT NULL AND n_emp = 1) AS 채워질_배정,
  (SELECT COUNT(*) FROM target WHERE staff_employee_id IS NOT NULL) AS 이미_값있음_유지,
  (SELECT COUNT(*) FROM target WHERE n_staff > 1) AS 문서_담당_서로다름_보류,
  (SELECT COUNT(*) FROM target WHERE n_staff = 1 AND (employee_id IS NULL OR n_emp > 1)) AS 직원이름_불일치_보류,
  (SELECT COUNT(*) FROM contact_assignments a JOIN vendors v ON v.id = a.vendor_id
    WHERE a.ended_at IS NULL AND v.type IN ('customer', 'both') AND a.staff_employee_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM target t WHERE t.assignment_id = a.id)) AS 문서에_없음_미기입으로_남음;

-- [1-2] 보류 목록 (문서 담당 서로 다름 · 직원 이름 불일치) — 회신 시 함께 확인
WITH doc AS (
  SELECT vendor_id, contact_id, REPLACE(TRIM(daol_staff), ' ', '') AS staff_name, bank_name, branch_name, manager_name
  FROM doc_sales_snapshot
  WHERE vendor_id IS NOT NULL AND contact_id IS NOT NULL AND COALESCE(TRIM(daol_staff), '') <> ''
)
SELECT d.bank_name AS 은행, d.branch_name AS 지점, d.manager_name AS 고객, STRING_AGG(DISTINCT d.staff_name, ', ') AS 문서_다올담당,
       CASE WHEN COUNT(DISTINCT d.staff_name) > 1 THEN '문서 담당 서로 다름' ELSE '직원 이름 불일치' END AS 사유
FROM doc d
JOIN contact_assignments a ON a.vendor_id = d.vendor_id AND a.contact_id = d.contact_id AND a.ended_at IS NULL
WHERE a.staff_employee_id IS NULL
GROUP BY d.vendor_id, d.contact_id, d.bank_name, d.branch_name, d.manager_name
HAVING COUNT(DISTINCT d.staff_name) > 1
    OR NOT EXISTS (SELECT 1 FROM employees e WHERE REPLACE(e.name, ' ', '') = MIN(d.staff_name))
ORDER BY 1, 2, 3;


-- ── [2] 실행 ([1] 확인 후, 주석 해제해 실행) ─────────────
-- WITH doc AS (
--   SELECT vendor_id, contact_id, REPLACE(TRIM(daol_staff), ' ', '') AS staff_name
--   FROM doc_sales_snapshot
--   WHERE vendor_id IS NOT NULL AND contact_id IS NOT NULL AND COALESCE(TRIM(daol_staff), '') <> ''
-- ),
-- pair AS (
--   SELECT vendor_id, contact_id, MIN(staff_name) AS staff_name FROM doc
--   GROUP BY vendor_id, contact_id HAVING COUNT(DISTINCT staff_name) = 1
-- ),
-- emp AS (
--   SELECT REPLACE(name, ' ', '') AS key, MIN(id::text)::uuid AS id FROM employees
--   GROUP BY REPLACE(name, ' ', '') HAVING COUNT(*) = 1
-- )
-- UPDATE contact_assignments a
-- SET staff_employee_id = e.id
-- FROM pair p JOIN emp e ON e.key = p.staff_name
-- WHERE a.vendor_id = p.vendor_id AND a.contact_id = p.contact_id
--   AND a.ended_at IS NULL AND a.staff_employee_id IS NULL;


-- ── [3] 검증 ([2] 실행 후) ──────────────────────────────
-- 기대: 채워진_배정 = [1-1]의 채워질_배정 + 이미_값있음_유지 / 미기입_남음 = 전체 − 채워진_배정
-- SELECT
--   (SELECT COUNT(*) FROM contact_assignments a JOIN vendors v ON v.id = a.vendor_id
--     WHERE a.ended_at IS NULL AND v.type IN ('customer', 'both')) AS 매출처_현재배정_전체,
--   (SELECT COUNT(*) FROM contact_assignments a JOIN vendors v ON v.id = a.vendor_id
--     WHERE a.ended_at IS NULL AND v.type IN ('customer', 'both') AND a.staff_employee_id IS NOT NULL) AS 채워진_배정,
--   (SELECT COUNT(*) FROM contact_assignments a JOIN vendors v ON v.id = a.vendor_id
--     WHERE a.ended_at IS NULL AND v.type IN ('customer', 'both') AND a.staff_employee_id IS NULL) AS 미기입_남음;
-- 표본: 다올 담당별 고객 수
-- SELECT e.name AS 다올담당, COUNT(*) AS 고객수
-- FROM contact_assignments a JOIN employees e ON e.id = a.staff_employee_id
-- WHERE a.ended_at IS NULL GROUP BY e.name ORDER BY 2 DESC;
