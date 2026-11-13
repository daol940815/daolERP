-- =====================================================
-- 424_hub_purchase_summary_asof.sql  (회계 트랙 — 스키마)
-- 매입처 집계 함수에 기준일(p_asof) 추가 — 대시보드 요약 줄 "미지급금 (YYYY-MM-DD 기준)" (2026-11-12 사용자 승인)
--
-- 규칙: p_asof가 주어지면 그 날짜까지 발행된 계산서 · 그 날짜까지의 지급(계산서 연결 + 2001 상계)만으로 잔액을 계산하고,
--   90일 초과 판정도 그 날짜 기준. 기준일보다 뒤에 잡힌 기초원장은 없는 것으로 본다(그 전 계산서를 다시 포함).
--   p_asof가 NULL이면 종전(601)과 완전히 같다 — 기존 화면·API의 호출은 바뀌지 않는다.
-- 601의 본문에 p_asof 조건 4곳 + CURRENT_DATE 1곳만 더한 것. lib/purchase-hub.ts JS 폴백은 p_asof 없이만 동작(기준일 조회는 RPC 필요).
--
-- 주의: 기존 2인자 함수를 지우고 3인자(기본값 NULL)로 다시 만든다 — 같이 두면 2인자 호출이 "function is not unique"가 된다.
-- =====================================================

DROP FUNCTION IF EXISTS hub_purchase_summary_json(DATE, DATE);
DROP FUNCTION IF EXISTS hub_purchase_summary(DATE, DATE);

CREATE OR REPLACE FUNCTION hub_purchase_summary(p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL, p_asof DATE DEFAULT NULL)
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
  WHERE p_asof IS NULL OR pob.as_of_date <= p_asof      -- 424: 기준일보다 뒤의 기초원장은 없는 것으로
),
inv AS (
  SELECT t.vendor_id AS vid, t.id, t.issue_date, COALESCE(t.total_amount, 0) AS total
  FROM tax_invoices t
  WHERE t.direction = 'purchase' AND t.vendor_id IS NOT NULL
    AND (p_asof IS NULL OR t.issue_date <= p_asof)      -- 424: 기준일까지 발행된 계산서만
),
pay AS (
  -- 계산서 연결 지급 (지급일 = 거래일, 연결 계산서 발행일 동반 — 컷오프 판정용)
  SELECT ti.vendor_id AS vid, tx.tx_date, p.amount, ti.issue_date AS linked_issue
  FROM tax_invoice_payments p
  JOIN tax_invoices ti ON ti.id = p.tax_invoice_id AND ti.direction = 'purchase'
  JOIN transactions tx ON tx.id = p.transaction_id
  WHERE ti.vendor_id IS NOT NULL
    AND (p_asof IS NULL OR tx.tx_date <= p_asof)        -- 424: 기준일까지의 지급만
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
    AND (p_asof IS NULL OR tx.tx_date <= p_asof)        -- 424
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
                    FILTER (WHERE issue_date < COALESCE(p_asof, CURRENT_DATE) - 90), 0)   AS inv_over90,
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


-- JSONB 단일 응답 버전 (600 패턴) — 3인자
CREATE OR REPLACE FUNCTION hub_purchase_summary_json(p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL, p_asof DATE DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
  FROM hub_purchase_summary(p_from, p_to, p_asof) x
$$;

-- 검증 ① 기준일 없이 = 종전과 같은 합계 (매입처 관리 상단 미지급 잔액과 비교)
SELECT COALESCE(SUM(GREATEST(0, outstanding)), 0) AS 미지급_현재
FROM hub_purchase_summary(NULL, NULL, NULL) s
JOIN vendors v ON v.id = s.vendor_id
WHERE COALESCE(v.purchase_kind, 'partner') <> 'retail';

-- 검증 ② 기준일 2026-10-31 — 현재보다 작거나 같은 것이 보통(이후 계산서가 빠지고 이후 지급도 빠짐)
SELECT COALESCE(SUM(GREATEST(0, outstanding)), 0) AS 미지급_1031기준
FROM hub_purchase_summary(NULL, NULL, DATE '2026-10-31') s
JOIN vendors v ON v.id = s.vendor_id
WHERE COALESCE(v.purchase_kind, 'partner') <> 'retail';
