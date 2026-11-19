-- =====================================================
-- 매출처 입력값 참조 원천 진단 — 2026-11-19 문의
-- "상담일지 · 주문서의 은행 · 지점 · 고객명 · 연락처 목록에 매출처관리에 없는 값이 나온다(푸본헌대생명),
--  매출처관리에 유기억 사업단장이 합치기 전 지점 소속으로 나온다 — 매출처 집계가 갈리지 않게 참조값을 바로잡고 싶다"
--
-- 조회만 한다 (데이터 변경 없음). 블록별로 선택해서 실행 (편집기는 마지막 결과만 보여 준다).
--
-- 기준
--   매출처관리 = vendors.type IN ('customer','both') AND status <> 'merged' (비활성은 기본 숨김)
--   매출 집계  = 주문의 customer_alias_id → erp_vendor_aliases.vendor_id (주문서가 고른 erp_orders.vendor_id 가 아님)
-- =====================================================

-- [0] 한 줄 요약 — 숫자가 0이 아닌 항목만 아래 상세 블록을 보면 된다
WITH RECURSIVE ch AS (
  SELECT id AS root, id AS cur, 0 AS d FROM vendors
  UNION ALL
  SELECT ch.root, v.merged_into_id, ch.d + 1
    FROM ch JOIN vendors v ON v.id = ch.cur
   WHERE v.status = 'merged' AND v.merged_into_id IS NOT NULL AND ch.d < 10
),
fin AS (SELECT DISTINCT ON (root) root, cur FROM ch ORDER BY root, d DESC),
mv AS (SELECT id FROM vendors WHERE status = 'merged'),
sales_v AS (SELECT id, is_active FROM vendors WHERE type IN ('customer','both') AND status IS DISTINCT FROM 'merged'),
cur_asg AS (
  SELECT a.contact_id, a.vendor_id, sv.is_active
    FROM contact_assignments a
    JOIN contacts c ON c.id = a.contact_id AND c.merged_into_id IS NULL
    JOIN sales_v sv ON sv.id = a.vendor_id
   WHERE a.ended_at IS NULL
),
ord AS (
  -- 집계는 별칭의 vendor_id 를 그대로 쓴다(병합을 따라가지 않음 — 병합된 매출처에 붙은 별칭의 주문은 집계에서 빠진다)
  SELECT o.id, o.total_amount, fo.cur AS order_vendor, al.vendor_id AS agg_vendor
    FROM erp_orders o
    LEFT JOIN erp_vendor_aliases al ON al.id = o.customer_alias_id
    LEFT JOIN fin fo ON fo.root = o.vendor_id
   WHERE o.vendor_id IS NOT NULL AND o.canceled_at IS NULL
)
SELECT
  (SELECT count(*) FROM contact_assignments a WHERE a.vendor_id IN (SELECT id FROM mv) AND a.ended_at IS NULL) AS "A_병합된매출처_남은현재배정",
  (SELECT count(*) FROM vendor_staff s WHERE s.vendor_id IN (SELECT id FROM mv) AND s.ended_at IS NULL)      AS "A_병합된매출처_남은지점담당",
  (SELECT count(*) FROM erp_consultations c WHERE c.vendor_id IN (SELECT id FROM mv) AND c.deleted_at IS NULL) AS "A_병합된매출처_가리키는상담",
  (SELECT count(*) FROM erp_orders o WHERE o.vendor_id IN (SELECT id FROM mv))                               AS "A_병합된매출처_가리키는주문",
  (SELECT count(*) FROM contact_activities t WHERE t.vendor_id IN (SELECT id FROM mv))                       AS "A_병합된매출처_영업일지",
  (SELECT count(*) FROM erp_vendor_aliases al WHERE al.alias_type = 'customer' AND al.vendor_id IN (SELECT id FROM mv)) AS "A_병합된매출처_별칭",
  (SELECT count(*) FROM ord WHERE agg_vendor IS DISTINCT FROM order_vendor)                                  AS "B_주문처와_집계매출처_다른주문",
  (SELECT COALESCE(sum(total_amount), 0) FROM ord WHERE agg_vendor IS DISTINCT FROM order_vendor)            AS "B_그금액",
  (SELECT count(*) FROM (SELECT contact_id FROM cur_asg WHERE is_active GROUP BY contact_id HAVING count(DISTINCT vendor_id) > 1) x) AS "C_활성매출처_2곳이상_현재소속인물",
  (SELECT count(*) FROM (SELECT contact_id FROM cur_asg GROUP BY contact_id HAVING bool_or(is_active) = false) x) AS "D_비활성매출처에만_현재소속인물",
  (SELECT count(*) FROM vendors v WHERE v.type IN ('customer','both') AND v.status IS DISTINCT FROM 'merged' AND v.is_active AND v.group_id IS NULL) AS "E_업체미지정_활성매출처",
  (SELECT count(*) FROM erp_consultations c WHERE c.vendor_id IS NULL AND c.deleted_at IS NULL)              AS "F_매출처연결없는상담";


-- [1] 유기억 — 인물 기록(병합된 것 포함)과 소속 이력 전부
SELECT c.id AS 인물id, c.code AS 고객코드, c.name AS 이름, c.phone AS 핸드폰,
       c.merged_into_id AS 병합된곳_id, (SELECT name FROM contacts WHERE id = c.merged_into_id) AS 병합된곳,
       c.created_at::date AS 인물생성일,
       v.name AS 매출처, g.name AS 업체, v.type, v.status, v.is_active AS 활성,
       a.title AS 직함, a.is_representative AS 대표, a.started_at AS 시작, a.ended_at AS 종료, a.created_at::date AS 배정생성일
  FROM contacts c
  LEFT JOIN contact_assignments a ON a.contact_id = c.id
  LEFT JOIN vendors v ON v.id = a.vendor_id
  LEFT JOIN vendor_groups g ON g.id = v.group_id
 WHERE c.name LIKE '%유기억%'
 ORDER BY c.created_at, a.ended_at NULLS FIRST, a.created_at;

-- [2] 유기억 — 주문 · 상담에 어떻게 저장돼 있나 (주문처 vs 매출 집계 매출처)
SELECT '주문' AS 구분, o.order_no AS 번호, o.order_date AS 일자, o.bank_name AS 저장_업체, o.branch_name AS 저장_지점, o.manager_name AS 저장_고객,
       vo.name AS 주문처_매출처, al.erp_name AS 별칭, va.name AS 집계_매출처, o.total_amount AS 금액, o.canceled_at IS NOT NULL AS 취소
  FROM erp_orders o
  LEFT JOIN vendors vo ON vo.id = o.vendor_id
  LEFT JOIN erp_vendor_aliases al ON al.id = o.customer_alias_id
  LEFT JOIN vendors va ON va.id = al.vendor_id
 WHERE o.manager_name LIKE '%유기억%' OR o.contact_id IN (SELECT id FROM contacts WHERE name LIKE '%유기억%')
UNION ALL
SELECT '상담', c.id::text, c.consult_date, c.bank_name, c.branch_name, c.manager_name,
       vo.name, NULL, NULL, NULL, c.deleted_at IS NOT NULL
  FROM erp_consultations c
  LEFT JOIN vendors vo ON vo.id = c.vendor_id
 WHERE c.manager_name LIKE '%유기억%' OR c.contact_id IN (SELECT id FROM contacts WHERE name LIKE '%유기억%')
 ORDER BY 3 DESC;

-- [3] '푸본' 매출처 · 업체 전부 — 같은 이름 중복 · 병합 · 청구처 관계
SELECT v.id, v.name AS 매출처, g.name AS 업체, g.is_active AS 업체활성, v.type, v.status, v.is_active AS 활성,
       (SELECT name FROM vendors WHERE id = v.merged_into_id) AS 병합된곳,
       (SELECT name FROM vendors WHERE id = v.billing_vendor_id) AS 청구처,
       (SELECT count(*) FROM vendors b WHERE b.billing_vendor_id = v.id) AS 청구처로서_소속부서,
       (SELECT count(*) FROM contact_assignments a WHERE a.vendor_id = v.id AND a.ended_at IS NULL) AS 현재배정,
       (SELECT count(*) FROM erp_orders o WHERE o.vendor_id = v.id) AS 주문처로_주문,
       (SELECT count(*) FROM erp_orders o JOIN erp_vendor_aliases al ON al.id = o.customer_alias_id WHERE al.vendor_id = v.id) AS 집계로_주문,
       (SELECT string_agg(al.erp_name, ' | ') FROM erp_vendor_aliases al WHERE al.alias_type = 'customer' AND al.vendor_id = v.id) AS 연결별칭,
       v.created_at::date AS 생성일
  FROM vendors v
  LEFT JOIN vendor_groups g ON g.id = v.group_id
 WHERE v.name LIKE '%푸본%' OR g.name LIKE '%푸본%'
 ORDER BY g.name NULLS FIRST, v.name, v.status;

-- [3-b] '푸본' 병합 이력
SELECT merged_at, actor, kind, from_name AS 흡수된쪽, into_name AS 남은쪽, moved_refs
  FROM vendor_merge_logs
 WHERE from_name LIKE '%푸본%' OR into_name LIKE '%푸본%'
 ORDER BY merged_at;

-- [3-c] '푸본' 업체(vendor_groups) — 지점 0인 오타 업체가 남아 있는지
SELECT g.id, g.name AS 업체, g.is_active AS 활성, g.created_at::date AS 생성일,
       count(v.id) FILTER (WHERE v.is_active AND v.status IS DISTINCT FROM 'merged' AND v.type IN ('customer','both')) AS 활성매출처지점,
       (SELECT count(*) FROM erp_consultations c WHERE c.vendor_group_id = g.id) AS 상담
  FROM vendor_groups g
  LEFT JOIN vendors v ON v.group_id = g.id
 WHERE g.name LIKE '%푸본%'
 GROUP BY g.id, g.name, g.is_active, g.created_at;

-- [4] (A) 병합된 매출처에 남은 고객 쪽 데이터 — 2026-11-16 이전 '거래처 중복 정리' 병합은 회계 연결만 옮겼다
WITH RECURSIVE ch AS (
  SELECT id AS root, id AS cur, 0 AS d FROM vendors WHERE status = 'merged'
  UNION ALL
  SELECT ch.root, v.merged_into_id, ch.d + 1
    FROM ch JOIN vendors v ON v.id = ch.cur
   WHERE v.status = 'merged' AND v.merged_into_id IS NOT NULL AND ch.d < 10
),
fin AS (SELECT DISTINCT ON (root) root, cur FROM ch ORDER BY root, d DESC)
SELECT v.name AS 병합된매출처, (SELECT name FROM vendors WHERE id = f.cur) AS 최종_남은매출처,
       (SELECT max(merged_at)::date FROM vendor_merge_logs l WHERE l.from_id = v.id) AS 병합일,
       (SELECT count(*) FROM contact_assignments a WHERE a.vendor_id = v.id AND a.ended_at IS NULL) AS 현재배정,
       (SELECT count(*) FROM contact_assignments a WHERE a.vendor_id = v.id AND a.ended_at IS NOT NULL) AS 끝난배정,
       (SELECT count(*) FROM vendor_staff s WHERE s.vendor_id = v.id AND s.ended_at IS NULL) AS 지점담당,
       (SELECT count(*) FROM erp_consultations c WHERE c.vendor_id = v.id) AS 상담,
       (SELECT count(*) FROM erp_orders o WHERE o.vendor_id = v.id) AS 주문처,
       (SELECT count(*) FROM contact_activities t WHERE t.vendor_id = v.id) AS 영업일지,
       (SELECT count(*) FROM erp_vendor_aliases al WHERE al.alias_type = 'customer' AND al.vendor_id = v.id) AS 별칭
  FROM vendors v JOIN fin f ON f.root = v.id
 WHERE v.status = 'merged'
   AND (EXISTS (SELECT 1 FROM contact_assignments a WHERE a.vendor_id = v.id)
     OR EXISTS (SELECT 1 FROM vendor_staff s WHERE s.vendor_id = v.id AND s.ended_at IS NULL)
     OR EXISTS (SELECT 1 FROM erp_consultations c WHERE c.vendor_id = v.id)
     OR EXISTS (SELECT 1 FROM erp_orders o WHERE o.vendor_id = v.id)
     OR EXISTS (SELECT 1 FROM contact_activities t WHERE t.vendor_id = v.id)
     OR EXISTS (SELECT 1 FROM erp_vendor_aliases al WHERE al.alias_type = 'customer' AND al.vendor_id = v.id))
 ORDER BY 병합일 DESC NULLS LAST, v.name;

-- [5] (B) 주문서에서 고른 주문처와 매출 집계 매출처가 다른 주문 — 매출이 다른 매출처로 잡히는 건
--     원인 후보: 같은 표기(별칭)가 이미 다른 매출처에 연결돼 있으면 주문 저장이 그 연결을 그대로 쓴다.
--     집계_매출처상태가 merged 면 그 주문은 매출처관리 집계에서 아예 빠진다.
WITH RECURSIVE ch AS (
  SELECT id AS root, id AS cur, 0 AS d FROM vendors
  UNION ALL
  SELECT ch.root, v.merged_into_id, ch.d + 1
    FROM ch JOIN vendors v ON v.id = ch.cur
   WHERE v.status = 'merged' AND v.merged_into_id IS NOT NULL AND ch.d < 10
),
fin AS (SELECT DISTINCT ON (root) root, cur FROM ch ORDER BY root, d DESC)
SELECT o.order_no AS 주문번호, o.order_date AS 주문일, o.bank_name AS 저장_업체, o.branch_name AS 저장_지점, o.manager_name AS 저장_고객,
       (SELECT name FROM vendors WHERE id = fo.cur) AS 주문처_매출처,
       al.erp_name AS 별칭,
       va.name AS 집계_매출처, va.status AS 집계_매출처상태,
       o.total_amount AS 금액
  FROM erp_orders o
  LEFT JOIN erp_vendor_aliases al ON al.id = o.customer_alias_id
  LEFT JOIN vendors va ON va.id = al.vendor_id
  LEFT JOIN fin fo ON fo.root = o.vendor_id
 WHERE o.vendor_id IS NOT NULL AND o.canceled_at IS NULL
   AND al.vendor_id IS DISTINCT FROM fo.cur
 ORDER BY o.order_date DESC, o.order_no;

-- [6] (C) 활성 매출처 2곳 이상에 '현재 소속'인 인물 — 인물 합치기 · 인사이동 뒤 옛 소속이 안 끝난 경우
--     매출처관리 고객 화면은 시작일이 가장 늦은 소속 하나만 보여 준다
SELECT c.code AS 고객코드, c.name AS 이름, c.phone AS 핸드폰,
       string_agg(v.name || ' (' || COALESCE(a.title, '-') || ', 시작 ' || COALESCE(a.started_at::text, '없음')
                  || ', 생성 ' || a.created_at::date || ')', ' | ' ORDER BY COALESCE(a.started_at, a.created_at::date) DESC) AS 현재소속들
  FROM contact_assignments a
  JOIN contacts c ON c.id = a.contact_id AND c.merged_into_id IS NULL
  JOIN vendors v ON v.id = a.vendor_id AND v.type IN ('customer','both') AND v.status IS DISTINCT FROM 'merged' AND v.is_active
 WHERE a.ended_at IS NULL
 GROUP BY c.id, c.code, c.name, c.phone
HAVING count(DISTINCT a.vendor_id) > 1
 ORDER BY c.name;

-- [7] (D) 비활성 매출처에만 현재 소속인 인물 — 상담 · 주문 검색에는 안 나오고 매출처관리 고객 화면에는 그 소속으로 나온다
SELECT c.code AS 고객코드, c.name AS 이름, c.phone AS 핸드폰,
       string_agg(v.name, ' | ') AS 비활성_소속
  FROM contact_assignments a
  JOIN contacts c ON c.id = a.contact_id AND c.merged_into_id IS NULL
  JOIN vendors v ON v.id = a.vendor_id AND v.type IN ('customer','both') AND v.status IS DISTINCT FROM 'merged'
 WHERE a.ended_at IS NULL
 GROUP BY c.id, c.code, c.name, c.phone
HAVING bool_or(v.is_active) = false
 ORDER BY c.name
 LIMIT 300;

-- [8] (F) 매출처 연결 없이 글자만 저장된 상담 — 업체 · 지점 표기별
SELECT COALESCE(c.bank_name, '(빈칸)') AS 업체표기, COALESCE(c.branch_name, '(빈칸)') AS 지점표기,
       count(*) AS 상담수, max(c.consult_date) AS 최근
  FROM erp_consultations c
 WHERE c.vendor_id IS NULL AND c.deleted_at IS NULL
 GROUP BY 1, 2
 ORDER BY 상담수 DESC, 최근 DESC;
