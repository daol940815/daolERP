-- =====================================================
-- 407_receivable_view_net_sales_fix.sql  (회계 트랙)
-- 406 뷰 보정 — 순매출 정의를 품목 합으로 바꾸고 0 하한을 걷어낸다.
-- 뷰만 교체하므로 **이 파일을 실행해도 화면 숫자는 바뀌지 않는다**
-- (기존 함수들은 아직 뷰를 쓰지 않는다. 숫자가 바뀌는 건 408부터다.)
--
-- ── 왜 바꾸는가 (2026-10-01 데이터 확인 결과) ────────────────
-- 406은 순매출을 `GREATEST(0, 총액 − 제외금액)`으로 뒀는데 둘 다 틀렸다.
--
-- (1) `erp_orders.total_amount`의 의미가 주문마다 다르다
--     8,635건 중 7,938건은 total_amount가 이미 제외 품목이 빠진 금액이고,
--     697건은 제외 품목이 포함된 금액이다(총액이 더 큼 681건 823,091,060원 /
--     더 작음 16건 21,170,080원). 그래서 `총액 − 제외`는 7,938건에서 제외를
--     두 번 빼고, `총액` 그대로는 697건에서 제외를 안 뺀다.
--
-- (2) 월별 손익(025)과의 대조에서 품목 합만 매월 정확히 일치했다
--       2026-01  ①총액-제외 352,324,760 / ②총액 410,394,460 / ③품목합 377,912,660
--                025 매출                                      377,912,660  ← ③
--       2026-02 ~ 2026-08 전 월 동일하게 ③만 일치.
--     전체 기간: ① 5,849,863,431 / ② 7,112,199,895 / ③ 6,310,278,915
--
-- (3) 반품·정정 주문(총액 음수 219건, -112,377,495원)이 있어 0 하한을 두면
--     반품이 매출에서 사라진다. 025도 하한이 없다 → 순매출에서 하한을 뺀다.
--     대신 **미수 상한에만** 0 하한을 걸어 미수가 음수가 되지 않게 한다
--     (원본미수 음수 8건 -1,329,500원 존재).
--
-- ── 바뀐 표준 규칙 ──────────────────────────────────────────
--   순매출 = Σ(취소·VIP·선결제가 아닌 품목의 line_total)   -- 025와 동일, 하한 없음
--   미수   = 수금완료 ? 0
--          : LEAST( GREATEST(0, 원본미수 − 컷오프 통과 매칭), GREATEST(0, 순매출) )
--
-- `legacy_net`(= 총액 − 제외)은 기존 함수 재현·비교 전용으로 남긴다. 새 코드는 쓰지 말 것.
-- =====================================================

CREATE OR REPLACE VIEW v_erp_order_receivable AS
WITH item AS (
  SELECT i.order_id,
         -- 제외 품목(취소·VIP·선결제) 합계 — 참고·기존 공식 재현용
         SUM(CASE WHEN i.is_canceled OR i.is_vip OR i.is_prepayment
                  THEN COALESCE(i.line_total, 0) ELSE 0 END)                       AS excluded_amount,
         -- ★ 순매출: 비제외 품목 합계 (월별 손익 025와 같은 정의, 하한 없음)
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
  -- ★ 순매출 = 비제외 품목 합 (하한 없음)
  COALESCE(it.net_amount, 0)             AS net_sales,
  COALESCE(it.vip_total, 0)              AS vip_total,
  COALESCE(o.outstanding_amount, 0)      AS raw_outstanding,
  COALESCE(p.matched_all, 0)             AS matched_all,
  COALESCE(p.matched_deducted, 0)        AS matched_deducted,
  COALESCE(p.matched_all, 0) - COALESCE(p.matched_deducted, 0) AS matched_pre_cutoff,

  -- ★ 표준 미수
  CASE WHEN o.collect_status = 'collected' THEN 0
       ELSE LEAST(
              GREATEST(0, COALESCE(o.outstanding_amount, 0) - COALESCE(p.matched_deducted, 0)),
              GREATEST(0, COALESCE(it.net_amount, 0))
            )
  END::BIGINT                            AS outstanding,

  COALESCE(it.has_vip, false)            AS has_vip,
  COALESCE(it.has_prepayment, false)     AS has_prepayment,
  COALESCE(it.has_canceled, false)       AS has_canceled,

  -- ↓ 비교·재현 전용 (새 코드는 쓰지 말 것)
  COALESCE(o.total_amount, 0) - COALESCE(it.excluded_amount, 0) AS legacy_net,
  COALESCE(it.item_total, 0)             AS item_total
FROM erp_orders o
LEFT JOIN erp_vendor_aliases a
       ON a.id = o.customer_alias_id AND a.alias_type = 'customer'
LEFT JOIN item it ON it.order_id = o.id
LEFT JOIN pay  p  ON p.order_id = o.id;

COMMENT ON VIEW v_erp_order_receivable IS
  '미수금·순매출 단일 정의 (2026-10 회계 트랙 406/407). 주문 1건 = 1행. net_sales = 비제외 품목 합(월별 손익 025와 동일, 하한 없음). outstanding = 수금완료 0, 그 외 LEAST(원본미수-컷오프통과매칭, max(0, 순매출)). legacy_net(총액-제외)은 기존 함수 재현 비교용.';

-- ── 검증 (실행 후) ───────────────────────────────────────
-- 기대 1: 뷰 행수 = 주문 건수
-- 기대 2: 순매출 합계 = 6,310,278,915 (= 월별 손익 025 전체 기간 매출)
-- 기대 3: legacy 순매출 = 5,849,863,431 (기존 022 함수 값과 동일)
SELECT (SELECT COUNT(*) FROM erp_orders)                            AS orders_rows,
       (SELECT COUNT(*) FROM v_erp_order_receivable)                AS view_rows,
       (SELECT SUM(net_sales)   FROM v_erp_order_receivable)        AS net_sales_new,
       (SELECT SUM(legacy_net)  FROM v_erp_order_receivable)        AS net_sales_legacy,
       (SELECT SUM(outstanding) FROM v_erp_order_receivable)        AS outstanding_total,
       (SELECT COUNT(*)         FROM v_erp_order_receivable WHERE outstanding > 0) AS outstanding_orders;
