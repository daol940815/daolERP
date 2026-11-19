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
-- [3] 실행 (2026-11-19 드라이런 결과: 직함에_님 19 · 현재 17 · 이름에_님 1 · 이름에_직함 2 = '허정 대리님' · '회원 일동')
--   '회원 일동'은 사람이 아니므로 자동 정리에서 뺀다 → 이름은 '님'으로 끝나는 것만 고친다 (허정 대리님 1명).
--   한 문장(원자적)으로 실행되고 고친 건수를 한 줄로 보여준다. 기대: 이름직함_옮김 1 · 이름_정리 1 · 직함_정리 19
WITH moved AS (
  UPDATE contact_assignments ca
     SET title = nullif(btrim(regexp_replace(substr(btrim(c.name), length(split_part(btrim(c.name), ' ', 1)) + 1), '(\s*님)+\s*$', '')), '')
    FROM contacts c
   WHERE c.id = ca.contact_id AND c.merged_into_id IS NULL AND ca.ended_at IS NULL
     AND c.name ~ '님\s*$' AND btrim(c.name) ~ '^[가-힣]{2,4}\s+\S' AND nullif(btrim(ca.title), '') IS NULL
  RETURNING ca.id
), renamed AS (
  UPDATE contacts
     SET name = split_part(btrim(regexp_replace(name, '(\s*님)+\s*$', '')), ' ', 1)
   WHERE merged_into_id IS NULL AND name ~ '님\s*$'
  RETURNING id
), titled AS (
  UPDATE contact_assignments SET title = nullif(btrim(regexp_replace(title, '(\s*님)+\s*$', '')), '')
   WHERE title ~ '님\s*$'
  RETURNING id
)
SELECT (SELECT count(*) FROM moved) AS 이름직함_옮김, (SELECT count(*) FROM renamed) AS 이름_정리, (SELECT count(*) FROM titled) AS 직함_정리;

-- [4] 검증 — 실행 뒤 [1] 드라이런을 다시 실행. 기대: 0 · 0 · 0 · 1 · '회원 일동' (회원 일동은 매출처관리에서 사람이 처리)
