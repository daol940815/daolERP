-- =====================================================
-- 605_purchase_hub_period_outstanding.sql  (매입처 허브 트랙)
-- 매입처 관리 미지급을 기간 필터에 따라 집계 (2026-11-13 사용자 요청: "미지급 잔액도 기간필터에 따라 집계해줘")
--
-- 정의: 기간 미지급 = 기간 안에 발행된 매입 계산서 중 아직 지급되지 않은 몫.
--   배분은 종전과 같은 FIFO(기준일 이후 지급이 기초 잔여 → 오래된 계산서 순으로 갚음)라서
--   전 기간을 고르면 누적 잔액(과다지급 제외)과 같고, 기간별 값을 더하면 그 합과 같다.
--   기초 잔여(purchase_opening_balances)는 기준일(as_of_date)이 기간 안일 때만 그 기간 몫.
--   과다지급(어느 계산서에도 배분되지 않은 지급)은 특정 기간 몫이 아니므로 기간 미지급에서 뺀다 —
--   상태(과다지급 배지)와 음수 잔액은 종전 outstanding으로 계속 판정한다.
--   기준일(2026-06-30) 이전 발행분은 정산 완료 전제라 기간을 그 이전으로 고르면 0이다.
--
-- 바뀌는 것: 반환 칸 2개 추가(period_outstanding · period_over90). 기존 칸 · 3인자 호출(424 p_asof)은 그대로 —
--   대시보드 요약 줄(loadPayableOutstandingAsOf)과 미지급금 관리 화면은 영향 없음.
-- 반환 형식이 바뀌어 DROP 후 다시 만든다(424와 같은 방식). 본문은 424와 같고 605 표시 3곳만 다르다.
-- lib/purchase-hub.ts의 JS 폴백 · 상세 계산도 같은 규칙.
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
       (GREATEST(0, COALESCE(ob.amount, 0) - COALESCE(pc.paid_after, 0))
        + COALESCE(u.inv_unpaid, 0)
        - GREATEST(0, COALESCE(pc.paid_after, 0) - COALESCE(ob.amount, 0) - COALESCE(u.inv_total_cut, 0)))::bigint,
       COALESCE(u.inv_over90, 0)::bigint,
       GREATEST(0, COALESCE(ob.amount, 0) - COALESCE(pc.paid_after, 0))::bigint,
       GREATEST(ia.last_inv, ea.last_erp),
       -- 605: 기초 잔여는 기초원장 기준일이 기간 안일 때만 그 기간 몫으로 본다
       (CASE WHEN ob.as_of_date IS NOT NULL
                  AND (p_from IS NULL OR ob.as_of_date >= p_from)
                  AND (p_to   IS NULL OR ob.as_of_date <= p_to)
             THEN GREATEST(0, COALESCE(ob.amount, 0) - COALESCE(pc.paid_after, 0)) ELSE 0 END
        + COALESCE(u.per_unpaid, 0))::bigint,
       COALESCE(u.per_over90, 0)::bigint
FROM ids k
LEFT JOIN inv_agg ia ON ia.vid = k.vid
LEFT JOIN pay_agg pa ON pa.vid = k.vid
LEFT JOIN erp_agg ea ON ea.vid = k.vid
LEFT JOIN pay_cut pc ON pc.vid = k.vid
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

-- 검증 ① 전 기간 = 누적 잔액의 양수 몫 합과 같아야 한다 (차이 0 기대 — 과다지급 거래처는 계산서가 모두 갚아져 기간 몫이 0)
SELECT SUM(GREATEST(0, outstanding))                          AS 누적_양수잔액,
       SUM(period_outstanding)                                 AS 기간미지급_전기간,
       SUM(period_outstanding) - SUM(GREATEST(0, outstanding)) AS 차이
FROM hub_purchase_summary(NULL, NULL, NULL);

-- 검증 ② 월별 기간 미지급 (2026-07 이후) — 더하면 전 기간 값과 같다
SELECT m::date AS 월,
       (SELECT SUM(period_outstanding) FROM hub_purchase_summary(m::date, (m + INTERVAL '1 month - 1 day')::date, NULL)) AS 기간미지급
FROM generate_series(DATE '2026-07-01', date_trunc('month', CURRENT_DATE), INTERVAL '1 month') m
ORDER BY 1;
