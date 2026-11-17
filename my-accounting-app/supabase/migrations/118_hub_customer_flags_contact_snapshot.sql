-- =====================================================
-- 118_hub_customer_flags_contact_snapshot.sql
-- 매출처 관리 고객관리 집계(주문 금액대 · 신규 · 이탈 · 유형) 보정 — 사용자 승인 2026-11-17 ("1번 진행, 2번 과거매출 포함")
--
-- 108 hub_customer_flags 를 다시 만든다. 바뀌는 것 두 가지:
--  1) 담당자(고객) 귀속 = 주문에 저장된 인물(erp_orders.contact_id — 주문 입력 · 상담 전환분) 우선.
--     인물 연결이 없는 주문만 예전처럼 담당자 표기 → contact_name_links 로 찾는다.
--     (108은 표기 연결만 써서 직접 입력 주문이 고객에게 거의 안 붙었다 — 주문 있는 고객 144명 중 72명만 잡힘)
--     병합된 인물 · 병합된 매출처는 남는 쪽으로 따라간다.
--  2) 과거 매출 = 고객관리문서 스냅샷(111 doc_sales_snapshot, 2025-01 ~ 2026-10) 포함.
--     ERP 주문은 2026-10-30 전량 삭제되어 11-02 이후 직접 입력분만 있다 — 스냅샷과 기간이 겹치지 않는다.
--     상시 = monthly(YYYY-MM), 명절 = season("25설" · "26추석" → 2025 · 2026). 최초 주문일은 스냅샷의 first_order_date 포함.
--     스냅샷은 참고 지표(드릴다운 불가 — 111에 문서화된 예외)라 화면 제목에 출처를 함께 적는다.
-- 그 밖의 정의(신규 · 이탈 · 금액대 경계 · 유형 · 순매출 = 취소 · VIP · 선결제 제외)는 108과 같다. 취소 주문(511)은 제외.
-- =====================================================

CREATE OR REPLACE FUNCTION hub_customer_flags(p_year INT DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql STABLE
AS $$
WITH ref AS (
  SELECT COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::INT) AS y0
),
-- 병합된 매출처 · 인물 → 남는 쪽
vmap AS (
  SELECT id, CASE WHEN status = 'merged' AND merged_into_id IS NOT NULL THEN merged_into_id ELSE id END AS vid FROM vendors
),
cmap AS (
  SELECT id, COALESCE(merged_into_id, id) AS cid FROM contacts
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
    vm.vid AS vendor_id,
    cm.cid AS contact_id,
    COALESCE(eo.manager_name, '') AS manager_name,
    eo.order_date,
    GREATEST(COALESCE(eo.total_amount, 0) - COALESCE(e.amt, 0), 0) AS net,
    COALESCE(sc.year, sw.year) AS season_year   -- season_code 우선, 없으면 기간 판정
  FROM erp_orders eo
  LEFT JOIN erp_vendor_aliases av ON av.id = eo.customer_alias_id
  JOIN vmap vm ON vm.id = COALESCE(eo.vendor_id, av.vendor_id)
  LEFT JOIN cmap cm ON cm.id = eo.contact_id
  LEFT JOIN excl e  ON e.order_id = eo.id
  LEFT JOIN crm_seasons sc ON sc.code = eo.season_code
  LEFT JOIN crm_seasons sw ON eo.season_code IS NULL
                          AND eo.order_date BETWEEN sw.order_start AND sw.order_end
  WHERE eo.canceled_at IS NULL
),
-- 고객관리문서 스냅샷 (상시 월별 + 명절)
snap AS (
  SELECT vm.vid AS vendor_id, cm.cid AS contact_id, LEFT(m.key, 4)::INT AS yr, false AS is_season,
         m.value::NUMERIC AS amt, s.first_order_date AS first_d
  FROM doc_sales_snapshot s
  JOIN vmap vm ON vm.id = s.vendor_id
  LEFT JOIN cmap cm ON cm.id = s.contact_id
  CROSS JOIN LATERAL jsonb_each_text(s.monthly) AS m(key, value)
  WHERE m.key ~ '^\d{4}-\d{2}$'
  UNION ALL
  SELECT vm.vid, cm.cid, 2000 + LEFT(k.key, 2)::INT, true, k.value::NUMERIC, s.first_order_date
  FROM doc_sales_snapshot s
  JOIN vmap vm ON vm.id = s.vendor_id
  LEFT JOIN cmap cm ON cm.id = s.contact_id
  CROSS JOIN LATERAL jsonb_each_text(s.season) AS k(key, value)
  WHERE k.key ~ '^\d{2}'
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
  UNION ALL
  SELECT vendor_id, yr, is_season, SUM(amt), MIN(first_d)
  FROM snap
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
-- 0) 주문에 저장된 인물  1) 인물 연결 없는 주문은 표기 연결  2) 스냅샷의 인물
oc AS (
  SELECT x.contact_id, x.vendor_id,
         COALESCE(x.season_year, EXTRACT(YEAR FROM x.order_date)::INT) AS yr,
         (x.season_year IS NOT NULL) AS is_season,
         SUM(x.net) AS amt,
         MIN(x.order_date) AS first_d
  FROM (
    SELECT o.contact_id, o.vendor_id, o.season_year, o.order_date, o.net
    FROM o WHERE o.contact_id IS NOT NULL
    UNION ALL
    SELECT cm.cid, o.vendor_id, o.season_year, o.order_date, o.net
    FROM o
    JOIN contact_name_links l ON l.vendor_id = o.vendor_id
                             AND l.raw_name = o.manager_name
                             AND l.contact_id IS NOT NULL
    JOIN cmap cm ON cm.id = l.contact_id
    WHERE o.contact_id IS NULL
  ) x
  GROUP BY 1, 2, 3, 4
  UNION ALL
  SELECT contact_id, vendor_id, yr, is_season, SUM(amt), MIN(first_d)
  FROM snap WHERE contact_id IS NOT NULL
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
'매출처 허브 고객관리 집계 — 지점/담당자 투트랙 분류 플래그 (신규·이탈·금액대·유형). 118: 담당자 귀속 = 주문 저장 인물 우선, 고객관리문서 스냅샷(2025-01~2026-10) 포함.';

-- 검증: 금액대별 지점 · 고객 수 (실행 전후 비교용)
SELECT 'vendors' AS 구분, f->>'tier' AS 금액대, COUNT(*) AS 수
FROM jsonb_array_elements(hub_customer_flags()->'vendors') f GROUP BY 2
UNION ALL
SELECT 'contacts', f->>'tier', COUNT(*)
FROM jsonb_array_elements(hub_customer_flags()->'contacts') f GROUP BY 2
ORDER BY 1, 2;
