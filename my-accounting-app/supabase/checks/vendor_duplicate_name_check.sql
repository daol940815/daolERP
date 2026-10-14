-- =====================================================
-- vendor_duplicate_name_check.sql  (읽기 전용 — 데이터 변경 없음)
-- 같은 이름의 거래처가 여러 건인 경우 — '하나은행 압구정금융센터' 3건 (2026-10-14)
--
-- 통장 내역 거래처 드롭다운은 vendors 전체(비활성 포함)의 이름을 그대로 나열했다.
-- 같은 이름이 여러 건이면 (1) 드롭다운에 중복 표시, (2) 이름으로 매핑하므로 첫 건만 선택됨.
-- 여기서는 어떤 행들이 있고 각각 어디서 참조되는지 본다 → 병합(거래처 중복 정리 화면) 대상 판단.
-- =====================================================

WITH dup AS (
  SELECT lower(regexp_replace(name, '\s|주식회사|\(주\)|㈜|（주）', '', 'g')) AS key, COUNT(*) AS n
  FROM vendors
  GROUP BY 1
  HAVING COUNT(*) > 1
)
SELECT jsonb_pretty(jsonb_build_object(

  -- [1] 압구정금융센터 — 행별 상세와 참조
  '압구정금융센터', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t->>'생성'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'id', v.id, '이름', v.name, '사업자번호', v.biz_number, '유형', v.type, '활성', v.is_active,
        '생성', v.created_at, '별칭목록', v.match_aliases,
        '통장', (SELECT COUNT(*) FROM transactions t WHERE t.vendor_id = v.id),
        '계산서', (SELECT COUNT(*) FROM tax_invoices t WHERE t.vendor_id = v.id),
        'ERP별칭', (SELECT COUNT(*) FROM erp_vendor_aliases a WHERE a.vendor_id = v.id),
        '분개', (SELECT COUNT(*) FROM journal_lines jl WHERE jl.vendor_id = v.id),
        '담당자배정', (SELECT COUNT(*) FROM contact_assignments ca WHERE ca.vendor_id = v.id)
      ) AS t
      FROM vendors v
      WHERE v.name ~ '압구정'
    ) s
  ),

  -- [2] 전체 — 정규화(공백·법인표기 제거) 후 같은 이름이 2건 이상인 그룹
  '같은이름_그룹', jsonb_build_object(
    '그룹수', (SELECT COUNT(*) FROM dup),
    '행수',   (SELECT COALESCE(SUM(n), 0) FROM dup),
    '상위20', (
      SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'건수')::int DESC, t->>'이름'), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          '이름', MIN(v.name), '건수', COUNT(*),
          '활성', COUNT(*) FILTER (WHERE v.is_active),
          '사업자번호있음', COUNT(*) FILTER (WHERE v.biz_number IS NOT NULL),
          '유형', jsonb_agg(DISTINCT v.type)
        ) AS t
        FROM vendors v
        JOIN dup ON dup.key = lower(regexp_replace(v.name, '\s|주식회사|\(주\)|㈜|（주）', '', 'g'))
        GROUP BY dup.key
        ORDER BY COUNT(*) DESC, MIN(v.name)
        LIMIT 20
      ) s
    )
  ),

  -- [3] 비활성 거래처 중 아직 참조가 남은 것 (드롭다운에서 빼도 되는지)
  '비활성_참조', (
    SELECT jsonb_build_object(
      '비활성건수', COUNT(*),
      '통장참조있음', COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM transactions t WHERE t.vendor_id = v.id))
    )
    FROM vendors v WHERE NOT v.is_active
  )

)) AS check_result;
