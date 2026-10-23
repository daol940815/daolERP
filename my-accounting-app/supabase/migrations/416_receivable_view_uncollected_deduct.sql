-- =====================================================
-- 416_receivable_view_uncollected_deduct.sql  (회계 트랙 — 미수 표준 규칙 보정)
-- 컷오프 예외: ERP가 수금을 하나도 반영하지 않은 주문은 업로드 이전 입금도 차감 (2026-10-23)
-- 선행: 406 → 407 → 408 (적용 확인 2026-10-23)
--
-- 배경 (checks/receivable_unify_followup_check.sql [A])
--   표준 규칙은 "업로드 이전 입금은 ERP outstanding_amount에 이미 반영됐다"는 전제로
--   컷오프(마지막 업로드일) 이전 매칭을 차감하지 않는다. 그런데 전액 입금이 매칭됐는데도
--   ERP 원본미수가 총액 그대로인 주문이 13건(표준미수 6,233,900) 있었다 — 영업지원팀이
--   ERP에 수금을 입력하지 않은 채 업로드된 것. 이 경우 ERP가 뺀 게 없으므로 이중차감이
--   생길 수 없다 → 원본미수 ≥ 총액이면 컷오프와 무관하게 매칭 전액을 차감한다.
--   ERP가 일부라도 반영한 주문(원본미수 < 총액, 예: 5eCbIc2)은 기존 컷오프 규칙 유지.
--
-- 바뀌는 곳: pay CTE의 matched_deducted 조건 1줄. 컬럼 목록·순서는 407과 동일(CREATE OR REPLACE 가능).
--   408의 함수들은 뷰를 읽으므로 그대로. JS 쪽 lib/receivable.ts cutoffAlloc 도 같은 조건 추가.
-- 기대 효과: 12건 미수 0 (−5,777,900) → 전체 표준 미수 255,587,938 → 249,810,038 (실행 시점 데이터 기준)
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
              GREATEST(0, COALESCE(it.net_amount, 0))
            )
  END::BIGINT                            AS outstanding,

  COALESCE(it.has_vip, false)            AS has_vip,
  COALESCE(it.has_prepayment, false)     AS has_prepayment,
  COALESCE(it.has_canceled, false)       AS has_canceled,

  COALESCE(o.total_amount, 0) - COALESCE(it.excluded_amount, 0) AS legacy_net,
  COALESCE(it.item_total, 0)             AS item_total
FROM erp_orders o
LEFT JOIN erp_vendor_aliases a
       ON a.id = o.customer_alias_id AND a.alias_type = 'customer'
LEFT JOIN item it ON it.order_id = o.id
LEFT JOIN pay  p  ON p.order_id = o.id;

COMMENT ON VIEW v_erp_order_receivable IS
  '미수금·순매출 단일 정의 (2026-10 회계 트랙 406/407/416). 주문 1건 = 1행. net_sales = 비제외 품목 합(025와 동일, 하한 없음). outstanding = 수금완료 0, 그 외 LEAST(원본미수-차감매칭, max(0, 순매출)). 차감매칭 = direct 전액 / upload는 컷오프 이후 입금, 단 ERP가 수금을 전혀 반영하지 않은 주문(원본미수>=총액)은 전액(416).';

-- ── 검증 (실행 후) ───────────────────────────────────────
-- 기대: 컷오프전매칭_미수잔존 주문수 1 (5eCbIc2만 남음, 원본미수 < 총액) /
--       표준미수 합계 = 실행 전 합계 − 5,777,900 / 열두 주문 전부 outstanding 0
SELECT
  (SELECT COUNT(*) FROM v_erp_order_receivable) AS view_rows,
  (SELECT COALESCE(SUM(outstanding), 0) FROM v_erp_order_receivable) AS outstanding_total,
  (SELECT COUNT(*) FROM v_erp_order_receivable
    WHERE collect_status <> 'collected' AND matched_pre_cutoff > 0 AND outstanding > 0) AS 컷오프전매칭_미수잔존,
  (SELECT COALESCE(SUM(outstanding), 0) FROM v_erp_order_receivable
    WHERE order_no IN ('qucuhUn','3twVZPy','VIjgk8P','5jLJ4Rk','1PBLUtc','9BZ6VJ_','xzvWd6W',
                       'jDNHHTn','bGNgSRT','zrmrY86','BC5t7lj','5HkTZQB')) AS 열두주문_미수_기대0,
  (SELECT COALESCE(SUM(outstanding), 0) FROM hub_vendor_summary(NULL, NULL)) AS 허브_미수,
  (SELECT outstanding FROM erp_orders_summary(NULL, NULL, NULL, NULL, 'all')) AS 주문KPI_미수;
