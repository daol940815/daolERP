-- =====================================================
-- 060_purchase_cycle_summary.sql
-- 매입 사이클(Purchase Cycle) 상태 엔진의 집계 토대.
-- (설계: docs/purchase-cycle-design.md v3)
--
-- 원칙: 상태는 저장하지 않는다 — 사실 데이터(ERP 매입·계산서·지급)만
-- 거래처×월 단위로 집계해 내려주고, 상태 판정은 조회 측(API)이 한다.
--
-- 세 축:
--   erp_amount     ERP 주문 품목의 매입액 (취소 제외, 정산월 우선·없으면 주문월)
--   invoice_*      매입 세금계산서 (공급가 기준, 발행월)
--   paid_amount    지급 = 계산서에 연결된 결제(tax_invoice_payments, 거래일 월)
--                  + 미지급금(2001) 상계로 확정된 거래처 태깅 출금 중 결제연결이 없는 것
-- =====================================================

CREATE OR REPLACE FUNCTION purchase_cycle_summary(
  p_from date,
  p_to   date
) RETURNS TABLE (
  vendor_id         uuid,
  month             text,
  erp_amount        bigint,
  erp_items         bigint,
  invoice_supply    bigint,
  invoice_count     bigint,
  last_invoice_date date,
  paid_amount       bigint
)
LANGUAGE sql STABLE AS $$
  WITH erp AS (
    SELECT a.vendor_id,
           COALESCE(NULLIF(substr(i.settlement_month, 1, 7), ''), to_char(o.order_date, 'YYYY-MM')) AS month,
           SUM(COALESCE(i.purchase_total, 0))::bigint AS erp_amount,
           COUNT(*)::bigint AS erp_items
    FROM erp_order_items i
    JOIN erp_orders o ON o.id = i.order_id
    JOIN erp_vendor_aliases a ON a.id = i.purchase_alias_id
    WHERE NOT i.is_canceled
      AND a.vendor_id IS NOT NULL
      AND o.order_date BETWEEN p_from AND p_to
    GROUP BY 1, 2
  ),
  inv AS (
    SELECT t.vendor_id,
           to_char(t.issue_date, 'YYYY-MM') AS month,
           SUM(COALESCE(t.supply_amount, 0))::bigint AS invoice_supply,
           COUNT(*)::bigint AS invoice_count,
           MAX(t.issue_date) AS last_invoice_date
    FROM tax_invoices t
    WHERE t.direction = 'purchase'
      AND t.vendor_id IS NOT NULL
      AND t.issue_date BETWEEN p_from AND p_to
    GROUP BY 1, 2
  ),
  pay AS (
    -- 계산서에 연결된 결제 (지급월 = 거래일)
    SELECT ti.vendor_id,
           to_char(tx.tx_date, 'YYYY-MM') AS month,
           SUM(p.amount)::bigint AS paid_amount
    FROM tax_invoice_payments p
    JOIN tax_invoices ti ON ti.id = p.tax_invoice_id AND ti.direction = 'purchase'
    JOIN transactions tx ON tx.id = p.transaction_id
    WHERE ti.vendor_id IS NOT NULL
      AND tx.tx_date BETWEEN p_from AND p_to
    GROUP BY 1, 2
    UNION ALL
    -- 미지급금(2001) 상계로 확정된 거래처 태깅 출금 중 결제연결이 없는 것 (이중집계 방지)
    SELECT tx.vendor_id,
           to_char(tx.tx_date, 'YYYY-MM') AS month,
           SUM(COALESCE(tx.amount_out, 0))::bigint AS paid_amount
    FROM transactions tx
    JOIN accounts ac ON ac.id = tx.confirmed_account_id AND ac.code = '2001'
    WHERE tx.vendor_id IS NOT NULL
      AND tx.status = 'confirmed'
      AND COALESCE(tx.amount_out, 0) > 0
      AND tx.tx_date BETWEEN p_from AND p_to
      AND NOT EXISTS (SELECT 1 FROM tax_invoice_payments p2 WHERE p2.transaction_id = tx.id)
    GROUP BY 1, 2
  ),
  pay_agg AS (
    SELECT vendor_id, month, SUM(paid_amount)::bigint AS paid_amount
    FROM pay GROUP BY 1, 2
  ),
  keys AS (
    SELECT vendor_id, month FROM erp
    UNION SELECT vendor_id, month FROM inv
    UNION SELECT vendor_id, month FROM pay_agg
  )
  SELECT k.vendor_id,
         k.month,
         COALESCE(e.erp_amount, 0),
         COALESCE(e.erp_items, 0),
         COALESCE(i.invoice_supply, 0),
         COALESCE(i.invoice_count, 0),
         i.last_invoice_date,
         COALESCE(pa.paid_amount, 0)
  FROM keys k
  LEFT JOIN erp     e  ON e.vendor_id = k.vendor_id AND e.month = k.month
  LEFT JOIN inv     i  ON i.vendor_id = k.vendor_id AND i.month = k.month
  LEFT JOIN pay_agg pa ON pa.vendor_id = k.vendor_id AND pa.month = k.month
  ORDER BY k.vendor_id, k.month;
$$;
