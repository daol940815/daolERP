-- =====================================================
-- 601_purchase_hub_cutoff_links.sql
-- 매입처 허브 컷오프 규칙 보강 (2026-08-11 승인)
--
-- 배경: 기초원장 일괄 적재(기준일 2026-06-30, 잔액 0 — "6월까지 정산 완료" 전제)
-- 시, 6월 말 발행 계산서를 7월 초에 지급하는 통상 패턴에서 계산서는 컷오프로
-- 제외되는데 지급만 날짜 기준으로 집계되어 과다지급(음수 잔액)이 무더기로 발생.
--
-- 보강: "기준일 이전 원본은 잔액 계산에서 제외" 선언을 지급까지 완성한다 —
--   기준일 이전 발행 계산서에 연결된 지급은, 지급일이 기준일 이후라도 제외.
--   (그 채무는 기초잔액에 이미 확정되어 있으므로 또 빼면 이중 차감)
--   연결 없는 지급(2001 상계 확정 출금)은 종전대로 지급일 기준.
--
-- 함께 보강: 카드사 거래처(card_accounts.vendor_id)의 2001 상계 출금은
--   계산서 지급 인식에서 제외한다. 카드대금 출금은 가맹점 매입의 지급이지
--   카드사 매입 계산서의 지급이 아니며(카드사는 계산서를 발행하지 않음),
--   포함하면 카드사 매입처에 과다지급이 매월 무한 누적된다 (적재 검증에서 확인).
--   카드사 미지급(카드대금)은 미지급금(2001) 원장·법인카드 화면이 관리한다.
--
-- 기간 지표(paid_amount)는 변경하지 않는다 — 실제 현금 지출 사실의 표시.
-- lib/purchase-hub.ts의 JS 폴백·상세 계산과 규칙이 항상 일치해야 한다.
-- =====================================================

CREATE OR REPLACE FUNCTION hub_purchase_summary(p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL)
RETURNS TABLE (
  vendor_id          UUID,
  invoice_count      INT,
  invoice_total      BIGINT,
  erp_amount         BIGINT,
  paid_amount        BIGINT,
  outstanding        BIGINT,
  over90             BIGINT,
  opening_remain     BIGINT,
  last_purchase_date DATE
)
LANGUAGE sql
STABLE
AS $$
WITH ob AS (
  SELECT pob.vendor_id AS vid, pob.as_of_date, pob.amount
  FROM purchase_opening_balances pob
),
inv AS (
  SELECT t.vendor_id AS vid, t.id, t.issue_date, COALESCE(t.total_amount, 0) AS total
  FROM tax_invoices t
  WHERE t.direction = 'purchase' AND t.vendor_id IS NOT NULL
),
pay AS (
  -- 계산서 연결 지급 (지급일 = 거래일, 연결 계산서 발행일 동반 — 컷오프 판정용)
  SELECT ti.vendor_id AS vid, tx.tx_date, p.amount, ti.issue_date AS linked_issue
  FROM tax_invoice_payments p
  JOIN tax_invoices ti ON ti.id = p.tax_invoice_id AND ti.direction = 'purchase'
  JOIN transactions tx ON tx.id = p.transaction_id
  WHERE ti.vendor_id IS NOT NULL
  UNION ALL
  -- 미지급금(2001) 상계 확정 출금 중 계산서 연결이 없는 것 (이중집계 방지)
  -- 601: 카드사 거래처는 제외 — 카드대금 출금은 계산서 지급이 아니다 (상단 주석)
  SELECT tx.vendor_id, tx.tx_date, COALESCE(tx.amount_out, 0), NULL::date
  FROM transactions tx
  JOIN accounts ac ON ac.id = tx.confirmed_account_id AND ac.code = '2001'
  WHERE tx.vendor_id IS NOT NULL
    AND tx.status = 'confirmed'
    AND COALESCE(tx.amount_out, 0) > 0
    AND NOT EXISTS (SELECT 1 FROM tax_invoice_payments p2 WHERE p2.transaction_id = tx.id)
    AND NOT EXISTS (SELECT 1 FROM card_accounts ca WHERE ca.vendor_id = tx.vendor_id)
),
erp AS (
  SELECT a.vendor_id AS vid,
         COALESCE(NULLIF(substr(i.settlement_month, 1, 7), '') || '-01', o.order_date::text)::date AS pdate,
         COALESCE(i.purchase_total, 0) AS amt
  FROM erp_order_items i
  JOIN erp_orders o ON o.id = i.order_id
  JOIN erp_vendor_aliases a ON a.id = i.purchase_alias_id
  WHERE NOT i.is_canceled
    AND a.vendor_id IS NOT NULL
),
inv_agg AS (
  SELECT vid,
         COUNT(*) FILTER (WHERE (p_from IS NULL OR issue_date >= p_from)
                            AND (p_to   IS NULL OR issue_date <= p_to))::int    AS cnt,
         COALESCE(SUM(total) FILTER (WHERE (p_from IS NULL OR issue_date >= p_from)
                                       AND (p_to   IS NULL OR issue_date <= p_to)), 0) AS tot,
         MAX(issue_date) AS last_inv
  FROM inv GROUP BY vid
),
pay_agg AS (
  SELECT vid,
         COALESCE(SUM(amount) FILTER (WHERE (p_from IS NULL OR tx_date >= p_from)
                                        AND (p_to   IS NULL OR tx_date <= p_to)), 0) AS paid
  FROM pay GROUP BY vid
),
erp_agg AS (
  SELECT vid,
         COALESCE(SUM(amt) FILTER (WHERE (p_from IS NULL OR pdate >= p_from)
                                     AND (p_to   IS NULL OR pdate <= p_to)), 0) AS amt,
         MAX(pdate) AS last_erp
  FROM erp GROUP BY vid
),
-- 컷오프 이후 지급 누계 (601: 기준일 이전 발행 계산서에 연결된 지급도 제외)
pay_cut AS (
  SELECT p.vid, SUM(p.amount) AS paid_after
  FROM pay p
  LEFT JOIN ob ON ob.vid = p.vid
  WHERE (ob.as_of_date IS NULL OR p.tx_date > ob.as_of_date)
    AND (ob.as_of_date IS NULL OR p.linked_issue IS NULL OR p.linked_issue > ob.as_of_date)
  GROUP BY p.vid
),
inv_cut AS (
  SELECT i.vid, i.issue_date, i.total,
         SUM(i.total) OVER (PARTITION BY i.vid ORDER BY i.issue_date, i.id) AS cum
  FROM inv i
  LEFT JOIN ob ON ob.vid = i.vid
  WHERE ob.as_of_date IS NULL OR i.issue_date > ob.as_of_date
),
alloc AS (
  SELECT ic.vid, ic.issue_date, ic.total, ic.cum,
         GREATEST(0, COALESCE(pc.paid_after, 0) - COALESCE(ob.amount, 0)) AS paid_to_inv
  FROM inv_cut ic
  LEFT JOIN pay_cut pc ON pc.vid = ic.vid
  LEFT JOIN ob ON ob.vid = ic.vid
),
unpaid AS (
  SELECT vid,
         COALESCE(SUM(LEAST(total, GREATEST(0, cum - paid_to_inv))), 0) AS inv_unpaid,
         COALESCE(SUM(LEAST(total, GREATEST(0, cum - paid_to_inv)))
                    FILTER (WHERE issue_date < CURRENT_DATE - 90), 0)   AS inv_over90,
         COALESCE(SUM(total), 0) AS inv_total_cut
  FROM alloc GROUP BY vid
),
ids AS (
  SELECT vid FROM inv UNION SELECT vid FROM pay
  UNION SELECT vid FROM erp UNION SELECT vid FROM ob
)
SELECT k.vid,
       COALESCE(ia.cnt, 0),
       COALESCE(ia.tot, 0)::bigint,
       COALESCE(ea.amt, 0)::bigint,
       COALESCE(pa.paid, 0)::bigint,
       (GREATEST(0, COALESCE(ob.amount, 0) - COALESCE(pc.paid_after, 0))
        + COALESCE(u.inv_unpaid, 0)
        - GREATEST(0, COALESCE(pc.paid_after, 0) - COALESCE(ob.amount, 0) - COALESCE(u.inv_total_cut, 0)))::bigint,
       COALESCE(u.inv_over90, 0)::bigint,
       GREATEST(0, COALESCE(ob.amount, 0) - COALESCE(pc.paid_after, 0))::bigint,
       GREATEST(ia.last_inv, ea.last_erp)
FROM ids k
LEFT JOIN inv_agg ia ON ia.vid = k.vid
LEFT JOIN pay_agg pa ON pa.vid = k.vid
LEFT JOIN erp_agg ea ON ea.vid = k.vid
LEFT JOIN pay_cut pc ON pc.vid = k.vid
LEFT JOIN unpaid  u  ON u.vid  = k.vid
LEFT JOIN ob         ON ob.vid = k.vid
$$;

-- hub_purchase_summary_json은 위 함수를 감싸므로 자동으로 새 규칙을 따른다.
