-- =====================================================
-- leave_import_2026_3_verify.sql — 검증 (실행 후, 조회만)
-- 2026 연차 엑셀 → ERP 이관 (docs/hr-track.md "연차 관리", 2026-11-18 사용자 결정)
-- 원본: 사용자 제공 "2026 연차" 엑셀 (2026-11-18 받은 파일). 생성 스크립트로 만든 파일 — 손으로 고치지 말 것.
-- 제외: 이지원 · 김대희(퇴사) · 박강용 (사용자 지시). 칭찬/지적 일지 · 연장근무(2026 입력 없음)는 옮기지 않음.
-- 선행: 206 · 207 실행, 대상 직원이 employees 에 같은 이름으로 등록(재직)되어 있어야 함.
-- 사람별로 ERP 계산값과 엑셀 요약 시트 값을 대조한다. 차이 칸이 모두 0 이어야 완료.
-- 사용은 이관된 휴가(source=excel)만 센다 — 이관 후 새로 신청한 휴가는 대조에서 뺀다.
-- =====================================================

WITH excel_people(name, base_days, comp_total, used_total) AS (VALUES
  ('김재형', 19::numeric, 0::numeric, 18::numeric),
  ('강시현', 17::numeric, 2::numeric, 16.5::numeric),
  ('옥광일', 18::numeric, 0.5::numeric, 14.5::numeric),
  ('정이경', 18::numeric, 0::numeric, 11::numeric),
  ('홍창의', 17::numeric, 7.5::numeric, 18.5::numeric),
  ('이동훈', 17::numeric, 1.5::numeric, 14::numeric),
  ('김주연', 16::numeric, 1.5::numeric, 16.5::numeric),
  ('오철준', 15::numeric, 5::numeric, 15::numeric),
  ('김보현', 15::numeric, 1::numeric, 17.5::numeric),
  ('주삼재', 16::numeric, 1.5::numeric, 14::numeric),
  ('최효순', 16::numeric, 1::numeric, 14::numeric),
  ('구본신', 15::numeric, 0::numeric, 14::numeric),
  ('오연수', 6::numeric, 0::numeric, 6.5::numeric),
  ('김승현', 6::numeric, 1::numeric, 4::numeric),
  ('한정호', 4::numeric, 0::numeric, 3::numeric)
),
emp AS (SELECT id, name FROM employees WHERE is_active),
g AS (
  SELECT employee_id,
    sum(days) FILTER (WHERE kind = 'base') AS base,
    sum(days) FILTER (WHERE kind IN ('comp','carry')) AS comp
  FROM attendance_leave_grants WHERE year = 2026 AND status = 'active' AND source = 'excel' GROUP BY employee_id
),
u AS (
  SELECT employee_id, sum(CASE leave_type WHEN 'half' THEN 0.5 WHEN 'half_am' THEN 0.5 WHEN 'half_pm' THEN 0.5 ELSE 1 END) AS used
  FROM attendance_leaves WHERE source = 'excel' AND status = 'approved'
    AND leave_type IN ('annual','half','half_am','half_pm','sick') GROUP BY employee_id
)
SELECT ep.name AS 이름,
  coalesce(g.base,0) AS 기본, ep.base_days AS 엑셀_기본, coalesce(g.base,0) - ep.base_days AS 차이_기본,
  coalesce(g.comp,0) AS 보상, ep.comp_total AS 엑셀_보상, coalesce(g.comp,0) - ep.comp_total AS 차이_보상,
  coalesce(u.used,0) AS 사용, ep.used_total AS 엑셀_사용, coalesce(u.used,0) - ep.used_total AS 차이_사용
FROM excel_people ep JOIN emp ON emp.name = ep.name
LEFT JOIN g ON g.employee_id = emp.id LEFT JOIN u ON u.employee_id = emp.id
ORDER BY ep.name;
