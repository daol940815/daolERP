-- =====================================================
-- employee_hire_date_from_excel_1_dryrun.sql — 드라이런 (조회만, 바꾸는 것 없음)
-- 2026-11-18 사용자 요청: 로그인 계정 없는 직원 4명의 입사일을 "2026 연차" 엑셀 요약 시트 값으로 채운다.
-- 원칙: 이미 입력된 입사일은 덮어쓰지 않는다(CLAUDE.md "기확정 값은 덮어쓰지 않는다") — 비어 있을 때만 채움.
-- 결과 "처리" 칸: 채움 / 같음(할 일 없음) / 다름 — 덮어쓰지 않음(알려주세요) / 없음 · 동명이인(실행 시 건너뜀)
-- =====================================================
WITH excel(name, hire_date) AS (VALUES
  ('정이경', DATE '2018-11-26'),
  ('이동훈', DATE '2020-07-03'),
  ('구본신', DATE '2023-08-01'),
  ('오연수', DATE '2026-06-01')
),
m AS (
  SELECT x.name, x.hire_date AS 엑셀_입사일, e.hire_date AS 현재_입사일, count(*) OVER (PARTITION BY x.name) AS n, e.id
  FROM excel x LEFT JOIN employees e ON e.name = x.name AND e.is_active
)
SELECT name AS 이름, 엑셀_입사일, 현재_입사일,
  CASE WHEN id IS NULL THEN '없음 — 건너뜀'
       WHEN n > 1 THEN '동명이인 — 건너뜀'
       WHEN 현재_입사일 IS NULL THEN '채움'
       WHEN 현재_입사일 = 엑셀_입사일 THEN '같음 (할 일 없음)'
       ELSE '다름 — 덮어쓰지 않음(알려주세요)' END AS 처리
FROM m ORDER BY name;
