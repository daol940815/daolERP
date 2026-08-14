-- =====================================================
-- dashboard_vs_hub_check.sql  (읽기 전용 — 데이터 변경 없음)
-- 경영대시보드 미수금·미지급금 값 vs 허브(컷오프 규칙 적용) 값 대사
--
-- 배경: "26.06까지 정산 완료 전제, 26.07부터 반영" 컷오프 조치는
--   · 미결제금: purchase_opening_balances + hub_purchase_summary(600/601) + lib/purchase-hub.ts
--   · 미수금  : hub_vendor_summary(107) + lib/vendor-hub.ts
--   즉 **허브 화면 경로에만** 적용됐다.
--   경영대시보드는 lib/erp-reports.ts의 별도 집계(buildReceivableAgingRows /
--   buildPayableAgingRows)를 쓰므로 컷오프가 반영되지 않는다.
-- 이 스크립트로 두 경로의 금액 차이를 수치로 확인한다.
-- 전체를 한 번에 실행하면 JSON 하나로 결과가 나온다.
-- =====================================================

SELECT jsonb_pretty(jsonb_build_object(

  -- [1] 미지급금 — 대시보드 경로 (ERP 주문 품목 정산월 모델, 컷오프 없음)
  -- buildPayableAgingRows: erp_payable_item_summary(monthFrom=NULL) 전 기간 +
  --   erp_purchase_settlements에 paid 표시 없으면 전액 미지급.
  'P1_dashboard_payable', (
    WITH item AS (
      SELECT i.purchase_alias_id AS alias_id,
             COALESCE(NULLIF(i.settlement_month, ''), '미지정') AS smonth,
             SUM(COALESCE(i.purchase_total, 0)) AS total
      FROM erp_order_items i
      WHERE NOT i.is_canceled AND NOT i.is_vip AND NOT i.is_prepayment
        AND i.purchase_alias_id IS NOT NULL
      GROUP BY 1, 2
    ),
    j AS (
      SELECT it.alias_id, it.smonth,
             it.total - COALESCE(s.paid_amount, 0) AS amount,
             COALESCE(s.status, 'unpaid') AS status
      FROM item it
      LEFT JOIN erp_purchase_settlements s
             ON s.purchase_alias_id = it.alias_id
            AND s.settlement_month  = it.smonth
    )
    SELECT jsonb_build_object(
      'total',              COALESCE(SUM(amount), 0),
      'rows',               COUNT(*),
      'upto_2026_06',       COALESCE(SUM(amount) FILTER (WHERE smonth <> '미지정' AND smonth <= '2026-06'), 0),
      'from_2026_07',       COALESCE(SUM(amount) FILTER (WHERE smonth <> '미지정' AND smonth >= '2026-07'), 0),
      'month_unset',        COALESCE(SUM(amount) FILTER (WHERE smonth =  '미지정'), 0),
      'settlement_rows_paid', (SELECT COUNT(*) FROM erp_purchase_settlements WHERE status = 'paid')
    )
    FROM j WHERE status = 'unpaid' AND amount > 0
  ),

  -- [2] 미지급금 — 허브 경로 (기준일 컷오프 + 기초원장)
  'P2_hub_payable', (
    SELECT jsonb_build_object(
      'total',          COALESCE(SUM(outstanding), 0),
      'vendors',        COUNT(*),
      'positive_sum',   COALESCE(SUM(outstanding) FILTER (WHERE outstanding > 0), 0),
      'negative_sum',   COALESCE(SUM(outstanding) FILTER (WHERE outstanding < 0), 0),
      'opening_remain', COALESCE(SUM(opening_remain), 0)
    )
    FROM hub_purchase_summary(NULL, NULL)
  ),

  -- [3] 기초원장 적재 현황 (컷오프 기준일 — 2026-06-30 · 잔액 0 · 406행 기대)
  'P3_purchase_opening', (
    SELECT jsonb_build_object(
      'rows', COUNT(*), 'as_of_dates', jsonb_agg(DISTINCT as_of_date),
      'amount_sum', COALESCE(SUM(amount), 0),
      'nonzero_rows', COUNT(*) FILTER (WHERE amount <> 0)
    )
    FROM purchase_opening_balances
  ),

  -- [4] 대시보드 미지급금이 참조하는 다른 기초원장 (vendor_opening_balances 음수분)
  -- 매출 Aging 전용 테이블 — 매입 기초원장(purchase_opening_balances)과 별개.
  'P4_vendor_opening_negative', (
    SELECT jsonb_build_object(
      'rows', COUNT(*), 'amount_sum', COALESCE(SUM(-amount), 0)
    )
    FROM vendor_opening_balances WHERE amount < 0
  ),

  -- [5] 미수금 — 대시보드 경로 (모든 입금 매칭을 차감, 컷오프 없음)
  'R1_dashboard_receivable', (
    WITH m AS (
      SELECT order_id, SUM(amount) AS matched FROM erp_payment_matches GROUP BY order_id
    )
    SELECT jsonb_build_object(
      'total', COALESCE(SUM(GREATEST(0, COALESCE(eo.outstanding_amount, 0) - COALESCE(m.matched, 0))), 0),
      'orders', COUNT(*)
    )
    FROM erp_orders eo
    LEFT JOIN m ON m.order_id = eo.id
    WHERE eo.collect_status <> 'collected' AND COALESCE(eo.outstanding_amount, 0) > 0
      AND eo.order_date <= CURRENT_DATE
  ),

  -- [6] 미수금 — 허브 경로 (업로드 컷오프 적용)
  'R2_hub_receivable', (
    SELECT jsonb_build_object(
      'total', COALESCE(SUM(outstanding), 0), 'vendors', COUNT(*)
    )
    FROM hub_vendor_summary(NULL, NULL)
  ),

  -- [7] 미수금 이중차감 규모 — upload 주문에서 "마지막 업로드 이전 입금" 매칭액
  -- 이 금액은 ERP outstanding_amount에 이미 반영돼 있는데 대시보드가 또 차감한다.
  'R3_double_deduction', (
    SELECT jsonb_build_object(
      'matches', COUNT(*), 'amount', COALESCE(SUM(m.amount), 0)
    )
    FROM erp_payment_matches m
    JOIN erp_orders eo ON eo.id = m.order_id
    WHERE COALESCE(eo.source, 'upload') <> 'direct'
      AND m.paid_date <= eo.updated_at::date
  )

)) AS check_result;
