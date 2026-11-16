-- 426 적재 후 별칭을 못 찾아 빠진 2지점 조사 (2026-11-16)
--   기업은행 중기산연구소 3행(이월 648,000 · 10-12 사용 540,000 · 10-16 결제 420,000) / 우리은행 아크로비스타금융센터 1행(이월 4,000)
-- ① 비슷한 이름의 매출처 별칭 · 거래처가 있는지 (표기 차이면 그 별칭 이름으로 바꿔 넣는다)
SELECT 'alias' AS 종류, a.id, a.erp_name AS 이름, a.vendor_id, v.name AS 거래처명, a.merged_into_alias_id
FROM erp_vendor_aliases a LEFT JOIN vendors v ON v.id = a.vendor_id
WHERE a.alias_type = 'customer' AND (a.erp_name ILIKE '%중기산%' OR a.erp_name ILIKE '%아크로비스타%' OR a.erp_name ILIKE '%아크로%')
UNION ALL
SELECT 'vendor', v.id, v.name, v.id, v.name, NULL
FROM vendors v
WHERE v.name ILIKE '%중기산%' OR v.name ILIKE '%아크로비스타%' OR v.name ILIKE '%아크로%'
ORDER BY 1, 3;

-- ② 426 STEP 3 요약 (빠진 4행 제외 기대: 39행 · 잔액 16,660,450)
SELECT COUNT(*) AS legacy_행수,
       COALESCE(SUM(CASE WHEN entry_type = 'deposit' THEN amount ELSE -amount END), 0) AS 잔액
FROM erp_prepayments WHERE source_key LIKE 'legacy:%';
