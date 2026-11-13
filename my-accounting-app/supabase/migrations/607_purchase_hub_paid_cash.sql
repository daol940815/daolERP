-- =====================================================
-- 607_purchase_hub_paid_cash.sql  (매입처 허브 트랙)
-- 지급액 = 이 매입처로 나간 통장 출금 (계산서 연결 여부 무관) — 2026-11-13 사용자 결정
--   "지급액이란 우리가 매입처에 입금한 금액이다. 계산서에 매칭되지 않아도 통장에서 나간 돈이면 지급액에 포함해야 한다."
--
-- 종전(600~606): 지급액 = 계산서 연결 금액 + 연결 없는 2001 확정 출금. 그래서 계산서 없이 나간 돈(제주 담은 귤 2/27 잔여 2,595,500)이
--   지급액에서 빠져 상세 '통장 출금' 178,199,600과 지급액 175,604,100이 어긋났다.
-- 새 규칙(기간 지표 paid_amount만):
--   ① 이 매입처로 지정된 출금(transactions.vendor_id, 이체쌍 제외, 상태 무관) — 단 다른 거래처 계산서에 연결된 몫은 그 거래처 것이라 뺀다
--   ② 다른 거래처로 지정됐지만 이 매입처 계산서에 연결된 몫은 더한다
--   카드사 거래처는 제외(카드대금 출금은 가맹점 매입의 지급 — 601과 같은 판단).
--   ids(목록 대상)는 넓히지 않는다 — 출금만 있는 매출처(환불 등)가 매입처 목록에 새로 들어오지 않게.
-- 바뀌지 않는 것: 미지급 잔액 · 90일 초과 · 기간 미지급 · 지급율(계산서 기준 배분, 600~606 그대로).
-- 본문은 606과 같고 607 표시 부분만 다르다. lib/purchase-hub.ts JS 폴백 · 상세도 같은 규칙.
-- =====================================================

DROP FUNCTION IF EXISTS hub_purchase_summary_json(DATE, DATE, DATE);
DROP FUNCTION IF EXISTS hub_purchase_summary(DATE, DATE, DATE);

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
  last_purchase_date DATE,
  period_outstanding BIGINT,   -- 605: 기간(p_from~p_to) 발행 계산서의 미지급 + 기간에 든 기초 잔여 (과다지급 제외)
  period_over90      BIGINT    -- 605: 그중 발행 90일 초과분
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
-- 607: 지급액(기간 지표) = 이 매입처로 나간 통장 출금 (상단 주석 ①②)
other_link AS (
  SELECT p.transaction_id, SUM(p.amount) AS amt
  FROM tax_invoice_payments p
  JOIN tax_invoices ti ON ti.id = p.tax_invoice_id
  JOIN transactions tx ON tx.id = p.transaction_id
  WHERE ti.vendor_id IS DISTINCT FROM tx.vendor_id
  GROUP BY p.transaction_id
),
pay_cash AS (
  SELECT tx.vendor_id AS vid, tx.tx_date,
         GREATEST(0, COALESCE(tx.amount_out, 0) - COALESCE(ol.amt, 0)) AS amount
  FROM transactions tx
  LEFT JOIN other_link ol ON ol.transaction_id = tx.id
  WHERE tx.vendor_id IS NOT NULL
    AND tx.transfer_pair_id IS NULL
    AND COALESCE(tx.amount_out, 0) > 0
    AND (p_asof IS NULL OR tx.tx_date <= p_asof)
  UNION ALL
  SELECT ti.vendor_id, tx.tx_date, p.amount
  FROM tax_invoice_payments p
  JOIN tax_invoices ti ON ti.id = p.tax_invoice_id AND ti.direction = 'purchase'
  JOIN transactions tx ON tx.id = p.transaction_id
  WHERE ti.vendor_id IS NOT NULL
    AND tx.vendor_id IS DISTINCT FROM ti.vendor_id
    AND tx.transfer_pair_id IS NULL
    AND (p_asof IS NULL OR tx.tx_date <= p_asof)
),
pay_agg AS (
  SELECT vid,
         COALESCE(SUM(amount) FILTER (WHERE (p_from IS NULL OR tx_date >= p_from)
                                        AND (p_to   IS NULL OR tx_date <= p_to)), 0) AS paid
  FROM pay_cash
  WHERE NOT EXISTS (SELECT 1 FROM card_accounts ca WHERE ca.vendor_id = pay_cash.vid)
  GROUP BY vid
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
-- 606: 배분 대상은 플러스 계산서만
inv_cut AS (
  SELECT i.vid, i.issue_date, i.total,
         SUM(i.total) OVER (PARTITION BY i.vid ORDER BY i.issue_date, i.id) AS cum
  FROM inv i
  LEFT JOIN ob ON ob.vid = i.vid
  WHERE (ob.as_of_date IS NULL OR i.issue_date > ob.as_of_date)
    AND i.total > 0
),
-- 606: 기준일 이후 마이너스(수정) 계산서 = 매입처가 깎아 준 금액 → 지급과 함께 갚는 몫
credit_cut AS (
  SELECT i.vid, SUM(-i.total) AS credit
  FROM inv i
  LEFT JOIN ob ON ob.vid = i.vid
  WHERE (ob.as_of_date IS NULL OR i.issue_date > ob.as_of_date)
    AND i.total < 0
  GROUP BY i.vid
),
pool AS (
  SELECT vid, SUM(amt) AS amt
  FROM (SELECT vid, paid_after AS amt FROM pay_cut
        UNION ALL
        SELECT vid, credit FROM credit_cut) z
  GROUP BY vid
),
alloc AS (
  SELECT ic.vid, ic.issue_date, ic.total, ic.cum,
         GREATEST(0, COALESCE(pl.amt, 0) - COALESCE(ob.amount, 0)) AS paid_to_inv
  FROM inv_cut ic
  LEFT JOIN pool pl ON pl.vid = ic.vid
  LEFT JOIN ob ON ob.vid = ic.vid
),
unpaid AS (
  SELECT vid,
         COALESCE(SUM(LEAST(total, GREATEST(0, cum - paid_to_inv))), 0) AS inv_unpaid,
         COALESCE(SUM(LEAST(total, GREATEST(0, cum - paid_to_inv)))
                    FILTER (WHERE issue_date < COALESCE(p_asof, CURRENT_DATE) - 90), 0)   AS inv_over90,
         COALESCE(SUM(total), 0) AS inv_total_cut,
         -- 605: 기간 발행분 미지급 (같은 FIFO 배분 — 전 기간 합 = 누적 잔액의 계산서 몫)
         COALESCE(SUM(LEAST(total, GREATEST(0, cum - paid_to_inv)))
                    FILTER (WHERE (p_from IS NULL OR issue_date >= p_from)
                              AND (p_to   IS NULL OR issue_date <= p_to)), 0) AS per_unpaid,
         COALESCE(SUM(LEAST(total, GREATEST(0, cum - paid_to_inv)))
                    FILTER (WHERE (p_from IS NULL OR issue_date >= p_from)
                              AND (p_to   IS NULL OR issue_date <= p_to)
                              AND issue_date < COALESCE(p_asof, CURRENT_DATE) - 90), 0) AS per_over90
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
       -- 606: pool = 기준일 이후 지급 + 마이너스 계산서 차감액
       (GREATEST(0, COALESCE(ob.amount, 0) - COALESCE(pl.amt, 0))
        + COALESCE(u.inv_unpaid, 0)
        - GREATEST(0, COALESCE(pl.amt, 0) - COALESCE(ob.amount, 0) - COALESCE(u.inv_total_cut, 0)))::bigint,
       COALESCE(u.inv_over90, 0)::bigint,
       GREATEST(0, COALESCE(ob.amount, 0) - COALESCE(pl.amt, 0))::bigint,
       GREATEST(ia.last_inv, ea.last_erp),
       -- 605: 기초 잔여는 기초원장 기준일이 기간 안일 때만 그 기간 몫으로 본다
       (CASE WHEN ob.as_of_date IS NOT NULL
                  AND (p_from IS NULL OR ob.as_of_date >= p_from)
                  AND (p_to   IS NULL OR ob.as_of_date <= p_to)
             THEN GREATEST(0, COALESCE(ob.amount, 0) - COALESCE(pl.amt, 0)) ELSE 0 END
        + COALESCE(u.per_unpaid, 0))::bigint,
       COALESCE(u.per_over90, 0)::bigint
FROM ids k
LEFT JOIN inv_agg ia ON ia.vid = k.vid
LEFT JOIN pay_agg pa ON pa.vid = k.vid
LEFT JOIN erp_agg ea ON ea.vid = k.vid
LEFT JOIN pool    pl ON pl.vid = k.vid
LEFT JOIN unpaid  u  ON u.vid  = k.vid
LEFT JOIN ob         ON ob.vid = k.vid
$$;

-- JSONB 단일 응답 버전 (600 패턴) — 3인자, 새 칸은 to_jsonb로 자동 포함
CREATE OR REPLACE FUNCTION hub_purchase_summary_json(p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL, p_asof DATE DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
  FROM hub_purchase_summary(p_from, p_to, p_asof) x
$$;

-- 검증 ① 제주 담은 귤 — 지급액(전 기간) = 통장 출금 178,199,600 기대 (종전 175,604,100)
SELECT v.name, s.invoice_total, s.paid_amount, s.outstanding
FROM hub_purchase_summary(NULL, NULL, NULL) s JOIN vendors v ON v.id = s.vendor_id
WHERE v.id = '37f2b89b-18fa-4746-a6a9-7af9fbbf3b22';

-- 검증 ② 잔액 · 기간 미지급은 606과 같아야 한다 (누적 양수 잔액 = 전 기간 기간 미지급 = 419,319,976 근처, 차이 0)
SELECT SUM(GREATEST(0, outstanding)) AS 누적_양수잔액, SUM(period_outstanding) AS 기간미지급_전기간,
       SUM(period_outstanding) - SUM(GREATEST(0, outstanding)) AS 차이
FROM hub_purchase_summary(NULL, NULL, NULL);
