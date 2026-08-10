-- =====================================================
-- 600_purchase_hub.sql
-- 매입처 허브 트랙 기반 (docs/purchase-hub-track.md)
--
-- 1) purchase_opening_balances — 매입처 미결제금 기초원장 (기준일 + 기초잔액)
--    vendor_opening_balances(048)와 분리하는 이유:
--      · VOB.amount는 거래처원장 이월 규약(양수=미수, 음수=미지급)과 얽혀 있고
--        collected_amount(068)는 매출 Aging 차감 전용이라 의미가 다르다.
--      · 매입처 미지급 잔액은 "기준일 기초잔액 + 기준일 이후 계산서(+)
--        - 기준일 이후 지급(-)" 증분 방식(회계 트랙 확정)이라
--        기준일(as_of_date)이 계산의 축이다. 기준일 이전 원본(계산서·출금)은
--        잔액 계산에서 제외해 이중계상을 막는다.
--    적재는 사용자의 매입처별 결제현황 엑셀 기준
--    (승인 → 드라이런 → 실행 → 검증 보고 루틴, 후속 작업).
--
-- 2) hub_purchase_summary(_json) — 매입처 허브 목록 집계 RPC.
--    지급 인식 규칙은 060 purchase_cycle_summary와 동일해야 한다:
--      계산서 연결 지급(tax_invoice_payments) + 미지급금(2001) 상계 확정
--      출금 중 계산서 연결이 없는 것(이중집계 방지).
--    lib/purchase-hub.ts의 JS 폴백과 규칙이 항상 일치해야 한다.
-- =====================================================

CREATE TABLE IF NOT EXISTS purchase_opening_balances (
  vendor_id   UUID        PRIMARY KEY REFERENCES vendors(id) ON DELETE CASCADE,
  as_of_date  DATE        NOT NULL,               -- 기준일: 이후 원본 증분만 잔액에 반영
  amount      BIGINT      NOT NULL DEFAULT 0 CHECK (amount >= 0),  -- 기준일 미지급 잔액(양수)
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE purchase_opening_balances IS
  '매입처 미결제금 기초원장. 미지급 잔액 = amount + (as_of_date 이후 매입 계산서 총액) - (as_of_date 이후 지급). 기준일 이전 원본은 잔액 계산에서 제외(이중계상 방지). vendor_opening_balances(원장 이월)와 별개.';

DROP TRIGGER IF EXISTS trg_pob_updated_at ON purchase_opening_balances;
CREATE TRIGGER trg_pob_updated_at
  BEFORE UPDATE ON purchase_opening_balances
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 집계가 훑는 경로 인덱스 보강
CREATE INDEX IF NOT EXISTS idx_tax_invoices_purchase_vendor
  ON tax_invoices(vendor_id, issue_date)
  WHERE direction = 'purchase';
CREATE INDEX IF NOT EXISTS idx_transactions_vendor_out_confirmed
  ON transactions(vendor_id, tx_date)
  WHERE status = 'confirmed' AND amount_out > 0;

-- ── 매입처 허브 목록 집계 ────────────────────────────────────────────
-- 반환 규칙:
--   invoice_count/invoice_total/paid_amount/erp_amount = 기간 지표
--   outstanding = 누적 미지급 잔액 (기초원장 컷오프 반영, 음수 = 과다지급)
--   over90      = 발행 90일 초과 계산서의 미지급 잔여 (FIFO 배분, 기초이월 제외)
--   opening_remain = 기초잔액 중 미지급 잔여 (outstanding에 포함되어 있음)
--   last_purchase_date = 기간 무관 최근 매입일 (계산서 발행일 ∪ ERP 발주일 — 휴면 판정용)
-- FIFO: 기준일 이후 지급이 기초잔액을 먼저 갚고, 남은 몫이 계산서를
--       발행일 오래된 순으로 커버한다. 커버되지 않은 잔여가 계산서별 미지급.
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
  -- 계산서 연결 지급 (지급일 = 거래일)
  SELECT ti.vendor_id AS vid, tx.tx_date, p.amount
  FROM tax_invoice_payments p
  JOIN tax_invoices ti ON ti.id = p.tax_invoice_id AND ti.direction = 'purchase'
  JOIN transactions tx ON tx.id = p.transaction_id
  WHERE ti.vendor_id IS NOT NULL
  UNION ALL
  -- 미지급금(2001) 상계 확정 출금 중 계산서 연결이 없는 것 (이중집계 방지)
  SELECT tx.vendor_id, tx.tx_date, COALESCE(tx.amount_out, 0)
  FROM transactions tx
  JOIN accounts ac ON ac.id = tx.confirmed_account_id AND ac.code = '2001'
  WHERE tx.vendor_id IS NOT NULL
    AND tx.status = 'confirmed'
    AND COALESCE(tx.amount_out, 0) > 0
    AND NOT EXISTS (SELECT 1 FROM tax_invoice_payments p2 WHERE p2.transaction_id = tx.id)
),
erp AS (
  -- ERP 발주(품목 매입) — 취소 제외, 귀속일 = 정산월 1일(없으면 주문일)
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
-- 컷오프 이후 지급 누계 (기초잔액 우선 배분용)
pay_cut AS (
  SELECT p.vid, SUM(p.amount) AS paid_after
  FROM pay p
  LEFT JOIN ob ON ob.vid = p.vid
  WHERE ob.as_of_date IS NULL OR p.tx_date > ob.as_of_date
  GROUP BY p.vid
),
-- 컷오프 이후 계산서 + FIFO 누적
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

-- 행 반환 RPC는 PostgREST max-rows(1000)에 잘리고 페이지마다 재실행되므로
-- JSONB 단일 응답 버전을 1순위로 쓴다 (102 패턴).
CREATE OR REPLACE FUNCTION hub_purchase_summary_json(p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
  FROM hub_purchase_summary(p_from, p_to) x
$$;
