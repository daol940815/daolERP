-- =====================================================
-- contact_staff_backfill_run.sql — 고객별 다올 담당 채우기 실행 + 검증 (한 번에 전체 실행)
-- 2026-11-05 드라이런 회신: 매출처 현재 배정 1,598 · 채워질 1,574 · 이미 값 0 · 상충 0 · 이름 불일치 0 · 문서에 없음 24
-- 기존 값은 덮어쓰지 않으며(빈 칸만), 다시 실행해도 결과 같음.
-- 기대: 채워진_배정 = 1574 / 미기입_남음 = 24 / 매출처_현재배정_전체 = 1598
-- =====================================================

WITH doc AS (
  SELECT vendor_id, contact_id, REPLACE(TRIM(daol_staff), ' ', '') AS staff_name
  FROM doc_sales_snapshot
  WHERE vendor_id IS NOT NULL AND contact_id IS NOT NULL AND COALESCE(TRIM(daol_staff), '') <> ''
),
pair AS (
  SELECT vendor_id, contact_id, MIN(staff_name) AS staff_name FROM doc
  GROUP BY vendor_id, contact_id HAVING COUNT(DISTINCT staff_name) = 1
),
emp AS (
  SELECT REPLACE(name, ' ', '') AS key, MIN(id::text)::uuid AS id FROM employees
  GROUP BY REPLACE(name, ' ', '') HAVING COUNT(*) = 1
)
UPDATE contact_assignments a
SET staff_employee_id = e.id
FROM pair p JOIN emp e ON e.key = p.staff_name
WHERE a.vendor_id = p.vendor_id AND a.contact_id = p.contact_id
  AND a.ended_at IS NULL AND a.staff_employee_id IS NULL;

-- 검증
SELECT
  (SELECT COUNT(*) FROM contact_assignments a JOIN vendors v ON v.id = a.vendor_id
    WHERE a.ended_at IS NULL AND v.type IN ('customer', 'both')) AS 매출처_현재배정_전체,
  (SELECT COUNT(*) FROM contact_assignments a JOIN vendors v ON v.id = a.vendor_id
    WHERE a.ended_at IS NULL AND v.type IN ('customer', 'both') AND a.staff_employee_id IS NOT NULL) AS 채워진_배정,
  (SELECT COUNT(*) FROM contact_assignments a JOIN vendors v ON v.id = a.vendor_id
    WHERE a.ended_at IS NULL AND v.type IN ('customer', 'both') AND a.staff_employee_id IS NULL) AS 미기입_남음;

-- 표본: 다올 담당별 고객 수 (고객관리문서 다올 담당 분포와 대조)
SELECT e.name AS 다올담당, COUNT(*) AS 고객수
FROM contact_assignments a JOIN employees e ON e.id = a.staff_employee_id
WHERE a.ended_at IS NULL GROUP BY e.name ORDER BY 2 DESC;

-- 미기입으로 남는 24건 (허브 상세 또는 담당자 관리 '다올 담당 미기입' 카드에서 지정)
SELECT v.name AS 지점, c.name AS 고객, a.title AS 직함
FROM contact_assignments a
JOIN vendors v ON v.id = a.vendor_id AND v.type IN ('customer', 'both')
JOIN contacts c ON c.id = a.contact_id
WHERE a.ended_at IS NULL AND a.staff_employee_id IS NULL
ORDER BY v.name, c.name;
