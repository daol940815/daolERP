-- =====================================================
-- 1308_receivable_billable_prepay.sql  (결제처리 트랙 — docs/payment-track.md, 회계 트랙 뷰 공유)
-- 미수 상한을 "순매출"에서 "청구 금액(순매출 + 유효 선결제 품목)"으로  (2026-11-19 사용자 승인)
--
-- 배경: D261118-009 = 상품 150만 + 선결제 품목 25만. 미수 상한이 순매출(선결제 제외)이라 받을 돈이 150만으로 잡혀
--       175만 결제를 기록 · 매칭할 수 없었다. 선결제만 있는 주문은 미수 0이라 입금을 붙일 수 없었다(2026-11-05 미결 ①).
-- 결정: 순매출(매출) = 그대로(선결제 제외 — 선수금이라 매출 아님). 받을 돈(청구 금액) = 순매출 + 유효 선결제 품목.
--       선결제 잔액은 지금처럼 주문 저장 즉시 적립(사용 가능). 대신 선결제분도 고객이 돈을 낼 때까지 그 주문의 미수로 남는다.
--       계산서 · 카드도 선결제분 포함 금액으로 매칭한다(코드 쪽).
-- 바뀌는 것: item CTE 에 prepay_amount, outstanding 상한식 1곳, 끝에 칸 2개(prepay_amount · billable). 기존 칸 순서 · 이름 그대로.
--   net_sales 는 그대로 → 월별 손익 · 매출 집계 불변. 이 뷰를 읽는 함수(408 · 허브 요약 등)의 미수가 선결제 미입금분만큼 늘어난다.
-- 선행: 드라이런 supabase/checks/prepay_billable_dryrun.sql 결과 확인(사용자). 재실행 안전.
-- =====================================================

CREATE OR REPLACE VIEW v_erp_order_receivable AS
WITH item AS (
  SELECT i.order_id,
         SUM(CASE WHEN i.is_canceled OR i.is_vip OR i.is_prepayment
                  THEN COALESCE(i.line_total, 0) ELSE 0 END)                       AS excluded_amount,
         SUM(CASE WHEN i.is_canceled OR i.is_vip OR i.is_prepayment
                  THEN 0 ELSE COALESCE(i.line_total, 0) END)                       AS net_amount,
         SUM(COALESCE(i.line_total, 0))                                            AS item_total,
         SUM(CASE WHEN i.is_vip AND NOT i.is_canceled
                  THEN COALESCE(i.line_total, 0) ELSE 0 END)                       AS vip_total,
         -- ★ 1308: 유효 선결제 품목 합 (취소 · VIP 아닌 것) — 매출은 아니지만 받을 돈이다
         SUM(CASE WHEN i.is_prepayment AND NOT i.is_canceled AND NOT i.is_vip
                  THEN COALESCE(i.line_total, 0) ELSE 0 END)                       AS prepay_amount,
         BOOL_OR(i.is_vip)        AS has_vip,
         BOOL_OR(i.is_prepayment) AS has_prepayment,
         BOOL_OR(i.is_canceled)   AS has_canceled
  FROM erp_order_items i
  GROUP BY i.order_id
),
pay AS (
  SELECT m.order_id,
         SUM(m.amount) AS matched_all,
         SUM(CASE WHEN COALESCE(eo.source, 'upload') = 'direct'
                    OR m.paid_date > eo.updated_at::date
                    -- ★ 416: ERP가 수금을 전혀 반영하지 않은 주문은 컷오프 이전 입금도 차감
                    OR COALESCE(eo.outstanding_amount, 0) >= COALESCE(eo.total_amount, 0)
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

  COALESCE(o.total_amount, 0)            AS total_amount,
  COALESCE(it.excluded_amount, 0)        AS excluded_amount,
  COALESCE(it.net_amount, 0)             AS net_sales,
  COALESCE(it.vip_total, 0)              AS vip_total,
  COALESCE(o.outstanding_amount, 0)      AS raw_outstanding,
  COALESCE(p.matched_all, 0)             AS matched_all,
  COALESCE(p.matched_deducted, 0)        AS matched_deducted,
  COALESCE(p.matched_all, 0) - COALESCE(p.matched_deducted, 0) AS matched_pre_cutoff,

  CASE WHEN o.collect_status = 'collected' THEN 0
       ELSE LEAST(
              GREATEST(0, COALESCE(o.outstanding_amount, 0) - COALESCE(p.matched_deducted, 0)),
              -- ★ 1308: 미수 상한 = 청구 금액(순매출 + 유효 선결제). 전에는 순매출이라 선결제분을 받을 돈으로 잡지 못했다
              GREATEST(0, COALESCE(it.net_amount, 0) + COALESCE(it.prepay_amount, 0))
            )
  END::BIGINT                            AS outstanding,

  COALESCE(it.has_vip, false)            AS has_vip,
  COALESCE(it.has_prepayment, false)     AS has_prepayment,
  COALESCE(it.has_canceled, false)       AS has_canceled,

  COALESCE(o.total_amount, 0) - COALESCE(it.excluded_amount, 0) AS legacy_net,
  COALESCE(it.item_total, 0)             AS item_total,
  -- ★ 1308 (새 칸은 끝에만 — CREATE OR REPLACE VIEW 규칙)
  COALESCE(it.prepay_amount, 0)          AS prepay_amount,
  COALESCE(it.net_amount, 0) + COALESCE(it.prepay_amount, 0) AS billable
FROM erp_orders o
LEFT JOIN erp_vendor_aliases a
       ON a.id = o.customer_alias_id AND a.alias_type = 'customer'
LEFT JOIN item it ON it.order_id = o.id
LEFT JOIN pay  p  ON p.order_id = o.id;

COMMENT ON VIEW v_erp_order_receivable IS
  '미수금·순매출 단일 정의 (2026-10 회계 트랙 406/407/416 · 결제처리 1308). 주문 1건 = 1행. net_sales = 비제외 품목 합(매출, 선결제 제외). billable = net_sales + 유효 선결제 품목(받을 돈). outstanding = 수금완료 0, 그 외 LEAST(원본미수-차감매칭, max(0, billable)).';

-- ── 검증 (실행 뒤 결과를 알려 주세요) ─────────────────────
-- 기대: 새 칸 2 · 순매출 합계는 실행 전과 같음 · 미수 합계 = 드라이런 ②의 "바뀐뒤_전체_미수"(취소 주문 포함분 차이만 있을 수 있음)
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'v_erp_order_receivable' AND column_name IN ('prepay_amount', 'billable')) AS new_columns,
  (SELECT COALESCE(SUM(net_sales), 0) FROM v_erp_order_receivable)   AS net_sales_total,
  (SELECT COALESCE(SUM(prepay_amount), 0) FROM v_erp_order_receivable) AS prepay_total,
  (SELECT COALESCE(SUM(outstanding), 0) FROM v_erp_order_receivable)  AS outstanding_total,
  (SELECT count(*) FROM v_erp_order_receivable WHERE prepay_amount > 0 AND outstanding > net_sales) AS prepay_unpaid_orders;
