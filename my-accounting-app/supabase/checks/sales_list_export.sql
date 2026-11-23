-- =====================================================
-- 상담일지 · 주문서 목록 내려받기 — 지금 업체 · 지점 칸과 고객 검색에 나오는 매출처 · 담당자 전체 (2026-11-19 요청)
--
-- 기준 = 화면 코드와 동일 (/api/orders-portal/masters · lib/contact-search.ts, 2026-11-19 수정분):
--   지점 = vendors 활성 · 병합 제외 · 종류 매출처(customer · both)
--   업체 = 위 지점이 1곳 이상 있는 활성 업체 (+ 개인 고객 업체)
--   담당자 = 위 지점에 현재 배정된(ended_at 없음) 인물, 병합된 인물 제외
-- 한 줄 = 지점 × 담당자. 담당자가 없는 지점도 한 줄(담당자 칸 빈칸)로 나온다.
-- 받는 법: SQL 편집기에서 실행 → 결과 오른쪽 위 "Export"(또는 "Download CSV") → 엑셀에서
--   [데이터] › [텍스트/CSV에서] 로 열고 파일 원본을 "65001: 유니코드(UTF-8)"로 고른다 (더블클릭으로 열면 한글이 깨질 수 있음).
-- 조회만 한다 (데이터 변경 없음).
-- =====================================================

WITH v AS (
  SELECT id, name, group_id, individual_contact_id
    FROM vendors
   WHERE is_active = true AND status IS DISTINCT FROM 'merged' AND type IN ('customer', 'both')
), g AS (
  SELECT id, name, is_individual FROM vendor_groups WHERE is_active = true
), last_order AS (
  SELECT contact_id, vendor_id, max(order_date) AS last_date
    FROM erp_orders
   WHERE canceled_at IS NULL AND contact_id IS NOT NULL
   GROUP BY contact_id, vendor_id
)
SELECT
  CASE WHEN v.individual_contact_id IS NOT NULL THEN '개인 고객' ELSE '매출처' END            AS 구분,
  coalesce(g.name, v.name)                                                                  AS 업체_은행,
  CASE
    WHEN v.individual_contact_id IS NOT NULL THEN ''
    WHEN g.name IS NOT NULL AND v.name = g.name THEN ''                                     -- 단독 업체(지점 없음)
    WHEN g.name IS NOT NULL AND v.name LIKE g.name || '%' THEN btrim(substr(v.name, length(g.name) + 1))
    ELSE v.name
  END                                                                                       AS 지점,
  v.name                                                                                    AS 매출처명,
  CASE WHEN c.id IS NULL THEN ''                                                          -- 화면 contactLabel 과 같은 규칙 (2026-11-19 — '님님' 방지)
       WHEN btrim(c.name) LIKE '%님' THEN btrim(c.name)
       WHEN nullif(btrim(ca.title), '') IS NOT NULL AND btrim(ca.title) LIKE '%님' THEN c.name || ' ' || btrim(ca.title)
       WHEN nullif(btrim(ca.title), '') IS NOT NULL THEN c.name || ' ' || btrim(ca.title) || '님'
       ELSE c.name || ' 님' END                                                             AS 담당자,
  coalesce(c.phone, '')                                                                     AS 핸드폰,
  coalesce(c.tel, '')                                                                       AS 유선,
  coalesce(e.name, '')                                                                      AS 다올담당,
  CASE WHEN ca.is_representative THEN '대표' ELSE '' END                                     AS 대표담당자,
  coalesce(lo.last_date::text, '')                                                          AS 최근주문일
  FROM v
  LEFT JOIN g ON g.id = v.group_id
  LEFT JOIN contact_assignments ca ON ca.vendor_id = v.id AND ca.ended_at IS NULL
  LEFT JOIN contacts c ON c.id = ca.contact_id AND c.merged_into_id IS NULL
  LEFT JOIN employees e ON e.id = ca.staff_employee_id
  LEFT JOIN last_order lo ON lo.contact_id = c.id AND lo.vendor_id = v.id
 WHERE ca.id IS NULL OR c.id IS NOT NULL          -- 병합된 인물의 배정 줄은 빼고, 담당자 없는 지점은 남긴다
 ORDER BY 구분 DESC, 업체_은행, 지점, 담당자;
