-- =====================================================
-- order_counselor_undetermined_diag.sql — 상담자 보정 '판정 불가' 주문의 원인 진단 (조회만, 쓰기 없음)
-- 2026-11-05: order_counselor_backfill.sql 드라이런에서 바뀔 주문 0 · 판정 불가 27건.
-- 판정 불가 = 주문의 지점(vendor_id) · 고객(contact_id) 조합에 다올 담당이 있는 배정이 없음. 원인을 하나씩 가린다.
-- =====================================================

WITH staff AS (
  SELECT DISTINCT ON (a.vendor_id, a.contact_id) a.vendor_id, a.contact_id, a.staff_employee_id
  FROM contact_assignments a
  WHERE a.staff_employee_id IS NOT NULL
  ORDER BY a.vendor_id, a.contact_id, (a.ended_at IS NULL) DESC, a.started_at DESC NULLS LAST, a.created_at DESC
),
und AS (
  SELECT o.* FROM erp_orders o
  WHERE NOT EXISTS (SELECT 1 FROM staff s WHERE s.vendor_id = o.vendor_id AND s.contact_id = o.contact_id)
)
SELECT u.order_no AS 주문번호,
       CONCAT_WS(' ', u.bank_name, u.branch_name) AS 주문처, u.manager_name AS 고객,
       v.name AS 지점_마스터명, v.type AS 거래처유형, v.is_active AS 지점_활성,
       c.name AS 고객_마스터명, c.merged_into_id IS NOT NULL AS 고객_병합됨,
       (SELECT COUNT(*) FROM contact_assignments a WHERE a.vendor_id = u.vendor_id AND a.contact_id = u.contact_id AND a.ended_at IS NULL) AS 현재배정,
       (SELECT COUNT(*) FROM contact_assignments a WHERE a.vendor_id = u.vendor_id AND a.contact_id = u.contact_id AND a.ended_at IS NOT NULL) AS 종료배정,
       (SELECT STRING_AGG(v2.name, ', ') FROM contact_assignments a JOIN vendors v2 ON v2.id = a.vendor_id
          WHERE a.contact_id = u.contact_id AND a.ended_at IS NULL AND a.vendor_id <> u.vendor_id) AS 고객의_다른_현재소속,
       CASE
         WHEN u.vendor_id IS NULL THEN 'A 주문에 지점 미연결'
         WHEN u.contact_id IS NULL THEN 'B 주문에 고객 미연결'
         WHEN c.merged_into_id IS NOT NULL THEN 'C 고객이 다른 인물로 병합됨'
         WHEN v.type NOT IN ('customer', 'both') THEN 'D 거래처 유형이 매출처 아님'
         WHEN EXISTS (SELECT 1 FROM contact_assignments a WHERE a.vendor_id = u.vendor_id AND a.contact_id = u.contact_id AND a.ended_at IS NULL)
           THEN 'E 현재 배정 있음 · 다올 담당 비어 있음'
         WHEN EXISTS (SELECT 1 FROM contact_assignments a WHERE a.vendor_id = u.vendor_id AND a.contact_id = u.contact_id)
           THEN 'F 배정이 종료됨 (매출처 정비 등)'
         ELSE 'G 이 지점에 그 고객 배정 자체가 없음'
       END AS 원인
FROM und u
LEFT JOIN vendors v ON v.id = u.vendor_id
LEFT JOIN contacts c ON c.id = u.contact_id
ORDER BY 원인, u.order_no;
