-- =====================================================
-- 업체(vendor_groups) 고아 · 오타 점검 — 2026-11-18 문의 "상담일지 업체 목록에 '푸본헌대생명'이 보이는데 매출처관리에는 없다"
--
-- 원인: 상담일지 · 주문서의 업체(은행) 목록은 vendor_groups(is_active) 전체를 보여주고,
--       매출처관리는 vendors(지점) 기준으로 그려서 지점이 하나도 없는 업체는 화면에 나오지 않는다.
--       업체 행은 상담 · 주문의 신규 등록, 매출처 등록 때 자동으로 생기지만 이름 변경 · 비활성 · 삭제 화면이 없다.
--       지점 이름을 고쳐도 업체 이름은 따라가지 않는다.
-- 순서: [1] 점검 → 결과 보고 → [2] 승인 후 정리(비활성 또는 이름 변경) → [3] 검증
-- =====================================================

-- ---------- [1-a] '푸본' 업체와 지점 현황 ----------
SELECT g.id, g.name AS 업체명, g.is_active AS 활성, g.created_at::date AS 생성일,
       count(v.id) FILTER (WHERE v.status IS DISTINCT FROM 'merged' AND coalesce(v.is_active, true)) AS 활성지점수,
       count(v.id) AS 전체지점수,
       string_agg(v.name || CASE WHEN v.status = 'merged' THEN '(병합)' WHEN v.is_active = false THEN '(비활성)' ELSE '' END, ' · ' ORDER BY v.name) AS 지점들
  FROM vendor_groups g
  LEFT JOIN vendors v ON v.group_id = g.id
 WHERE g.name LIKE '%푸본%'
 GROUP BY g.id, g.name, g.is_active, g.created_at
 ORDER BY g.name;

-- ---------- [1-b] 지점이 하나도 없는(또는 전부 병합 · 비활성인) 활성 업체 전체 — 목록에는 보이지만 매출처관리에는 없는 것 ----------
SELECT g.id, g.name AS 업체명, g.created_at::date AS 생성일,
       count(v.id) AS 전체지점수,
       (SELECT count(*) FROM erp_consultations c WHERE c.vendor_group_id = g.id) AS 상담건수
  FROM vendor_groups g
  LEFT JOIN vendors v ON v.group_id = g.id AND v.status IS DISTINCT FROM 'merged' AND coalesce(v.is_active, true)
 WHERE g.is_active = true
 GROUP BY g.id, g.name, g.created_at
HAVING count(v.id) = 0
 ORDER BY g.name;

-- ---------- [2] 정리 (점검 결과 보고 후 승인받고 실행) ----------
-- (a) 오타 업체 비활성 — 목록에서 사라진다. 행은 남겨 이력 보존.
-- UPDATE vendor_groups SET is_active = false WHERE name = '푸본헌대생명';
-- (b) 오타 업체에 지점이 붙어 있으면: 지점을 올바른 업체로 옮긴 뒤 비활성
-- UPDATE vendors SET group_id = (SELECT id FROM vendor_groups WHERE name = '푸본현대생명' LIMIT 1)
--  WHERE group_id = (SELECT id FROM vendor_groups WHERE name = '푸본헌대생명' LIMIT 1);
-- (c) 상담일지에 오타 업체가 연결돼 있으면 같이 옮긴다 (표기 텍스트 bank_name은 원본이라 두고 연결만)
-- UPDATE erp_consultations SET vendor_group_id = (SELECT id FROM vendor_groups WHERE name = '푸본현대생명' LIMIT 1)
--  WHERE vendor_group_id = (SELECT id FROM vendor_groups WHERE name = '푸본헌대생명' LIMIT 1);

-- ---------- [3] 검증 — 0이어야 한다 ----------
-- SELECT count(*) AS "오타업체_활성_기대0" FROM vendor_groups WHERE name = '푸본헌대생명' AND is_active = true;
