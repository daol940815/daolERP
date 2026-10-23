-- =====================================================
-- 406_erp_order_receivable_view.sql  (회계 트랙)
-- 미수 계산 단일화 1단계 — 주문 1건 = 1행 뷰를 만든다. (숫자 변경 없음)
--
-- 배경: 지금 같은 "미수금"이 화면마다 다르게 계산된다 (docs/accounting-track.md 참조).
--   · 허브/대시보드   hub_vendor_summary(107)  : 컷오프 차감 + 순매출 상한
--   · ERP 주문내역 표 page.tsx 행 계산          : 컷오프 차감, 상한 없음
--   · ERP 주문내역 KPI erp_orders_summary(022) : 전체 매칭 차감, 수금완료 제외
--   · ERP 주문내역 KPI API JS 폴백             : 원본 미수 그대로
--   · 수금 대상 erp_receivable_summary(037)    : 전체 매칭 차감, 수금완료 제외
--
-- 이 마이그레이션은 **뷰만 만든다.** 기존 함수·화면은 전혀 건드리지 않으므로
-- 실행해도 화면 숫자는 1원도 바뀌지 않는다. 뷰와 기존 5가지 계산을 나란히
-- 비교하는 점검 SQL(supabase/checks/receivable_unify_check.sql)로 차이를 먼저
-- 확인하고, 승인 후 407에서 함수들을 이 뷰 위로 옮긴다.
--
-- ── 표준 규칙 (뷰의 outstanding) ────────────────────────
--   수금완료(collect_status='collected') → 0
--   그 외 → LEAST( GREATEST(0, 원본미수 - 컷오프통과 매칭), 순매출 )
--
--   · 컷오프통과 매칭: upload 주문은 마지막 업로드(updated_at) 이후 입금만,
--     direct 주문(자체 주문시스템)은 전액. 업로드 이전 입금은 ERP가 들고 온
--     outstanding_amount에 이미 반영돼 있어 또 빼면 이중차감이 된다.
--   · 순매출 상한: 취소·VIP·선결제를 뺀 금액보다 미수가 클 수는 없다.
--   · 수금완료=0: ERP에서 수금완료로 표시한 주문은 잔액이 남아 있어도 받을 돈이
--     아니다. 기존 022/037은 이미 이렇게 처리했고 허브(107)만 빠져 있었다.
--     → 이 한 줄이 허브 숫자를 바꾸는 유일한 지점이므로 점검 SQL에서 금액을 본다.
-- =====================================================

CREATE OR REPLACE VIEW v_erp_order_receivable AS
WITH item AS (
  -- 주문별 제외금액(취소·VIP·선결제)과 VIP 누적, 뷰 필터용 플래그
  SELECT i.order_id,
         SUM(CASE WHEN i.is_canceled OR i.is_vip OR i.is_prepayment
                  THEN COALESCE(i.line_total, 0) ELSE 0 END)                       AS excluded_amount,
         SUM(CASE WHEN i.is_vip AND NOT i.is_canceled
                  THEN COALESCE(i.line_total, 0) ELSE 0 END)                       AS vip_total,
         BOOL_OR(i.is_vip)        AS has_vip,
         BOOL_OR(i.is_prepayment) AS has_prepayment,
         BOOL_OR(i.is_canceled)   AS has_canceled
  FROM erp_order_items i
  GROUP BY i.order_id
),
pay AS (
  -- 매칭 입금: 전체 / 컷오프 통과분을 함께 계산해 두면 뷰 하나로 비교까지 된다
  SELECT m.order_id,
         SUM(m.amount) AS matched_all,
         SUM(CASE WHEN COALESCE(eo.source, 'upload') = 'direct'
                    OR m.paid_date > eo.updated_at::date
                  THEN m.amount ELSE 0 END) AS matched_deducted
  FROM erp_payment_matches m
  JOIN erp_orders eo ON eo.id = m.order_id
  GROUP BY m.order_id
)
SELECT
  o.id                                   AS order_id,
  o.order_no,
  o.order_date,
  COALESCE(o.source, 'upload')           AS source,
  o.updated_at::date                     AS upload_cutoff,
  o.customer_alias_id,
  a.vendor_id,
  o.staff_name,
  o.bank_name,
  o.branch_name,
  o.collect_status,

  -- 금액 구성
  COALESCE(o.total_amount, 0)            AS total_amount,
  COALESCE(it.excluded_amount, 0)        AS excluded_amount,
  GREATEST(0, COALESCE(o.total_amount, 0) - COALESCE(it.excluded_amount, 0)) AS net_sales,
  COALESCE(it.vip_total, 0)              AS vip_total,
  COALESCE(o.outstanding_amount, 0)      AS raw_outstanding,
  COALESCE(p.matched_all, 0)             AS matched_all,
  COALESCE(p.matched_deducted, 0)        AS matched_deducted,
  COALESCE(p.matched_all, 0) - COALESCE(p.matched_deducted, 0) AS matched_pre_cutoff,

  -- ★ 표준 미수 (모든 화면이 앞으로 이 값만 쓴다)
  CASE WHEN o.collect_status = 'collected' THEN 0
       ELSE LEAST(
              GREATEST(0, COALESCE(o.outstanding_amount, 0) - COALESCE(p.matched_deducted, 0)),
              GREATEST(0, COALESCE(o.total_amount, 0) - COALESCE(it.excluded_amount, 0))
            )
  END::BIGINT                            AS outstanding,

  -- 품목 플래그 (주문내역 화면의 보기 필터 vip/prepayment용)
  COALESCE(it.has_vip, false)            AS has_vip,
  COALESCE(it.has_prepayment, false)     AS has_prepayment,
  COALESCE(it.has_canceled, false)       AS has_canceled
FROM erp_orders o
LEFT JOIN erp_vendor_aliases a
       ON a.id = o.customer_alias_id AND a.alias_type = 'customer'
LEFT JOIN item it ON it.order_id = o.id
LEFT JOIN pay  p  ON p.order_id = o.id;

COMMENT ON VIEW v_erp_order_receivable IS
  '미수금 단일 정의 (2026-10 회계 트랙 406). 주문 1건 = 1행. outstanding이 표준 미수: 수금완료=0, 그 외 LEAST(원본미수-컷오프통과매칭, 순매출). 모든 미수 집계는 이 뷰만 참조한다.';

-- 뷰는 집계 2개(품목·매칭)를 주문에 붙이므로 조인 키 인덱스만 확인해 둔다.
CREATE INDEX IF NOT EXISTS idx_erp_order_items_order ON erp_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_erp_orders_alias      ON erp_orders(customer_alias_id);
CREATE INDEX IF NOT EXISTS idx_erp_orders_date       ON erp_orders(order_date);

-- ── 검증 (실행 후) ───────────────────────────────────────
-- 기대: 주문 건수 = erp_orders 전체 건수 (뷰가 행을 늘리거나 줄이지 않는지)
SELECT (SELECT COUNT(*) FROM erp_orders)              AS orders_rows,
       (SELECT COUNT(*) FROM v_erp_order_receivable)  AS view_rows,
       (SELECT COUNT(*) FROM v_erp_order_receivable WHERE outstanding > 0) AS outstanding_orders,
       (SELECT SUM(outstanding) FROM v_erp_order_receivable)               AS outstanding_total;
