-- =====================================================
-- employee_hire_date_from_excel_2_run.sql — 실행 (드라이런 확인 후)
-- 입사일이 비어 있고 이름이 한 명만 맞는 직원만 채운다. 이미 값이 있으면 그대로 둔다. 두 번 실행해도 안전하다.
-- 마지막 결과 표가 실행 후 상태(검증)다 — 4명 모두 "엑셀과 같음"이면 완료.
-- =====================================================
BEGIN;

WITH excel(name, hire_date) AS (VALUES
  ('정이경', DATE '2018-11-26'),
  ('이동훈', DATE '2020-07-03'),
  ('구본신', DATE '2023-08-01'),
  ('오연수', DATE '2026-06-01')
),
one AS (
  SELECT x.name, x.hire_date, min(e.id::text)::uuid AS id
  FROM excel x JOIN employees e ON e.name = x.name AND e.is_active
  GROUP BY x.name, x.hire_date HAVING count(*) = 1
)
UPDATE employees e SET hire_date = one.hire_date
FROM one WHERE e.id = one.id AND e.hire_date IS NULL;

COMMIT;

WITH excel(name, hire_date) AS (VALUES
  ('정이경', DATE '2018-11-26'),
  ('이동훈', DATE '2020-07-03'),
  ('구본신', DATE '2023-08-01'),
  ('오연수', DATE '2026-06-01')
)
SELECT x.name AS 이름, x.hire_date AS 엑셀_입사일, e.hire_date AS 현재_입사일,
  CASE WHEN e.id IS NULL THEN '직원 없음' WHEN e.hire_date = x.hire_date THEN '엑셀과 같음' ELSE '다름 — 확인 필요' END AS 검증
FROM excel x LEFT JOIN employees e ON e.name = x.name AND e.is_active
ORDER BY x.name;
