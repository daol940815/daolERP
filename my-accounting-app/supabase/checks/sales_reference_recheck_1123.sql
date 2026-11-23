-- =====================================================
-- 매출처 참조 재점검 — 2026-11-23 (매출처명 정리 뒤). 조회만 한다 (데이터 변경 없음).
-- 전체를 붙여 넣고 한 번 실행하면 결과 한 표로 나온다 (구분 · 항목 · 건수 · 상세).
-- 기대값: 건수 0 이 정상인 항목은 항목 이름에 '(기대 0)'.
-- =====================================================
WITH RECURSIVE ch AS (
  SELECT id AS root, id AS cur, 0 AS d FROM vendors
  UNION ALL
  SELECT ch.root, v.merged_into_id, ch.d + 1
    FROM ch JOIN vendors v ON v.id = ch.cur
   WHERE v.status = 'merged' AND v.merged_into_id IS NOT NULL AND ch.d < 10
),
fin AS (SELECT DISTINCT ON (root) root, cur FROM ch ORDER BY root, d DESC),
mv AS (SELECT id, name FROM vendors WHERE status = 'merged'),
sv AS (SELECT id, name, is_active, group_id, individual_contact_id FROM vendors
        WHERE type IN ('customer','both') AND status IS DISTINCT FROM 'merged'),
cur_asg AS (
  SELECT a.contact_id, c.name AS cname, a.vendor_id, sv.name AS vname, sv.is_active
    FROM contact_assignments a
    JOIN contacts c ON c.id = a.contact_id AND c.merged_into_id IS NULL
    JOIN sv ON sv.id = a.vendor_id
   WHERE a.ended_at IS NULL
),
ord AS (
  SELECT o.order_no, o.total_amount, fo.cur AS order_vendor, al.vendor_id AS agg_vendor
    FROM erp_orders o
    LEFT JOIN erp_vendor_aliases al ON al.id = o.customer_alias_id
    LEFT JOIN fin fo ON fo.root = o.vendor_id
   WHERE o.vendor_id IS NOT NULL AND o.canceled_at IS NULL
),
res AS (
  SELECT 'vendor_id' AS k, a.vendor_id FROM contact_assignments a WHERE a.ended_at IS NULL
  UNION ALL SELECT 's', s.vendor_id FROM vendor_staff s WHERE s.ended_at IS NULL
  UNION ALL SELECT 'c', c.vendor_id FROM erp_consultations c WHERE c.deleted_at IS NULL
  UNION ALL SELECT 'o', o.vendor_id FROM erp_orders o
  UNION ALL SELECT 'al', al.vendor_id FROM erp_vendor_aliases al WHERE al.alias_type = 'customer'
),
dup_name AS (
  SELECT lower(regexp_replace(regexp_replace(name, '^\s*(\(주\)|㈜|주식회사|\(재\))\s*', ''), '\s+', '', 'g')) AS k,
         string_agg(name || CASE WHEN is_active THEN '' ELSE '(비활성)' END, ' / ') AS names, count(*) AS n
    FROM sv WHERE individual_contact_id IS NULL
   GROUP BY 1 HAVING count(*) > 1
)
SELECT * FROM (
  SELECT 1 AS 순, 'A 병합 잔류' AS 구분, '병합된 매출처에 남은 현재 고객 배정 (기대 0)' AS 항목,
         (SELECT count(*) FROM res WHERE k = 'vendor_id' AND vendor_id IN (SELECT id FROM mv)) AS 건수,
         (SELECT string_agg(DISTINCT m.name, ', ') FROM res r JOIN mv m ON m.id = r.vendor_id) AS 상세
  UNION ALL SELECT 2, 'A 병합 잔류', '병합된 매출처에 남은 지점 담당 (기대 0)',
         (SELECT count(*) FROM res WHERE k = 's' AND vendor_id IN (SELECT id FROM mv)), NULL
  UNION ALL SELECT 3, 'A 병합 잔류', '병합된 매출처를 가리키는 상담 (기대 0)',
         (SELECT count(*) FROM res WHERE k = 'c' AND vendor_id IN (SELECT id FROM mv)), NULL
  UNION ALL SELECT 4, 'A 병합 잔류', '병합된 매출처를 가리키는 주문 (기대 0)',
         (SELECT count(*) FROM res WHERE k = 'o' AND vendor_id IN (SELECT id FROM mv)), NULL
  UNION ALL SELECT 5, 'A 병합 잔류', '병합된 매출처에 붙은 ERP 별칭 — 그 주문은 집계에서 빠짐 (기대 0)',
         (SELECT count(*) FROM res WHERE k = 'al' AND vendor_id IN (SELECT id FROM mv)), NULL
  UNION ALL SELECT 6, 'A 병합 잔류', '병합의 최종 남은 쪽이 비활성 (기대 0)',
         (SELECT count(*) FROM fin f JOIN vendors m ON m.id = f.root AND m.status = 'merged' JOIN vendors t ON t.id = f.cur WHERE t.is_active = false),
         (SELECT string_agg(DISTINCT t.name, ', ') FROM fin f JOIN vendors m ON m.id = f.root AND m.status = 'merged' JOIN vendors t ON t.id = f.cur WHERE t.is_active = false)
  UNION ALL SELECT 7, 'B 집계 갈림', '주문서의 주문처와 매출 집계 매출처가 다른 주문 (기대 0)',
         (SELECT count(*) FROM ord WHERE agg_vendor IS DISTINCT FROM order_vendor),
         (SELECT string_agg(o.order_no || ': ' || COALESCE(vo.name, '?') || ' → 집계 ' || COALESCE(va.name, '없음') || COALESCE(' [' || va.status || ']', '')
                 || ' ' || COALESCE(o.total_amount, 0)::bigint || '원', ' | ')
            FROM ord o LEFT JOIN vendors vo ON vo.id = o.order_vendor LEFT JOIN vendors va ON va.id = o.agg_vendor
           WHERE o.agg_vendor IS DISTINCT FROM o.order_vendor)
  UNION ALL SELECT 8, 'C 두 지점 소속', '활성 매출처 2곳 이상에 현재 소속인 사람',
         (SELECT count(*) FROM (SELECT contact_id FROM cur_asg WHERE is_active GROUP BY contact_id HAVING count(DISTINCT vendor_id) > 1) x),
         (SELECT string_agg(x.cname || ' (' || x.vs || ')', ' | ') FROM (
            SELECT cname, string_agg(DISTINCT vname, ', ') AS vs FROM cur_asg WHERE is_active
             GROUP BY contact_id, cname HAVING count(DISTINCT vendor_id) > 1) x)
  UNION ALL SELECT 9, 'C 두 지점 소속', '같은 매출처에 같은 사람 현재 배정이 두 줄 (기대 0)',
         (SELECT count(*) FROM (SELECT contact_id, vendor_id FROM cur_asg GROUP BY 1, 2 HAVING count(*) > 1) x), NULL
  UNION ALL SELECT 10, 'D 비활성', '비활성 매출처에만 현재 소속인 사람',
         (SELECT count(*) FROM (SELECT contact_id FROM cur_asg GROUP BY contact_id HAVING bool_or(is_active) = false) x),
         (SELECT string_agg(x.cname || ' (' || x.vs || ')', ' | ') FROM (
            SELECT cname, string_agg(DISTINCT vname, ', ') AS vs FROM cur_asg GROUP BY contact_id, cname HAVING bool_or(is_active) = false) x)
  UNION ALL SELECT 11, 'D 비활성', '비활성 매출처 수 (11-20 정리 뒤 5 예상)',
         (SELECT count(*) FROM sv WHERE is_active = false),
         (SELECT string_agg(name, ', ') FROM sv WHERE is_active = false)
  UNION ALL SELECT 12, 'E 같은 이름', '같은 이름 매출처 묶음 — 개인 고객 전용 제외 (기대 0)',
         (SELECT count(*) FROM dup_name), (SELECT string_agg(names, ' | ') FROM dup_name)
  UNION ALL SELECT 13, 'E 업체', '업체 미지정 활성 매출처',
         (SELECT count(*) FROM sv WHERE is_active AND group_id IS NULL AND individual_contact_id IS NULL),
         (SELECT string_agg(name, ', ') FROM (SELECT name FROM sv WHERE is_active AND group_id IS NULL AND individual_contact_id IS NULL ORDER BY name LIMIT 40) x)
  UNION ALL SELECT 14, 'F 상담', '매출처 연결 없이 글자만 저장된 상담',
         (SELECT count(*) FROM erp_consultations c WHERE c.vendor_id IS NULL AND c.deleted_at IS NULL),
         (SELECT string_agg(DISTINCT COALESCE(c.bank_name, '') || ' ' || COALESCE(c.branch_name, ''), ', ') FROM erp_consultations c WHERE c.vendor_id IS NULL AND c.deleted_at IS NULL)
  UNION ALL SELECT 15, '유기억', '유기억 현재 소속',
         (SELECT count(*) FROM cur_asg WHERE cname LIKE '%유기억%'),
         (SELECT string_agg(vname || CASE WHEN is_active THEN '' ELSE '(비활성)' END, ', ') FROM cur_asg WHERE cname LIKE '%유기억%')
  UNION ALL SELECT 16, '유기억', '유기억 인물 기록 수 (병합된 것 포함)',
         (SELECT count(*) FROM contacts WHERE name LIKE '%유기억%'),
         (SELECT string_agg(COALESCE(code, '-') || CASE WHEN merged_into_id IS NULL THEN '' ELSE '(합쳐짐)' END, ', ') FROM contacts WHERE name LIKE '%유기억%')
  UNION ALL SELECT 17, '하나은행 도로공사지점', '같은 이름 매출처 (합치기 대상이었음)',
         (SELECT count(*) FROM sv WHERE replace(name, ' ', '') = '하나은행도로공사지점'),
         (SELECT string_agg(name || CASE WHEN is_active THEN '' ELSE '(비활성)' END || ' ' || left(id::text, 8), ', ') FROM sv WHERE replace(name, ' ', '') = '하나은행도로공사지점')
) t ORDER BY 순;
