-- 조회만 한다 (데이터 변경 없음). 비활성 매출처를 목록에 보이게 하기 전 규모 · 상태 파악 (2026-11-19)
-- [9-a] 한 줄 요약
WITH iv AS (
  SELECT v.*,
         EXISTS (SELECT 1 FROM vendors a WHERE a.is_active AND a.status IS DISTINCT FROM 'merged' AND a.type IN ('customer','both') AND a.id <> v.id
                   AND regexp_replace(regexp_replace(a.name, '^\s*(\(주\)|㈜|주식회사)\s*', ''), '\s+', '', 'g')
                     = regexp_replace(regexp_replace(v.name, '^\s*(\(주\)|㈜|주식회사)\s*', ''), '\s+', '', 'g')) AS same_active
    FROM vendors v
   WHERE v.is_active = false AND v.status IS DISTINCT FROM 'merged' AND v.type IN ('customer','both')
)
SELECT count(*)                                                     AS 비활성_매출처,
       count(*) FILTER (WHERE group_id IS NULL)                     AS 업체미지정,
       count(*) FILTER (WHERE same_active)                          AS 같은이름_활성매출처있음,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM contact_assignments a WHERE a.vendor_id = iv.id AND a.ended_at IS NULL)) AS 현재고객있음,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM erp_vendor_aliases al JOIN erp_orders o ON o.customer_alias_id = al.id WHERE al.vendor_id = iv.id)) AS 주문있음,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM tax_invoices t WHERE t.vendor_id = iv.id)) AS 계산서있음,
       count(*) FILTER (WHERE created_at >= '2026-11-01')            AS 최근생성_11월
  FROM iv;
