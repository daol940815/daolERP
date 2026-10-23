-- =====================================================
-- receivable_cutoff_impact_check.sql  (읽기 전용 — 데이터 변경 없음)
-- 미수금에 기준일 컷오프(2026-07-01부터 관리)를 적용하면 무엇이 어떻게 바뀌는지 측정.
-- 실행 전 영향 확인용 — 이 수치를 보고 적재 여부·예외 거래처를 결정한다.
--
-- 전제: 매입처와 같은 방식(기초원장 + 기준일 이후 증분)을 매출에도 적용한다고 가정.
--   기준일 = 2026-06-30 (이전은 "모두 정산 완료"로 간주)
-- =====================================================

WITH p AS (SELECT DATE '2026-06-30' AS cutoff),
ex AS (
  SELECT order_id, SUM(COALESCE(line_total, 0)) AS excluded
  FROM erp_order_items WHERE is_canceled OR is_vip OR is_prepayment GROUP BY order_id
),
m_cut AS (  -- 허브 규칙(107)의 업로드 컷오프를 통과한 입금 매칭
  SELECT m.order_id, SUM(m.amount) AS amt
  FROM erp_payment_matches m JOIN erp_orders eo ON eo.id = m.order_id
  WHERE COALESCE(eo.source, 'upload') = 'direct' OR m.paid_date > eo.updated_at::date
  GROUP BY m.order_id
),
o AS (
  SELECT eo.id, eo.order_date, eo.customer_alias_id, COALESCE(eo.source, 'upload') AS src,
         a.vendor_id,
         LEAST(
           GREATEST(0, COALESCE(eo.outstanding_amount, 0) - COALESCE(mc.amt, 0)),
           GREATEST(0, COALESCE(eo.total_amount, 0) - COALESCE(x.excluded, 0))
         ) AS outstanding          -- 허브(107)와 동일한 미수 계산
  FROM erp_orders eo
  JOIN erp_vendor_aliases a ON a.id = eo.customer_alias_id
   AND a.alias_type = 'customer' AND a.vendor_id IS NOT NULL
  LEFT JOIN ex x ON x.order_id = eo.id
  LEFT JOIN m_cut mc ON mc.order_id = eo.id
)

SELECT jsonb_pretty(jsonb_build_object(

  -- [1] 현재 허브 미수금 (대조 기준)
  '현재_허브미수금', (SELECT COALESCE(SUM(outstanding), 0) FROM hub_vendor_summary(NULL, NULL)),

  -- [2] 기준일 기준 분해 — 컷오프를 적용하면 '이전' 금액이 0으로 대체된다
  '기준일_분해', (
    SELECT jsonb_build_object(
      '_2026_06_30_이전', COALESCE(SUM(outstanding) FILTER (WHERE order_date <= (SELECT cutoff FROM p)), 0),
      '_2026_07_01_이후', COALESCE(SUM(outstanding) FILTER (WHERE order_date >  (SELECT cutoff FROM p)), 0),
      '이전_주문수',      COUNT(*) FILTER (WHERE order_date <= (SELECT cutoff FROM p) AND outstanding > 0),
      '이후_주문수',      COUNT(*) FILTER (WHERE order_date >  (SELECT cutoff FROM p) AND outstanding > 0)
    ) FROM o
  ),

  -- [3] 컷오프로 사라지는 미수 상위 거래처 20곳
  --     실제로 받을 돈이 남아 있는 곳은 기초잔액에 실값을 넣어야 한다
  '사라지는_미수_상위', (
    SELECT coalesce(jsonb_agg(t ORDER BY (t->>'미수')::bigint DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        '거래처', v.name, '주문수', COUNT(*), '미수', SUM(o.outstanding),
        '최근주문', MAX(o.order_date)
      ) AS t
      FROM o JOIN vendors v ON v.id = o.vendor_id
      WHERE o.order_date <= (SELECT cutoff FROM p) AND o.outstanding > 0
      GROUP BY v.name ORDER BY SUM(o.outstanding) DESC LIMIT 20
    ) s
  ),

  -- [4] 연도별 분포 (오래된 미수가 얼마나 쌓여 있는지)
  '연도별_미수', (
    SELECT coalesce(jsonb_agg(t ORDER BY t->>'연도'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object('연도', date_part('year', order_date)::int,
                                '주문수', COUNT(*), '미수', SUM(outstanding)) AS t
      FROM o WHERE outstanding > 0 GROUP BY date_part('year', order_date)
    ) s
  ),

  -- [5] 함정 확인 — 기준일 이전 주문에 연결된 '기준일 이후' 입금
  --     매입처 601에서 겪은 것과 같은 문제. 이 입금을 기준일 이후 미수에서 빼면 이중차감이 된다.
  '이전주문_이후입금', (
    SELECT jsonb_build_object('건수', COUNT(*), '금액', COALESCE(SUM(m.amount), 0))
    FROM erp_payment_matches m
    JOIN erp_orders eo ON eo.id = m.order_id
    WHERE eo.order_date <= (SELECT cutoff FROM p)
      AND m.paid_date > (SELECT cutoff FROM p)
  ),

  -- [6] 주문관리모드(direct) 주문 현황 — 신규 주문이 실제로 쌓이고 있는지
  '주문소스별', (
    SELECT coalesce(jsonb_agg(t ORDER BY t->>'source'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'source', src, '주문수', COUNT(*),
        '미수', COALESCE(SUM(outstanding), 0),
        '최초주문', MIN(order_date), '최근주문', MAX(order_date),
        '_7월이후_주문수', COUNT(*) FILTER (WHERE order_date > (SELECT cutoff FROM p))
      ) AS t
      FROM o GROUP BY src
    ) s
  ),

  -- [7] 거래처 미연결(허브 제외) 주문 — 컷오프와 무관하게 별도 정리 대상
  '별칭미연결', (
    SELECT jsonb_build_object('주문수', COUNT(*), '미수', COALESCE(SUM(GREATEST(COALESCE(eo.outstanding_amount,0), 0)), 0))
    FROM erp_orders eo
    LEFT JOIN erp_vendor_aliases a ON a.id = eo.customer_alias_id
    WHERE eo.collect_status <> 'collected' AND COALESCE(eo.outstanding_amount, 0) > 0
      AND (eo.customer_alias_id IS NULL OR a.vendor_id IS NULL)
  )

)) AS check_result;
