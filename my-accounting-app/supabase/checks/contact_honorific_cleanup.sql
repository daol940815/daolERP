-- =====================================================
-- 담당자 저장값의 존칭 · 직함 정리 — 2026-11-19 (매출처 목록 내려받기에서 발견)
--
-- 규칙(lib/contact-label.ts): contacts.name = 이름만, contact_assignments.title = 직함만, '님'은 표시할 때 붙인다.
-- 발견: 직함 칸에 '차장님'처럼 '님'까지 저장된 배정, 이름 칸에 '허정 대리님'처럼 직함 · 존칭이 들어간 인물.
--   화면은 contactLabel 이 중복 '님'을 걸러 정상으로 보이지만, 이름 검색 · 동일인 판정 · 엑셀 표기가 어긋난다.
-- 원인: 상담 · 주문 폼과 담당자 등록 화면이 입력값을 그대로 저장 → 2026-11-19 저장 직전 정리(cleanContactName · cleanContactTitle)로 막음.
--
-- [1] 드라이런 — 한 줄로 건수 (SQL 편집기는 마지막 결과만 보여준다)
-- [2] 목록 — 바뀔 값 미리보기
-- [3] 실행 — 승인 후에만. 원본 주문 · 상담의 담당자 표기 문자열(erp_orders.contact 등)은 건드리지 않는다.
-- =====================================================

-- [2] 목록 (필요하면 [1] 대신 이것만 실행)
-- SELECT '직함' AS 구분, c.name AS 이름, ca.title AS 지금, nullif(btrim(regexp_replace(ca.title, '(\s*님)+\s*$', '')), '') AS 바뀜, v.name AS 매출처
--   FROM contact_assignments ca JOIN contacts c ON c.id = ca.contact_id JOIN vendors v ON v.id = ca.vendor_id
--  WHERE ca.title ~ '님\s*$'
-- UNION ALL
-- SELECT '이름', c.name, c.name, split_part(btrim(regexp_replace(c.name, '(\s*님)+\s*$', '')), ' ', 1), ''
--   FROM contacts c
--  WHERE c.merged_into_id IS NULL AND (c.name ~ '님\s*$' OR btrim(c.name) ~ '^[가-힣]{2,4}\s+\S')
--  ORDER BY 1, 2;

-- [1] 드라이런
SELECT
  (SELECT count(*) FROM contact_assignments WHERE title ~ '님\s*$')                                   AS "직함에_님_배정",
  (SELECT count(*) FROM contact_assignments WHERE title ~ '님\s*$' AND ended_at IS NULL)              AS "그중_현재배정",
  (SELECT count(*) FROM contacts WHERE merged_into_id IS NULL AND name ~ '님\s*$')                    AS "이름에_님_인물",
  (SELECT count(*) FROM contacts WHERE merged_into_id IS NULL AND btrim(name) ~ '^[가-힣]{2,4}\s+\S') AS "이름에_직함_인물",
  (SELECT string_agg(name, ' · ' ORDER BY name) FROM contacts
    WHERE merged_into_id IS NULL AND (name ~ '님\s*$' OR btrim(name) ~ '^[가-힣]{2,4}\s+\S'))         AS "이름_목록";

-- [3] 실행 (승인 후 — 주석을 풀고 한 번에 실행)
-- BEGIN;
-- -- 3-1 이름 칸의 직함을 직함이 빈 현재 배정으로 옮긴다 ('허정 대리님' → 이름 '허정', 직함 '대리')
-- UPDATE contact_assignments ca
--    SET title = nullif(btrim(regexp_replace(substr(btrim(c.name), length(split_part(btrim(c.name), ' ', 1)) + 1), '(\s*님)+\s*$', '')), '')
--   FROM contacts c
--  WHERE c.id = ca.contact_id AND c.merged_into_id IS NULL AND ca.ended_at IS NULL
--    AND btrim(c.name) ~ '^[가-힣]{2,4}\s+\S' AND nullif(btrim(ca.title), '') IS NULL;
-- -- 3-2 이름: 끝 '님' 제거 + 첫 낱말만
-- UPDATE contacts
--    SET name = split_part(btrim(regexp_replace(name, '(\s*님)+\s*$', '')), ' ', 1)
--  WHERE merged_into_id IS NULL AND (name ~ '님\s*$' OR btrim(name) ~ '^[가-힣]{2,4}\s+\S');
-- -- 3-3 직함: 끝 '님' 제거 (이력 117 은 사람이 바꾼 직함만 기록하므로 여기서는 남기지 않는다)
-- UPDATE contact_assignments SET title = nullif(btrim(regexp_replace(title, '(\s*님)+\s*$', '')), '')
--  WHERE title ~ '님\s*$';
-- -- 검증: 아래 세 값이 모두 0 이면 COMMIT, 아니면 ROLLBACK
-- SELECT (SELECT count(*) FROM contact_assignments WHERE title ~ '님\s*$') AS 남은_직함,
--        (SELECT count(*) FROM contacts WHERE merged_into_id IS NULL AND name ~ '님\s*$') AS 남은_이름님,
--        (SELECT count(*) FROM contacts WHERE merged_into_id IS NULL AND btrim(name) ~ '^[가-힣]{2,4}\s+\S') AS 남은_이름직함;
-- COMMIT;
