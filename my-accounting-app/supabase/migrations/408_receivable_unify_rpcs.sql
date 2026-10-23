-- =====================================================
-- 408_receivable_unify_rpcs.sql  (회계 트랙)
-- 미수·순매출 단일화 마지막 단계 — 집계 함수 3개를 뷰 위로 옮긴다.
--
-- ※ 실행 순서: 406(뷰 신설, 완료) → 407(뷰 보정) → 점검 SQL 확인·승인 → **408**
--   406·407은 뷰만 만들고 고치므로 화면 숫자가 바뀌지 않는다. 바뀌는 건 이 408부터다.
--
-- 함수 이름·인자·반환 컬럼은 하나도 바꾸지 않는다 → 호출하는 화면/API 코드는 수정 불필요.
--
-- 표준 규칙 (v_erp_order_receivable)
--   순매출 = Σ(비제외 품목 line_total)            -- 월별 손익 025와 같은 정의
--   미수   = 수금완료 ? 0
--          : LEAST(GREATEST(0, 원본미수 − 컷오프 통과 매칭), GREATEST(0, 순매출))
--
-- ── 이 마이그레이션으로 바뀌는 숫자 ──────────────────────────
-- (1) 허브 미수: **107이 실행된 적이 없어** DB에는 101(매칭 차감 없음)이 살아 있었다.
--     246,235,138 → 245,313,538 (-921,600)
--       · 컷오프 통과 매칭 차감   -836,600 (휘경금융센터 -436,000 / 태평동 -273,600 / 철산동 -127,000)
--       · 수금완료인데 잔액 남은 주문 -85,000 (검단금융센터)
-- (2) 순매출: `총액 − 제외` → `비제외 품목 합`
--     5,849,863,431 → 6,310,278,915 (+460,415,484). 주문내역 KPI·수금대상·허브 매출이
--     월별 손익(025)과 같은 숫자가 된다.
-- (3) KPI(022)·수금대상(037) 미수: 업로드 이전 입금을 다시 빼지 않고(이중차감 제거),
--     순매출 상한을 적용한다.
--
-- 주의: hub_vendor_summary는 101이 배포돼 있으므로 이 파일이 101을 대체한다.
--       107 파일은 실행하지 말 것 — 408이 그 역할을 포함한다.
-- =====================================================

-- ── ① 매출처 허브·대시보드 ───────────────────────────────
-- 107과 동일 시그니처. vip_total·last_order_date는 기존처럼 기간 필터 없이 전체 누적.
CREATE OR REPLACE FUNCTION hub_vendor_summary(p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL)
RETURNS TABLE (
  vendor_id       UUID,
  order_count     INT,
  net             BIGINT,
  outstanding     BIGINT,
  over90          BIGINT,
  vip_total       BIGINT,
  last_order_date DATE
)
LANGUAGE sql
STABLE
AS $$
  WITH o AS (
    SELECT r.vendor_id AS vid,
           r.order_date,
           r.net_sales,
           r.outstanding,
           r.vip_total,
           ((p_from IS NULL OR r.order_date >= p_from)
            AND (p_to IS NULL OR r.order_date <= p_to)) AS inp
    FROM v_erp_order_receivable r
    WHERE r.vendor_id IS NOT NULL
  )
  SELECT vid,
         COALESCE(COUNT(*) FILTER (WHERE inp), 0)::INT,
         COALESCE(SUM(net_sales)   FILTER (WHERE inp), 0)::BIGINT,
         COALESCE(SUM(outstanding) FILTER (WHERE inp), 0)::BIGINT,
         COALESCE(SUM(outstanding) FILTER (WHERE inp AND outstanding > 0
                                             AND order_date < CURRENT_DATE - 90), 0)::BIGINT,
         COALESCE(SUM(vip_total), 0)::BIGINT,
         MAX(order_date)
  FROM o
  GROUP BY vid
$$;

-- ── ② ERP 주문내역 KPI ───────────────────────────────────
-- 022와 동일 시그니처. 필터(기간·수금상태·검색어·보기)도 동일 동작.
CREATE OR REPLACE FUNCTION erp_orders_summary(
  p_from   DATE DEFAULT NULL,
  p_to     DATE DEFAULT NULL,
  p_status TEXT DEFAULT NULL,   -- collected | outstanding | in_progress | NULL(전체)
  p_q      TEXT DEFAULT NULL,   -- 주문번호/은행/지점 검색어
  p_view   TEXT DEFAULT 'all'   -- all | vip | prepayment
)
RETURNS TABLE (total_count BIGINT, net_sales BIGINT, outstanding BIGINT)
LANGUAGE sql STABLE
AS $$
  WITH filtered AS (
    SELECT r.*
    FROM v_erp_order_receivable r
    WHERE (p_from IS NULL OR r.order_date >= p_from)
      AND (p_to   IS NULL OR r.order_date <= p_to)
      AND (p_status IS NULL OR p_status = 'all' OR r.collect_status = p_status)
      AND (p_q IS NULL OR p_q = ''
           OR r.order_no    ILIKE '%' || p_q || '%'
           OR r.bank_name   ILIKE '%' || p_q || '%'
           OR r.branch_name ILIKE '%' || p_q || '%')
      AND (p_view IS NULL OR p_view = 'all'
           OR (p_view = 'vip'        AND r.has_vip)
           OR (p_view = 'prepayment' AND r.has_prepayment))
  )
  SELECT COUNT(*)::BIGINT,
         COALESCE(SUM(net_sales), 0)::BIGINT,
         COALESCE(SUM(outstanding), 0)::BIGINT
  FROM filtered;
$$;

-- ── ③ 수금 대상(매출처 미수금현황) ───────────────────────
-- 037과 동일 시그니처. total_amount는 기존대로 순매출(제외금액 차감 후).
CREATE OR REPLACE FUNCTION erp_receivable_summary(p_from DATE, p_to DATE, p_staff TEXT)
RETURNS TABLE (
  alias_id           UUID,
  order_count        BIGINT,
  total_amount       BIGINT,
  excluded_amount    BIGINT,
  outstanding_amount BIGINT,
  outstanding_count  BIGINT,
  staff_names        TEXT[]
)
LANGUAGE sql STABLE
AS $$
  WITH ord AS (
    SELECT r.*
    FROM v_erp_order_receivable r
    WHERE (p_from IS NULL OR r.order_date >= p_from)
      AND (p_to   IS NULL OR r.order_date <= p_to)
      AND (p_staff IS NULL OR btrim(COALESCE(r.staff_name, '')) = p_staff)
  )
  SELECT customer_alias_id AS alias_id,
         COUNT(*)::BIGINT,
         COALESCE(SUM(net_sales), 0)::BIGINT,
         COALESCE(SUM(excluded_amount), 0)::BIGINT,
         COALESCE(SUM(outstanding), 0)::BIGINT,
         COUNT(*) FILTER (WHERE outstanding > 0)::BIGINT,
         COALESCE(ARRAY_AGG(DISTINCT btrim(staff_name))
                  FILTER (WHERE btrim(COALESCE(staff_name, '')) <> ''), '{}') AS staff_names
  FROM ord
  GROUP BY customer_alias_id
$$;

-- ── ④ 주문별 미수 조회 함수 (화면 행 계산을 DB로 옮기기 위한 보조) ──
-- ERP 주문내역 화면이 행마다 직접 계산하던 로직을 없애기 위해 주문 id 목록으로
-- 표준 미수와 그 구성요소를 돌려준다. (app/api/erp-orders 가 사용)
CREATE OR REPLACE FUNCTION erp_order_receivable_by_ids(p_order_ids UUID[])
RETURNS TABLE (
  order_id           UUID,
  net_sales          BIGINT,
  raw_outstanding    BIGINT,
  matched_all        BIGINT,
  matched_deducted   BIGINT,
  matched_pre_cutoff BIGINT,
  outstanding        BIGINT
)
LANGUAGE sql STABLE
AS $$
  SELECT r.order_id, r.net_sales, r.raw_outstanding,
         r.matched_all, r.matched_deducted, r.matched_pre_cutoff, r.outstanding
  FROM v_erp_order_receivable r
  WHERE r.order_id = ANY(p_order_ids)
$$;

-- ── 검증 (실행 후) ───────────────────────────────────────
-- 세 함수의 합계가 뷰의 표준 미수와 범위별로 일치해야 한다.
-- 기대: hub_outstanding = 245,313,538 / kpi_outstanding = recv_outstanding = view_all
--   허브   = 거래처 연결 주문의 표준 미수 합
--   KPI/수금 = 전체 주문의 표준 미수 합
SELECT
  (SELECT COALESCE(SUM(outstanding), 0) FROM hub_vendor_summary(NULL, NULL))            AS hub_outstanding,
  (SELECT COALESCE(SUM(outstanding), 0) FROM v_erp_order_receivable
    WHERE vendor_id IS NOT NULL)                                                        AS view_hub_scope,
  (SELECT outstanding FROM erp_orders_summary(NULL, NULL, NULL, NULL, 'all'))           AS kpi_outstanding,
  (SELECT COALESCE(SUM(outstanding_amount), 0) FROM erp_receivable_summary(NULL, NULL, NULL)) AS recv_outstanding,
  (SELECT COALESCE(SUM(outstanding), 0) FROM v_erp_order_receivable)                    AS view_all;
