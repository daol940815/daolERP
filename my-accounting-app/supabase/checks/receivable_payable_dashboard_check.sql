-- =====================================================
-- receivable_payable_dashboard_check.sql  (읽기 전용 — 데이터 변경 없음)
-- 경영대시보드의 미수금·미지급금 총계를 SQL로 그대로 재현하고,
-- 허브(컷오프 규칙 적용) 값과 대조해 차이의 원인을 분해한다.
--
-- 재현 대상 코드:
--   미수금  lib/erp-reports.ts buildReceivableAgingRows (asOf = 오늘)
--     = Σ max(outstanding_amount - 전체 입금매칭, 0)  ... 컷오프 없음·상한 없음
--     + vendor_opening_balances 양수분(기초이월 매출채권)
--   미지급금 lib/erp-reports.ts buildPayableAgingRows → buildPayableRows(null, 당월)
--     = Σ (ERP 품목 매입액 - 정산 paid_amount)  단, 정산 status='paid'인 조합은 제외
--       (정산월 <= 당월, 취소·VIP·선결제 품목 제외)
--     + vendor_opening_balances 음수분(기초이월 매입채무)
--     ※ 매입처 허브가 쓰는 purchase_opening_balances(기준일 2026-06-30)는 참조하지 않음
--
-- 전체를 한 번에 실행하면 JSON 하나로 나온다.
-- =====================================================

WITH params AS (
  SELECT CURRENT_DATE AS as_of, to_char(CURRENT_DATE, 'YYYY-MM') AS as_of_month
),

-- ── 대시보드 미수금 ────────────────────────────────────
m_all AS (
  SELECT order_id, SUM(amount) AS matched FROM erp_payment_matches GROUP BY order_id
),
recv AS (
  SELECT eo.id,
         COALESCE(eo.outstanding_amount, 0) AS outs,
         COALESCE(ma.matched, 0)            AS matched,
         GREATEST(COALESCE(eo.outstanding_amount, 0) - COALESCE(ma.matched, 0), 0) AS remaining
  FROM erp_orders eo
  LEFT JOIN m_all ma ON ma.order_id = eo.id
  CROSS JOIN params p
  WHERE eo.collect_status <> 'collected'
    AND COALESCE(eo.outstanding_amount, 0) > 0
    AND eo.order_date <= p.as_of
),
recv_open AS (
  SELECT COALESCE(SUM(GREATEST(vob.amount - COALESCE(vob.collected_amount, 0), 0)), 0) AS amt,
         COUNT(*) FILTER (WHERE vob.amount > 0
                            AND vob.amount - COALESCE(vob.collected_amount, 0) > 0) AS cnt
  FROM vendor_opening_balances vob, params p
  WHERE vob.as_of_date <= p.as_of AND vob.amount > 0
),

-- ── 대시보드 미지급금 ──────────────────────────────────
item AS (
  SELECT i.purchase_alias_id AS alias_id,
         i.settlement_month  AS smonth,
         SUM(COALESCE(i.purchase_total, 0)) AS total
  FROM erp_order_items i, params p
  WHERE NOT i.is_canceled AND NOT i.is_vip AND NOT i.is_prepayment
    AND i.purchase_alias_id IS NOT NULL
    AND (i.settlement_month IS NULL OR i.settlement_month <= p.as_of_month)
  GROUP BY 1, 2
),
pay AS (
  SELECT it.alias_id,
         COALESCE(NULLIF(it.smonth, ''), '미지정') AS smonth,
         it.total - COALESCE(s.paid_amount, 0) AS amount,
         COALESCE(s.status, 'unpaid')          AS status
  FROM item it
  LEFT JOIN erp_purchase_settlements s
         ON s.purchase_alias_id = it.alias_id
        AND s.settlement_month  = COALESCE(NULLIF(it.smonth, ''), '미지정')
),
pay_open AS (
  SELECT COALESCE(SUM(GREATEST(-vob.amount - COALESCE(vob.collected_amount, 0), 0)), 0) AS amt,
         COUNT(*) FILTER (WHERE vob.amount < 0) AS cnt
  FROM vendor_opening_balances vob, params p
  WHERE vob.as_of_date <= p.as_of AND vob.amount < 0
),

-- ── 차이 분해용 ────────────────────────────────────────
-- 미수: 업로드 이전 입금 매칭(이중차감분)
dbl AS (
  SELECT COALESCE(SUM(m.amount), 0) AS amt, COUNT(*) AS cnt
  FROM erp_payment_matches m
  JOIN erp_orders eo ON eo.id = m.order_id
  WHERE COALESCE(eo.source, 'upload') <> 'direct'
    AND m.paid_date <= eo.updated_at::date
),
-- 미수: 별칭이 거래처에 연결되지 않아 허브 집계에서 빠지는 금액
unlinked_recv AS (
  SELECT COALESCE(SUM(GREATEST(COALESCE(eo.outstanding_amount, 0) - COALESCE(ma.matched, 0), 0)), 0) AS amt,
         COUNT(*) AS cnt
  FROM erp_orders eo
  LEFT JOIN m_all ma ON ma.order_id = eo.id
  LEFT JOIN erp_vendor_aliases a ON a.id = eo.customer_alias_id
  WHERE eo.collect_status <> 'collected' AND COALESCE(eo.outstanding_amount, 0) > 0
    AND (eo.customer_alias_id IS NULL OR a.vendor_id IS NULL)
)

SELECT jsonb_pretty(jsonb_build_object(

  '기준일', (SELECT as_of FROM params),

  -- [1] 경영대시보드 미수금 총계 (재현)
  'A_dashboard_receivable', (
    SELECT jsonb_build_object(
      'total',        (SELECT SUM(remaining) FROM recv) + (SELECT amt FROM recv_open),
      'orders_part',  (SELECT COALESCE(SUM(remaining), 0) FROM recv),
      'orders_count', (SELECT COUNT(*) FROM recv WHERE remaining > 0),
      'opening_part', (SELECT amt FROM recv_open),
      'opening_count',(SELECT cnt FROM recv_open),
      'raw_outstanding_sum', (SELECT COALESCE(SUM(outs), 0) FROM recv),
      'matched_deducted',    (SELECT COALESCE(SUM(matched), 0) FROM recv)
    )
  ),

  -- [2] 매출처 허브 미수금 (컷오프 적용)
  'B_hub_receivable', (
    SELECT jsonb_build_object('total', COALESCE(SUM(outstanding), 0), 'vendors', COUNT(*))
    FROM hub_vendor_summary(NULL, NULL)
  ),

  -- [3] 미수금 차이 원인
  'C_receivable_gap', jsonb_build_object(
    '이중차감_업로드이전입금', (SELECT jsonb_build_object('건수', cnt, '금액', amt) FROM dbl),
    '별칭미연결_허브제외분',   (SELECT jsonb_build_object('건수', cnt, '금액', amt) FROM unlinked_recv)
  ),

  -- [4] 경영대시보드 미지급금 총계 (재현)
  'D_dashboard_payable', (
    SELECT jsonb_build_object(
      'total',        (SELECT COALESCE(SUM(amount), 0) FROM pay WHERE status = 'unpaid' AND amount > 0)
                      + (SELECT amt FROM pay_open),
      'items_part',   (SELECT COALESCE(SUM(amount), 0) FROM pay WHERE status = 'unpaid' AND amount > 0),
      'items_count',  (SELECT COUNT(*) FROM pay WHERE status = 'unpaid' AND amount > 0),
      'opening_part', (SELECT amt FROM pay_open),
      'opening_count',(SELECT cnt FROM pay_open),
      'settlement_paid_rows', (SELECT COUNT(*) FROM erp_purchase_settlements WHERE status = 'paid')
    )
  ),

  -- [5] 매입처 허브 미결제금 (기준일 컷오프 + 기초원장)
  'E_hub_payable', (
    SELECT jsonb_build_object(
      'total',          COALESCE(SUM(outstanding), 0),
      'positive_sum',   COALESCE(SUM(outstanding) FILTER (WHERE outstanding > 0), 0),
      'negative_sum',   COALESCE(SUM(outstanding) FILTER (WHERE outstanding < 0), 0),
      'opening_remain', COALESCE(SUM(opening_remain), 0),
      'vendors',        COUNT(*)
    )
    FROM hub_purchase_summary(NULL, NULL)
  ),

  -- [6] 미지급금 차이 원인 — 정산월 구간별 분해 (26.06 이전분이 대시보드에만 남아 있다)
  'F_payable_by_period', (
    SELECT jsonb_build_object(
      '_2026_06_이전', COALESCE(SUM(amount) FILTER (WHERE smonth <> '미지정' AND smonth <= '2026-06'), 0),
      '_2026_07_이후', COALESCE(SUM(amount) FILTER (WHERE smonth <> '미지정' AND smonth >= '2026-07'), 0),
      '정산월_미지정',  COALESCE(SUM(amount) FILTER (WHERE smonth =  '미지정'), 0)
    )
    FROM pay WHERE status = 'unpaid' AND amount > 0
  ),

  -- [7] 미지급금 정산월별 상위 12개월 (어느 시기가 쌓여 있는지)
  'G_payable_top_months', (
    SELECT coalesce(jsonb_agg(t ORDER BY (t->>'amount')::bigint DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object('month', smonth, 'amount', SUM(amount), 'rows', COUNT(*)) AS t
      FROM pay WHERE status = 'unpaid' AND amount > 0
      GROUP BY smonth ORDER BY SUM(amount) DESC LIMIT 12
    ) s
  ),

  -- [8] 매입 기초원장 적재 현황 (허브만 참조 — 대시보드는 안 봄)
  'H_purchase_opening', (
    SELECT jsonb_build_object('rows', COUNT(*), 'as_of', MIN(as_of_date),
                              'amount_sum', COALESCE(SUM(amount), 0),
                              'nonzero', COUNT(*) FILTER (WHERE amount <> 0))
    FROM purchase_opening_balances
  )

)) AS check_result;
