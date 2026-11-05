-- =====================================================
-- order_counselor_backfill.sql  (데이터 작업 — 112 실행 + contact_staff_backfill.sql 실행 후)
-- 2026-11-05 사용자 승인: "이미 입력된 주문 모두 지점 고객 담당자로 수정"
--
-- 주문의 상담자 = 그 주문 지점(vendor_id) · 고객(contact_id)의 다올 담당(contact_assignments.staff_employee_id).
--  - 대상: 지점 · 고객이 연결된 모든 주문 (10-30 전량 삭제 이후 = 자체 입력 주문). 취소 주문 포함(이력 일관)
--  - 바꾸는 값: erp_orders.counselor_employee_id + 그 주문 품목 전부의 erp_order_items.channel(상담자 이름)
--  - 다올 담당이 비어 판정할 수 없는 주문은 건드리지 않고 목록으로 보고 → 허브에서 고객 담당을 채운 뒤 이 파일을 다시 실행
--  - 바뀐 주문마다 변경 이력(erp_order_edit_logs)에 '상담자' 한 줄 기록
--  - 다올 담당 선택: 그 지점 · 고객의 현재 배정 우선, 없으면 가장 최근 배정
-- 실행 순서: [1] 드라이런 결과 회신 → [2] 실행 → [3] 검증. 다시 실행해도 이미 맞는 주문은 바뀌지 않음.
-- =====================================================

-- ── [1] 드라이런 (쓰기 없음) ─────────────────────────────
-- [1-1] 요약
WITH staff AS (
  SELECT DISTINCT ON (a.vendor_id, a.contact_id) a.vendor_id, a.contact_id, a.staff_employee_id
  FROM contact_assignments a
  WHERE a.staff_employee_id IS NOT NULL
  ORDER BY a.vendor_id, a.contact_id, (a.ended_at IS NULL) DESC, a.started_at DESC NULLS LAST, a.created_at DESC
),
plan AS (
  SELECT o.id, o.order_no, o.counselor_employee_id AS cur_id, s.staff_employee_id AS new_id
  FROM erp_orders o
  LEFT JOIN staff s ON s.vendor_id = o.vendor_id AND s.contact_id = o.contact_id
)
SELECT
  (SELECT COUNT(*) FROM erp_orders) AS 주문_전체,
  (SELECT COUNT(*) FROM plan WHERE new_id IS NOT NULL AND new_id IS DISTINCT FROM cur_id) AS 바뀔_주문,
  (SELECT COUNT(*) FROM plan WHERE new_id IS NOT NULL AND new_id = cur_id) AS 이미_맞음,
  (SELECT COUNT(*) FROM plan WHERE new_id IS NULL) AS 판정불가_다올담당없음,
  (SELECT COUNT(*) FROM erp_order_items i JOIN plan p ON p.id = i.order_id
    WHERE p.new_id IS NOT NULL AND p.new_id IS DISTINCT FROM p.cur_id) AS 바뀔_품목행;

-- [1-2] 주문별 목록 (바뀔 주문 + 판정 불가)
WITH staff AS (
  SELECT DISTINCT ON (a.vendor_id, a.contact_id) a.vendor_id, a.contact_id, a.staff_employee_id
  FROM contact_assignments a
  WHERE a.staff_employee_id IS NOT NULL
  ORDER BY a.vendor_id, a.contact_id, (a.ended_at IS NULL) DESC, a.started_at DESC NULLS LAST, a.created_at DESC
)
SELECT o.order_no AS 주문번호, o.order_date AS 주문일,
       CONCAT_WS(' ', o.bank_name, o.branch_name) AS 주문처, o.manager_name AS 고객,
       ec.name AS 현재_상담자, en.name AS 바뀔_상담자,
       CASE WHEN s.staff_employee_id IS NULL THEN '판정 불가 — 고객 다올 담당 없음'
            WHEN s.staff_employee_id = o.counselor_employee_id THEN '이미 맞음'
            ELSE '변경' END AS 처리
FROM erp_orders o
LEFT JOIN staff s ON s.vendor_id = o.vendor_id AND s.contact_id = o.contact_id
LEFT JOIN employees ec ON ec.id = o.counselor_employee_id
LEFT JOIN employees en ON en.id = s.staff_employee_id
WHERE s.staff_employee_id IS NULL OR s.staff_employee_id IS DISTINCT FROM o.counselor_employee_id
ORDER BY 처리, o.order_date, o.order_no;


-- ── [2] 실행 ([1] 확인 후, 아래 블록 전체 주석 해제해 한 번에 실행) ──
-- BEGIN;
-- CREATE TEMP TABLE _counselor_plan ON COMMIT DROP AS
-- WITH staff AS (
--   SELECT DISTINCT ON (a.vendor_id, a.contact_id) a.vendor_id, a.contact_id, a.staff_employee_id
--   FROM contact_assignments a
--   WHERE a.staff_employee_id IS NOT NULL
--   ORDER BY a.vendor_id, a.contact_id, (a.ended_at IS NULL) DESC, a.started_at DESC NULLS LAST, a.created_at DESC
-- )
-- SELECT o.id AS order_id, o.counselor_employee_id AS cur_id, ec.name AS cur_name,
--        s.staff_employee_id AS new_id, en.name AS new_name
-- FROM erp_orders o
-- JOIN staff s ON s.vendor_id = o.vendor_id AND s.contact_id = o.contact_id
-- JOIN employees en ON en.id = s.staff_employee_id
-- LEFT JOIN employees ec ON ec.id = o.counselor_employee_id
-- WHERE s.staff_employee_id IS DISTINCT FROM o.counselor_employee_id;
--
-- INSERT INTO erp_order_edit_logs (order_id, employee_id, employee_name, field_label, before_text, after_text)
-- SELECT order_id, NULL, '시스템 일괄 보정', '상담자', cur_name, new_name || ' (고객 다올 담당 기준 일괄 보정 2026-11-05)'
-- FROM _counselor_plan;
--
-- UPDATE erp_orders o SET counselor_employee_id = p.new_id
-- FROM _counselor_plan p WHERE o.id = p.order_id;
--
-- UPDATE erp_order_items i SET channel = p.new_name
-- FROM _counselor_plan p WHERE i.order_id = p.order_id;
--
-- SELECT COUNT(*) AS 보정된_주문 FROM _counselor_plan;
-- COMMIT;


-- ── [3] 검증 ([2] 실행 후) ──────────────────────────────
-- 기대: 불일치_주문_기대0 = 0 / 품목_불일치_기대0 = 0 / 보정_이력 = [2]의 보정된_주문
-- WITH staff AS (
--   SELECT DISTINCT ON (a.vendor_id, a.contact_id) a.vendor_id, a.contact_id, a.staff_employee_id
--   FROM contact_assignments a
--   WHERE a.staff_employee_id IS NOT NULL
--   ORDER BY a.vendor_id, a.contact_id, (a.ended_at IS NULL) DESC, a.started_at DESC NULLS LAST, a.created_at DESC
-- )
-- SELECT
--   (SELECT COUNT(*) FROM erp_orders o JOIN staff s ON s.vendor_id = o.vendor_id AND s.contact_id = o.contact_id
--     WHERE s.staff_employee_id IS DISTINCT FROM o.counselor_employee_id) AS 불일치_주문_기대0,
--   (SELECT COUNT(*) FROM erp_order_items i JOIN erp_orders o ON o.id = i.order_id
--     JOIN staff s ON s.vendor_id = o.vendor_id AND s.contact_id = o.contact_id
--     JOIN employees e ON e.id = s.staff_employee_id
--     WHERE i.channel IS DISTINCT FROM e.name) AS 품목_불일치_기대0,
--   (SELECT COUNT(*) FROM erp_order_edit_logs WHERE field_label = '상담자' AND employee_name = '시스템 일괄 보정') AS 보정_이력,
--   (SELECT COUNT(*) FROM erp_orders o
--     WHERE NOT EXISTS (SELECT 1 FROM staff s WHERE s.vendor_id = o.vendor_id AND s.contact_id = o.contact_id)) AS 판정불가_남음;
