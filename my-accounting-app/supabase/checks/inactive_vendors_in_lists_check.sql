-- =====================================================
-- 상담일지 · 주문서 목록에 '매출처관리에 없는 거래처'가 섞이는 규모 점검 — 2026-11-19 문의
-- "은행 · 지점 · 고객명 · 연락처 목록에 활성화되지 않은 매출처 정보도 나온다"
--
-- 매출처관리 기준 = vendors.type IN ('customer','both') AND status <> 'merged', 비활성(is_active = false)은 기본 숨김.
-- 상담 · 주문 목록 기준(현재 코드):
--   업체 · 지점 칸 = vendors.is_active = true 전부 — 매입처(type = 'vendor')가 걸러지지 않음
--   담당자 · 핸드폰 검색 = 현재 소속이 없으면 '최근 소속'을 고를 수 있게 둠 — 비활성 매출처 소속이 그대로 나옴
-- 조회만 한다 (데이터 변경 없음).
-- =====================================================

-- [1] 업체 · 지점 칸에 들어가는 거래처 중 매출처관리에 없는 것 (매입처)
SELECT
  count(*) FILTER (WHERE type IN ('customer', 'both'))                AS "매출처_지점목록",
  count(*) FILTER (WHERE type NOT IN ('customer', 'both') OR type IS NULL) AS "매입처_지점목록에섞임"
  FROM vendors
 WHERE is_active = true AND status IS DISTINCT FROM 'merged';

-- [2] 업체 칸에 매입처 때문에만 들어가는 업체 (활성 매출처 지점은 없고 매입처만 있음)
SELECT g.name AS 업체명,
       count(*) FILTER (WHERE v.type NOT IN ('customer', 'both') OR v.type IS NULL) AS 매입처수
  FROM vendor_groups g
  JOIN vendors v ON v.group_id = g.id AND v.is_active = true AND v.status IS DISTINCT FROM 'merged'
 WHERE g.is_active = true
 GROUP BY g.id, g.name
HAVING count(*) FILTER (WHERE v.type IN ('customer', 'both')) = 0
 ORDER BY g.name;

-- [3] 담당자 검색에서 '최근 소속'으로 비활성 · 병합 매출처가 나오는 사람 (활성 매출처 현재 소속이 하나도 없음)
WITH a AS (
  SELECT ca.contact_id, v.name AS vendor_name, v.is_active, v.status, v.type, ca.ended_at
    FROM contact_assignments ca
    JOIN vendors v ON v.id = ca.vendor_id
    JOIN contacts c ON c.id = ca.contact_id AND c.merged_into_id IS NULL
)
SELECT count(DISTINCT contact_id) AS "비활성소속만_있는_담당자"
  FROM a
 WHERE contact_id NOT IN (
   SELECT contact_id FROM a
    WHERE ended_at IS NULL AND is_active = true AND status IS DISTINCT FROM 'merged' AND type IN ('customer', 'both'));

-- [4] 담당자 검색에서 매입처가 '현재 소속'으로 나오는 사람 (매입처 담당자)
SELECT count(DISTINCT ca.contact_id) AS "매입처_소속_담당자"
  FROM contact_assignments ca
  JOIN vendors v ON v.id = ca.vendor_id
 WHERE ca.ended_at IS NULL AND v.is_active = true AND (v.type NOT IN ('customer', 'both') OR v.type IS NULL);
