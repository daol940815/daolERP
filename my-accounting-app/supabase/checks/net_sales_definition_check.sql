-- =====================================================
-- net_sales_definition_check.sql  (읽기 전용 — 데이터 변경 없음)
-- 순매출 정의 확정용 진단 (2026-10-01)
-- 선행: 406 실행
--
-- 앞선 진단에서 나온 합계 항등식
--   Σ(총액)                      = 6,310,278,915  (= ③ 품목합_비제외)
--   Σ(총액 − 제외)               = 5,849,863,431  (= ① 현재 022·107·037 공식)
--   차이                          =   460,415,484  = Σ(제외금액)
--   → 합계 수준에서는 total_amount가 이미 '취소·VIP·선결제를 뺀 금액'이다.
--     그렇다면 현재 공식 `총액 − 제외`는 제외 품목을 두 번 빼고 있다.
--
-- 다만 표본에는 총액 ≠ 비제외품목합인 주문도 있었다(5t4dgnN, nEyZzyD).
-- 합계가 맞는다고 주문 단위로도 맞는다는 보장은 없으므로 **주문 단위로 확인**한다.
-- 이 결과로 순매출 정의를 확정하고 407을 작성한다.
-- =====================================================

WITH it AS (
  SELECT order_id,
         SUM(COALESCE(line_total, 0)) AS item_total,
         SUM(CASE WHEN is_canceled OR is_vip OR is_prepayment
                  THEN 0 ELSE COALESCE(line_total, 0) END) AS item_net
  FROM erp_order_items
  GROUP BY order_id
),
d AS (
  SELECT v.*, COALESCE(it.item_total, 0) AS item_total, COALESCE(it.item_net, 0) AS item_net,
         COALESCE(v.total_amount, 0) - COALESCE(it.item_net, 0) AS gap
  FROM v_erp_order_receivable v
  LEFT JOIN it ON it.order_id = v.order_id
)

SELECT jsonb_pretty(jsonb_build_object(

  -- [1] 핵심 질문: total_amount == 비제외 품목합 인가 (주문 단위)
  '총액_vs_비제외품목합', jsonb_build_object(
    '전체주문',   (SELECT COUNT(*) FROM d),
    '일치',       (SELECT COUNT(*) FROM d WHERE gap = 0),
    '불일치',     (SELECT COUNT(*) FROM d WHERE gap <> 0),
    '불일치_순차액', (SELECT COALESCE(SUM(gap), 0) FROM d WHERE gap <> 0),
    '불일치_절대값합', (SELECT COALESCE(SUM(abs(gap)), 0) FROM d WHERE gap <> 0),
    '총액이_더큼', (SELECT jsonb_build_object('건수', COUNT(*), '금액', COALESCE(SUM(gap), 0))
                    FROM d WHERE gap > 0),
    '총액이_더작음', (SELECT jsonb_build_object('건수', COUNT(*), '금액', COALESCE(SUM(-gap), 0))
                      FROM d WHERE gap < 0)
  ),

  -- [2] 순매출 정의별 합계 (전체 기간)
  '정의별_순매출', jsonb_build_object(
    '①총액-제외',   (SELECT COALESCE(SUM(total_amount - excluded_amount), 0) FROM d),
    '②총액그대로',  (SELECT COALESCE(SUM(total_amount), 0) FROM d),
    '③비제외품목합', (SELECT COALESCE(SUM(item_net), 0) FROM d)
  ),

  -- [3] 월별 손익(025)과 월 단위 대조 — 2026년
  --     ③ 정의가 025 revenue와 월별로도 같은지 확인한다 (같아야 정상)
  '월별_025_대조', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t->>'월'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        '월', to_char(d.order_date, 'YYYY-MM'),
        '①총액-제외', SUM(d.total_amount - d.excluded_amount),
        '②총액',      SUM(d.total_amount),
        '③품목합',    SUM(d.item_net),
        '025_매출',   (SELECT m.revenue FROM monthly_pl_order_summary(
                          date_trunc('month', d.order_date)::date,
                          (date_trunc('month', d.order_date) + INTERVAL '1 month - 1 day')::date) m
                       LIMIT 1)
      ) AS t
      FROM d
      WHERE d.order_date >= DATE '2026-01-01' AND d.order_date < DATE '2026-10-01'
      GROUP BY to_char(d.order_date, 'YYYY-MM'), date_trunc('month', d.order_date)
    ) s
  ),

  -- [4] 음수 주문 (반품·정정) — 0 하한을 걸면 사라지는 금액
  '음수_주문', jsonb_build_object(
    '총액음수',   (SELECT jsonb_build_object('건수', COUNT(*), '금액', COALESCE(SUM(total_amount), 0))
                   FROM d WHERE total_amount < 0),
    '원본미수음수', (SELECT jsonb_build_object('건수', COUNT(*), '금액', COALESCE(SUM(raw_outstanding), 0))
                     FROM d WHERE raw_outstanding < 0),
    '허브범위_원본미수음수', (SELECT jsonb_build_object('건수', COUNT(*), '금액', COALESCE(SUM(raw_outstanding), 0))
                              FROM d WHERE raw_outstanding < 0 AND vendor_id IS NOT NULL),
    '표본', (
      SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'총액')::bigint), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object('주문번호', order_no, '주문일', order_date,
                                  '총액', total_amount, '원본미수', raw_outstanding,
                                  '수금상태', collect_status, '비제외품목합', item_net) AS t
        FROM d WHERE total_amount < 0 ORDER BY total_amount LIMIT 10
      ) s
    )
  ),

  -- [5] 불일치 표본 — 총액과 비제외품목합이 어긋나는 주문 (양쪽 방향 각 8건)
  '불일치_표본', jsonb_build_object(
    '총액이_더큼', (
      SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'차액')::bigint DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object('주문번호', order_no, '주문일', order_date,
                                  '총액', total_amount, '품목합', item_total,
                                  '제외', excluded_amount, '비제외품목합', item_net,
                                  '차액', gap) AS t
        FROM d WHERE gap > 0 ORDER BY gap DESC LIMIT 8
      ) s
    ),
    '총액이_더작음', (
      SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'차액')::bigint), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object('주문번호', order_no, '주문일', order_date,
                                  '총액', total_amount, '품목합', item_total,
                                  '제외', excluded_amount, '비제외품목합', item_net,
                                  '차액', gap) AS t
        FROM d WHERE gap < 0 ORDER BY gap LIMIT 8
      ) s
    )
  )

)) AS check_result;
