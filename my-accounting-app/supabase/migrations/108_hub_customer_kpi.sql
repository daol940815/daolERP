-- =====================================================
-- 108_hub_customer_kpi.sql
-- 매출처 허브 고객관리 집계 KPI — 투트랙(지점/담당자) 플래그 RPC
-- 시안: docs/mockups/매출처허브_집계KPI_시안.html (2026-08-24 타일형 확정)
--
-- 반환: 지점(vendor)·담당자(활성 배정) 단위의 분류 플래그를 JSONB 단일 응답으로.
--   화면은 이 플래그로 KPI 타일 카운트와 목록 필터를 모두 처리한다 (102 패턴).
-- 정의 (영업지원팀 고객관리 문서 집계표와 동일 — 검증: 하나은행 신규 84/31·이탈 214 일치):
--   신규   = 최초 주문일이 기준연도(p_year)
--   이탈   = 기준연도 주문 없음 AND 전년 주문 있음
--   금액대 = 기준연도+전년 누적 순매출 (1,000만/500만/100만 경계)
--   유형   = 명절·상시 매출 조합 (명절+상시 / 상시만 / 명절만 / 주문없음)
-- 명절 판정: erp_orders.season_code가 있으면 그것을, 없으면 주문일이
--   crm_seasons 수집기간(order_start~order_end)에 들면 명절로 본다(추천 수준).
-- 순매출: 취소·VIP·선결제 제외 (erp_orders_summary와 동일 규칙).
-- 담당자 매출: 주문 담당자 표기 → contact_name_links로 인물 연결된 것만 귀속.
-- =====================================================

-- ── 선행 객체 (구 CRM 트랙 069에서 운영 DB에만 존재 — 저장소 체인에 없어 여기서 자립 정의.
--    운영 DB에는 이미 있으므로 전부 no-op) ──
CREATE TABLE IF NOT EXISTS crm_seasons (
  code         VARCHAR(10) PRIMARY KEY,   -- '24설', '25추석' …
  label        VARCHAR(50) NOT NULL,
  season_type  VARCHAR(10) NOT NULL CHECK (season_type IN ('seol', 'chuseok')),
  year         SMALLINT    NOT NULL,
  order_start  DATE        NOT NULL,      -- 명절 주문 수집 기간 (날짜 기반 판정용)
  order_end    DATE        NOT NULL
);
INSERT INTO crm_seasons (code, label, season_type, year, order_start, order_end) VALUES
  ('24설',   '2024년 설',   'seol',    2024, '2024-01-01', '2024-03-15'),
  ('24추석', '2024년 추석', 'chuseok', 2024, '2024-08-01', '2024-10-15'),
  ('25설',   '2025년 설',   'seol',    2025, '2024-12-15', '2025-03-15'),
  ('25추석', '2025년 추석', 'chuseok', 2025, '2025-08-15', '2025-11-15'),
  ('26설',   '2026년 설',   'seol',    2026, '2026-01-01', '2026-03-15'),
  ('26추석', '2026년 추석', 'chuseok', 2026, '2026-08-15', '2026-11-15')
ON CONFLICT (code) DO NOTHING;
ALTER TABLE crm_seasons ENABLE ROW LEVEL SECURITY;

ALTER TABLE erp_orders
  ADD COLUMN IF NOT EXISTS season_code VARCHAR(10) REFERENCES crm_seasons(code);

CREATE OR REPLACE FUNCTION hub_customer_flags(p_year INT DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql STABLE
AS $$
WITH ref AS (
  SELECT COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::INT) AS y0
),
excl AS (
  SELECT order_id, SUM(COALESCE(line_total, 0)) AS amt
  FROM erp_order_items
  WHERE is_canceled OR is_vip OR is_prepayment
  GROUP BY order_id
),
o AS (
  SELECT
    eo.id,
    av.vendor_id,
    COALESCE(eo.manager_name, '') AS manager_name,
    eo.order_date,
    GREATEST(COALESCE(eo.total_amount, 0) - COALESCE(e.amt, 0), 0) AS net,
    COALESCE(sc.year, sw.year) AS season_year   -- season_code 우선, 없으면 기간 판정
  FROM erp_orders eo
  JOIN erp_vendor_aliases av ON av.id = eo.customer_alias_id AND av.vendor_id IS NOT NULL
  LEFT JOIN excl e  ON e.order_id = eo.id
  LEFT JOIN crm_seasons sc ON sc.code = eo.season_code
  LEFT JOIN crm_seasons sw ON eo.season_code IS NULL
                          AND eo.order_date BETWEEN sw.order_start AND sw.order_end
),
-- ── 지점 단위 집계 ──
ov AS (
  SELECT vendor_id,
         COALESCE(season_year, EXTRACT(YEAR FROM order_date)::INT) AS yr,
         (season_year IS NOT NULL) AS is_season,
         SUM(net) AS amt,
         MIN(order_date) AS first_d
  FROM o
  GROUP BY 1, 2, 3
),
vagg AS (
  SELECT vendor_id,
         MIN(first_d) AS first_order,
         COALESCE(SUM(amt) FILTER (WHERE yr = r.y0), 0)                    AS cur_amt,
         COALESCE(SUM(amt) FILTER (WHERE yr = r.y0 - 1), 0)                AS prev_amt,
         COALESCE(SUM(amt) FILTER (WHERE is_season AND yr BETWEEN r.y0 - 1 AND r.y0), 0)     AS season_amt,
         COALESCE(SUM(amt) FILTER (WHERE NOT is_season AND yr BETWEEN r.y0 - 1 AND r.y0), 0) AS regular_amt
  FROM ov, ref r
  GROUP BY vendor_id, r.y0
),
vflag AS (
  SELECT
    v.id AS vendor_id,
    g.first_order,
    COALESCE(g.cur_amt, 0) + COALESCE(g.prev_amt, 0) AS total2y,
    (g.first_order IS NOT NULL AND EXTRACT(YEAR FROM g.first_order)::INT = r.y0) AS is_new,
    (COALESCE(g.cur_amt, 0) = 0 AND COALESCE(g.prev_amt, 0) > 0)                 AS is_churn,
    CASE
      WHEN COALESCE(g.season_amt, 0) > 0 AND COALESCE(g.regular_amt, 0) > 0 THEN 'both'
      WHEN COALESCE(g.season_amt, 0) > 0 THEN 'season_only'
      WHEN COALESCE(g.regular_amt, 0) > 0 THEN 'regular_only'
      ELSE 'none'
    END AS otype,
    CASE
      WHEN COALESCE(g.cur_amt, 0) + COALESCE(g.prev_amt, 0) >= 10000000 THEN 't1'
      WHEN COALESCE(g.cur_amt, 0) + COALESCE(g.prev_amt, 0) >=  5000000 THEN 't2'
      WHEN COALESCE(g.cur_amt, 0) + COALESCE(g.prev_amt, 0) >=  1000000 THEN 't3'
      ELSE 't4'
    END AS tier
  FROM vendors v
  CROSS JOIN ref r
  LEFT JOIN vagg g ON g.vendor_id = v.id
  WHERE v.status <> 'merged'
    AND (g.vendor_id IS NOT NULL
         OR EXISTS (SELECT 1 FROM contact_assignments ca
                    WHERE ca.vendor_id = v.id AND ca.ended_at IS NULL))
),
-- ── 담당자(활성 배정) 단위 집계 ──
oc AS (
  SELECT l.contact_id, o.vendor_id,
         COALESCE(o.season_year, EXTRACT(YEAR FROM o.order_date)::INT) AS yr,
         (o.season_year IS NOT NULL) AS is_season,
         SUM(o.net) AS amt,
         MIN(o.order_date) AS first_d
  FROM o
  JOIN contact_name_links l ON l.vendor_id = o.vendor_id
                           AND l.raw_name = o.manager_name
                           AND l.contact_id IS NOT NULL
  GROUP BY 1, 2, 3, 4
),
cagg AS (
  SELECT contact_id, vendor_id,
         MIN(first_d) AS first_order,
         COALESCE(SUM(amt) FILTER (WHERE yr = r.y0), 0)     AS cur_amt,
         COALESCE(SUM(amt) FILTER (WHERE yr = r.y0 - 1), 0) AS prev_amt,
         COALESCE(SUM(amt) FILTER (WHERE is_season AND yr BETWEEN r.y0 - 1 AND r.y0), 0)     AS season_amt,
         COALESCE(SUM(amt) FILTER (WHERE NOT is_season AND yr BETWEEN r.y0 - 1 AND r.y0), 0) AS regular_amt
  FROM oc, ref r
  GROUP BY contact_id, vendor_id, r.y0
),
cflag AS (
  SELECT
    ca.contact_id, ca.vendor_id,
    COALESCE(g.cur_amt, 0) + COALESCE(g.prev_amt, 0) AS total2y,
    (g.first_order IS NOT NULL AND EXTRACT(YEAR FROM g.first_order)::INT = r.y0) AS is_new,
    (COALESCE(g.cur_amt, 0) = 0 AND COALESCE(g.prev_amt, 0) > 0)                 AS is_churn,
    CASE
      WHEN COALESCE(g.season_amt, 0) > 0 AND COALESCE(g.regular_amt, 0) > 0 THEN 'both'
      WHEN COALESCE(g.season_amt, 0) > 0 THEN 'season_only'
      WHEN COALESCE(g.regular_amt, 0) > 0 THEN 'regular_only'
      ELSE 'none'
    END AS otype,
    CASE
      WHEN COALESCE(g.cur_amt, 0) + COALESCE(g.prev_amt, 0) >= 10000000 THEN 't1'
      WHEN COALESCE(g.cur_amt, 0) + COALESCE(g.prev_amt, 0) >=  5000000 THEN 't2'
      WHEN COALESCE(g.cur_amt, 0) + COALESCE(g.prev_amt, 0) >=  1000000 THEN 't3'
      ELSE 't4'
    END AS tier
  FROM contact_assignments ca
  CROSS JOIN ref r
  LEFT JOIN cagg g ON g.contact_id = ca.contact_id AND g.vendor_id = ca.vendor_id
  WHERE ca.ended_at IS NULL
)
SELECT jsonb_build_object(
  'y0',       (SELECT y0 FROM ref),
  'vendors',  COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'vendor_id', vendor_id, 'is_new', is_new, 'is_churn', is_churn,
                 'otype', otype, 'tier', tier, 'total2y', total2y)) FROM vflag), '[]'::jsonb),
  'contacts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'contact_id', contact_id, 'vendor_id', vendor_id, 'is_new', is_new,
                 'is_churn', is_churn, 'otype', otype, 'tier', tier, 'total2y', total2y)) FROM cflag), '[]'::jsonb)
);
$$;

COMMENT ON FUNCTION hub_customer_flags IS
'매출처 허브 고객관리 집계 — 지점/담당자 투트랙 분류 플래그 (신규·이탈·금액대·유형). KPI 카운트와 목록 필터 공용.';
