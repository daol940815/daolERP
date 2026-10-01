-- =====================================================
-- receivable_unify_diag.sql  (읽기 전용 — 데이터 변경 없음)
-- 미수 단일화 드라이런 후속 진단 (2026-10-01)
-- 선행: 406 실행 + receivable_unify_check.sql 1회 실행
--
-- 확인할 것 세 가지
--  [A] 배포된 hub_vendor_summary가 107(컷오프 매칭 차감)인가, 101(매칭 차감 없음)인가.
--      점검 SQL에서 허브 함수 246,235,138 vs 뷰 재현 245,398,538 = 836,600 차이가 났다.
--      107이 미실행이고 DB에 101이 살아 있으면 "매칭 차감 없음"이 차이의 전부여야 한다.
--  [B] 순매출 정의 차이 — 022 함수 5,849,863,431 vs 뷰 6,005,440,946 = 155,577,515.
--      주문 단위 0 하한 때문인데, 그 원인은 '제외금액 > 총액'인 주문이 존재한다는 것.
--      이는 total_amount가 취소·VIP·선결제 품목을 애초에 포함하지 않는다는 뜻이다.
--      월별 손익(025)은 품목 합(Σ 비제외 line_total)으로 계산하므로 셋을 나란히 본다.
--  [C] 차이가 나는 거래처 목록 — [A] 원인을 거래처 단위로 확인.
-- =====================================================

WITH v AS (SELECT * FROM v_erp_order_receivable),
-- 주문별 품목 합 (제외/비제외) — 총액과 품목합이 맞는지 보려고 따로 계산
it AS (
  SELECT order_id,
         SUM(COALESCE(line_total, 0)) AS item_total,
         SUM(CASE WHEN is_canceled OR is_vip OR is_prepayment
                  THEN 0 ELSE COALESCE(line_total, 0) END) AS item_net
  FROM erp_order_items
  GROUP BY order_id
),
d AS (
  SELECT v.*, COALESCE(it.item_total, 0) AS item_total, COALESCE(it.item_net, 0) AS item_net,
         -- 101 규칙 재현: 매칭 차감 전혀 없음 + 순매출 상한
         LEAST(GREATEST(0, v.raw_outstanding), v.net_sales) AS d_101,
         -- 107 규칙 재현: 컷오프 통과 매칭 차감 + 순매출 상한
         LEAST(GREATEST(0, v.raw_outstanding - v.matched_deducted), v.net_sales) AS d_107
  FROM v LEFT JOIN it ON it.order_id = v.order_id
)

SELECT jsonb_pretty(jsonb_build_object(

  -- [A] 배포된 허브 함수의 정체
  'A_허브함수_정체', jsonb_build_object(
    '함수값',        (SELECT COALESCE(SUM(outstanding), 0) FROM hub_vendor_summary(NULL, NULL)),
    '뷰_101규칙',    (SELECT COALESCE(SUM(d_101), 0) FROM d WHERE vendor_id IS NOT NULL),
    '뷰_107규칙',    (SELECT COALESCE(SUM(d_107), 0) FROM d WHERE vendor_id IS NOT NULL),
    '차이_vs101',    (SELECT COALESCE(SUM(outstanding), 0) FROM hub_vendor_summary(NULL, NULL))
                     - (SELECT COALESCE(SUM(d_101), 0) FROM d WHERE vendor_id IS NOT NULL),
    '차이_vs107',    (SELECT COALESCE(SUM(outstanding), 0) FROM hub_vendor_summary(NULL, NULL))
                     - (SELECT COALESCE(SUM(d_107), 0) FROM d WHERE vendor_id IS NOT NULL),
    -- 소스 코드 지문: 107에는 erp_payment_matches가 들어 있고 101에는 없다
    '소스에_매칭차감_있나', (
      SELECT position('erp_payment_matches' in pg_get_functiondef(p.oid)) > 0
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname = 'hub_vendor_summary' AND n.nspname = 'public' LIMIT 1
    ),
    '컷오프_차감총액_허브범위', (SELECT COALESCE(SUM(LEAST(matched_deducted, raw_outstanding)), 0)
                                FROM d WHERE vendor_id IS NOT NULL)
  ),

  -- [B] 순매출 세 가지 정의 비교
  'B_순매출_정의비교', jsonb_build_object(
    '①총액-제외_하한없음', (SELECT COALESCE(SUM(total_amount - excluded_amount), 0) FROM d),
    '②총액-제외_0하한',    (SELECT COALESCE(SUM(net_sales), 0) FROM d),
    '③품목합_비제외',      (SELECT COALESCE(SUM(item_net), 0) FROM d),
    '월별손익_025와_같은정의', '③',
    '총액≠품목합_주문', (
      SELECT jsonb_build_object('건수', COUNT(*),
                                '총액합', COALESCE(SUM(total_amount), 0),
                                '품목합', COALESCE(SUM(item_total), 0),
                                '차액',   COALESCE(SUM(total_amount - item_total), 0))
      FROM d WHERE total_amount <> item_total
    ),
    '제외＞총액_주문', (
      SELECT jsonb_build_object('건수', COUNT(*),
                                '초과액', COALESCE(SUM(excluded_amount - total_amount), 0))
      FROM d WHERE excluded_amount > total_amount
    ),
    '제외＞총액_표본', (
      SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'초과액')::bigint DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object('주문번호', order_no, '주문일', order_date,
                                  '총액', total_amount, '품목합', item_total,
                                  '제외', excluded_amount, '비제외품목합', item_net,
                                  '초과액', excluded_amount - total_amount) AS t
        FROM d WHERE excluded_amount > total_amount
        ORDER BY excluded_amount - total_amount DESC LIMIT 10
      ) s
    )
  ),

  -- [C] 허브 함수와 뷰(107규칙)가 어긋나는 거래처
  'C_불일치_거래처', (
    SELECT COALESCE(jsonb_agg(t ORDER BY abs((t->>'차이')::bigint) DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object('거래처', ven.name,
                                '함수', h.outstanding,
                                '뷰_107', x.v107,
                                '뷰_101', x.v101,
                                '차이', h.outstanding - x.v107) AS t
      FROM hub_vendor_summary(NULL, NULL) h
      JOIN vendors ven ON ven.id = h.vendor_id
      JOIN (SELECT vendor_id AS vid, SUM(d_107) AS v107, SUM(d_101) AS v101
            FROM d WHERE vendor_id IS NOT NULL GROUP BY vendor_id) x ON x.vid = h.vendor_id
      WHERE h.outstanding <> x.v107
      ORDER BY abs(h.outstanding - x.v107) DESC LIMIT 15
    ) s
  )

)) AS diag_result;
