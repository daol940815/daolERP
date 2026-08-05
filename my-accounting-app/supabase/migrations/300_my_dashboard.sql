-- =====================================================
-- 300_my_dashboard.sql
-- 직원 개인화면(마이페이지) 트랙 1단계 — 내 대시보드 집계 RPC
-- (번호 규칙: 직원 개인화면 트랙은 300번대 사용)
--
-- 원칙:
--  - 원본 테이블은 수정하지 않는다. 조회 전용 함수·인덱스만 추가.
--  - 집계는 JSONB 단일 응답(102 패턴) — PostgREST max-rows 절단 없음.
--  - "본인 관련" 판정 근거:
--      내 입력 주문   erp_orders.staff_name = 직원 이름 (이름 대조)
--      내 상담 주문   erp_order_items.channel = 직원 이름 (이름 대조)
--      내 담당 거래처 vendor_staff.employee_id (ended_at IS NULL)
--      내 영업일지    contact_activities.employee_id
-- =====================================================

-- 1) 이름 대조 경로 인덱스 보강 (없으면 전량 스캔)
CREATE INDEX IF NOT EXISTS idx_erp_orders_staff_name
  ON erp_orders(staff_name) WHERE staff_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_erp_order_items_channel
  ON erp_order_items(channel) WHERE channel IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contact_activities_employee
  ON contact_activities(employee_id, activity_date DESC) WHERE employee_id IS NOT NULL;

-- 2) 내 대시보드 집계 — 직원 1명 기준 KPI 묶음을 JSONB 1회 응답으로.
--    p_month: 'YYYY-MM' (KST 기준 — 호출 측에서 계산해 넘긴다)
CREATE OR REPLACE FUNCTION my_dashboard_summary(
  p_employee_id UUID,
  p_staff_name  TEXT,
  p_month       TEXT
)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  WITH mr AS (
    SELECT to_date(p_month || '-01', 'YYYY-MM-DD') AS m_start,
           (to_date(p_month || '-01', 'YYYY-MM-DD') + INTERVAL '1 month')::date AS m_end
  ),
  my_orders AS (
    SELECT o.order_date, o.total_amount, o.outstanding_amount
    FROM erp_orders o
    WHERE p_staff_name IS NOT NULL AND o.staff_name = p_staff_name
  ),
  om AS (  -- 이번 달 내 입력 주문
    SELECT COUNT(*)::int AS cnt,
           COALESCE(SUM(total_amount), 0)::numeric AS total,
           COALESCE(SUM(outstanding_amount), 0)::numeric AS outstanding
    FROM my_orders, mr
    WHERE order_date >= mr.m_start AND order_date < mr.m_end
  ),
  ot AS (  -- 내 입력 주문 전체 미수 (기간 무관)
    SELECT COALESCE(SUM(outstanding_amount), 0)::numeric AS outstanding,
           COUNT(*) FILTER (WHERE outstanding_amount > 0)::int AS cnt
    FROM my_orders
  ),
  cm AS (  -- 이번 달 내 상담 주문 (품목 행 기준 + 주문 건 기준)
    SELECT COUNT(*)::int AS item_cnt,
           COUNT(DISTINCT i.order_id)::int AS order_cnt
    FROM erp_order_items i
    JOIN erp_orders o ON o.id = i.order_id, mr
    WHERE p_staff_name IS NOT NULL AND i.channel = p_staff_name
      AND o.order_date >= mr.m_start AND o.order_date < mr.m_end
  ),
  vs AS (  -- 현재 담당 거래처
    SELECT COUNT(*)::int AS cnt
    FROM vendor_staff
    WHERE p_employee_id IS NOT NULL AND employee_id = p_employee_id AND ended_at IS NULL
  ),
  ja AS (  -- 영업일지 (이번 달 / 전체)
    SELECT COUNT(*) FILTER (WHERE a.activity_date >= mr.m_start AND a.activity_date < mr.m_end)::int AS month_cnt,
           COUNT(*)::int AS total_cnt
    FROM contact_activities a, mr
    WHERE p_employee_id IS NOT NULL AND a.employee_id = p_employee_id
  )
  SELECT jsonb_build_object(
    'month',             p_month,
    'orders_month',      (SELECT to_jsonb(om) FROM om),
    'outstanding_total', (SELECT to_jsonb(ot) FROM ot),
    'consult_month',     (SELECT to_jsonb(cm) FROM cm),
    'vendor_cnt',        (SELECT cnt FROM vs),
    'journal',           (SELECT to_jsonb(ja) FROM ja)
  )
$$;

COMMENT ON FUNCTION my_dashboard_summary(UUID, TEXT, TEXT) IS
  '내 대시보드 KPI 집계 (직원 개인화면). 이름 대조(staff_name·channel) + employee_id 기준. JSONB 단일 응답.';
