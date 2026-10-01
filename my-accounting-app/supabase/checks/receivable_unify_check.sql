-- =====================================================
-- receivable_unify_check.sql  (읽기 전용 — 데이터 변경 없음)
-- 미수 계산 단일화 드라이런 (2026-10 회계 트랙)
-- 선행: 406_erp_order_receivable_view.sql 실행 (뷰만 생성 — 화면 영향 없음)
--
-- 목적 두 가지
--   (A) 뷰가 기존 5가지 계산을 정확히 재현하는지 확인한다 (재현_대조 절).
--       → 전부 일치해야 407로 함수를 옮겨도 안전하다.
--   (B) 표준 규칙으로 통일하면 어느 화면 숫자가 얼마나 바뀌는지 미리 본다
--       (정의별_합계 / 차이_원인 / 상위_거래처).
-- =====================================================

WITH v AS (SELECT * FROM v_erp_order_receivable),

-- 기존 5가지 정의를 뷰 컬럼으로 재현
d AS (
  SELECT
    *,
    -- ① 허브/대시보드 (107): 컷오프 차감 + 순매출 상한, 수금완료 구분 없음
    LEAST(GREATEST(0, raw_outstanding - matched_deducted), net_sales) AS d_hub,
    -- ② ERP 주문내역 표의 행 (page.tsx): 컷오프 차감, 상한 없음
    GREATEST(0, raw_outstanding - matched_deducted)                   AS d_row,
    -- ③ ERP 주문내역 KPI (022) · 수금 대상 (037) · 미수금 Aging: 전체 매칭 차감, 수금완료 제외
    CASE WHEN collect_status = 'collected' THEN 0
         ELSE GREATEST(0, raw_outstanding - matched_all) END          AS d_kpi,
    -- ④ 주문내역 KPI의 JS 폴백(추가 필터 사용 시): 원본 미수 그대로
    CASE WHEN collect_status = 'collected' THEN 0
         ELSE raw_outstanding END                                     AS d_fallback
  FROM v
)

SELECT jsonb_pretty(jsonb_build_object(

  -- [0] 뷰 건전성 — 행 수가 주문 수와 같아야 한다
  '뷰_건전성', jsonb_build_object(
    'erp_orders', (SELECT COUNT(*) FROM erp_orders),
    '뷰_행수',    (SELECT COUNT(*) FROM v),
    '거래처연결', (SELECT COUNT(*) FROM v WHERE vendor_id IS NOT NULL),
    '별칭미연결', (SELECT COUNT(*) FROM v WHERE customer_alias_id IS NULL OR vendor_id IS NULL)
  ),

  -- [1] (A) 재현 대조 — 실제 함수 호출값 vs 뷰 재현값. 차이가 0이어야 한다.
  '재현_대조', jsonb_build_object(
    '허브_107', jsonb_build_object(
      '함수', (SELECT COALESCE(SUM(outstanding), 0) FROM hub_vendor_summary(NULL, NULL)),
      '뷰',   (SELECT COALESCE(SUM(d_hub), 0) FROM d WHERE vendor_id IS NOT NULL),
      '차이', (SELECT COALESCE(SUM(outstanding), 0) FROM hub_vendor_summary(NULL, NULL))
              - (SELECT COALESCE(SUM(d_hub), 0) FROM d WHERE vendor_id IS NOT NULL)
    ),
    '주문KPI_022', jsonb_build_object(
      '함수', (SELECT outstanding FROM erp_orders_summary(NULL, NULL, NULL, NULL, 'all')),
      '뷰',   (SELECT COALESCE(SUM(d_kpi), 0) FROM d),
      '차이', (SELECT outstanding FROM erp_orders_summary(NULL, NULL, NULL, NULL, 'all'))
              - (SELECT COALESCE(SUM(d_kpi), 0) FROM d)
    ),
    '수금대상_037', jsonb_build_object(
      '함수', (SELECT COALESCE(SUM(outstanding_amount), 0) FROM erp_receivable_summary(NULL, NULL, NULL)),
      '뷰',   (SELECT COALESCE(SUM(d_kpi), 0) FROM d),
      '차이', (SELECT COALESCE(SUM(outstanding_amount), 0) FROM erp_receivable_summary(NULL, NULL, NULL))
              - (SELECT COALESCE(SUM(d_kpi), 0) FROM d)
    ),
    '순매출_022', jsonb_build_object(
      '함수', (SELECT net_sales FROM erp_orders_summary(NULL, NULL, NULL, NULL, 'all')),
      '뷰',   (SELECT COALESCE(SUM(net_sales), 0) FROM d)
    )
  ),

  -- [2] (B) 정의별 미수 합계 — 통일하면 어느 숫자가 바뀌는지
  '정의별_합계', jsonb_build_object(
    '표준_신규',        (SELECT COALESCE(SUM(outstanding),  0) FROM d),
    '①허브_107',        (SELECT COALESCE(SUM(d_hub),        0) FROM d),
    '②주문내역_표행',   (SELECT COALESCE(SUM(d_row),        0) FROM d),
    '③KPI022_수금037',  (SELECT COALESCE(SUM(d_kpi),        0) FROM d),
    '④API_JS폴백',      (SELECT COALESCE(SUM(d_fallback),   0) FROM d)
  ),

  -- [2b] 대시보드·매출처 관리가 실제로 보는 값 (거래처 연결 주문만 = 허브 범위)
  '허브범위_전후', jsonb_build_object(
    '현재_허브규칙', (SELECT COALESCE(SUM(d_hub),      0) FROM d WHERE vendor_id IS NOT NULL),
    '통일후_표준',   (SELECT COALESCE(SUM(outstanding),0) FROM d WHERE vendor_id IS NOT NULL),
    '변동',          (SELECT COALESCE(SUM(outstanding),0) - COALESCE(SUM(d_hub), 0) FROM d WHERE vendor_id IS NOT NULL),
    '별칭미연결_제외액', (SELECT COALESCE(SUM(outstanding), 0) FROM d WHERE vendor_id IS NULL)
  ),

  -- [3] 차이의 원인 분해
  '차이_원인', jsonb_build_object(
    -- 수금완료인데 잔액이 남은 주문 → 허브에서만 미수로 잡히던 금액 (표준은 0)
    '수금완료_잔액있음', (
      SELECT jsonb_build_object(
        '건수', COUNT(*),
        '허브가_잡던금액', COALESCE(SUM(d_hub), 0)
      ) FROM d WHERE collect_status = 'collected' AND d_hub > 0
    ),
    -- 순매출 상한에 걸린 주문 → 상한 없는 표행/KPI와 허브의 차이
    '순매출상한_적용', (
      SELECT jsonb_build_object(
        '건수', COUNT(*),
        '깎인금액', COALESCE(SUM(GREATEST(0, raw_outstanding - matched_deducted) - net_sales), 0)
      ) FROM d
      WHERE collect_status <> 'collected'
        AND GREATEST(0, raw_outstanding - matched_deducted) > net_sales
    ),
    -- 업로드 이전 입금(컷오프 제외분) → 전체매칭 차감(KPI/수금)과 컷오프 차감(허브/표행)의 차이
    '컷오프_제외매칭', (
      SELECT jsonb_build_object(
        '주문수', COUNT(*),
        '금액',   COALESCE(SUM(matched_pre_cutoff), 0)
      ) FROM d WHERE matched_pre_cutoff > 0
    ),
    -- 원본 미수가 순매출보다 큰 주문 (ERP 원본 자체의 이상 징후 후보)
    '원본미수_초과', (
      SELECT jsonb_build_object('건수', COUNT(*), '초과액', COALESCE(SUM(raw_outstanding - net_sales), 0))
      FROM d WHERE raw_outstanding > net_sales
    )
  ),

  -- [4] 표준 전환으로 미수가 가장 크게 바뀌는 거래처 상위 15
  '상위_거래처', (
    SELECT COALESCE(jsonb_agg(t ORDER BY abs((t->>'변동')::bigint) DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        '거래처', ven.name,
        '현재_허브', SUM(d.d_hub),
        '통일후',   SUM(d.outstanding),
        '변동',     SUM(d.outstanding) - SUM(d.d_hub),
        '주문수',   COUNT(*)
      ) AS t
      FROM d JOIN vendors ven ON ven.id = d.vendor_id
      WHERE d.vendor_id IS NOT NULL
      GROUP BY ven.name
      HAVING SUM(d.outstanding) <> SUM(d.d_hub)
      ORDER BY abs(SUM(d.outstanding) - SUM(d.d_hub)) DESC
      LIMIT 15
    ) s
  ),

  -- [5] 표본 20건 — 숫자가 어떻게 만들어지는지 눈으로 확인
  '표본', (
    SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'원본미수')::bigint DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        '주문번호', order_no, '주문일', order_date, '구분', source, '수금상태', collect_status,
        '총액', total_amount, '제외', excluded_amount, '순매출', net_sales,
        '원본미수', raw_outstanding, '매칭전체', matched_all, '컷오프차감', matched_deducted,
        '표준', outstanding, '허브', d_hub, '표행', d_row, 'KPI', d_kpi
      ) AS t
      FROM d
      WHERE outstanding <> d_hub OR d_hub <> d_kpi
      ORDER BY raw_outstanding DESC
      LIMIT 20
    ) s
  ),

  -- [6] 2026-07-01 컷오프 참고 — 통일 후 기간 필터만으로 보이는 미수
  '기간별_표준미수', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t->>'구간'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        '구간', CASE WHEN order_date < DATE '2026-07-01' THEN '1_2026-07-01 이전'
                     ELSE '2_2026-07-01 이후' END,
        '주문수', COUNT(*) FILTER (WHERE outstanding > 0),
        '미수', COALESCE(SUM(outstanding), 0)
      ) AS t
      FROM d
      GROUP BY CASE WHEN order_date < DATE '2026-07-01' THEN '1_2026-07-01 이전'
                    ELSE '2_2026-07-01 이후' END
    ) s
  )

)) AS check_result;
