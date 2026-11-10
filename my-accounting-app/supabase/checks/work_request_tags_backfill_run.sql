-- =====================================================
-- work_request_tags_backfill_run.sql — 기존 열린 업무 요청 태그 일괄 지정 실행 + 검증 (한 번에 전체 실행)
-- 2026-11-10 드라이런 회신: 열린 미분류 26건. 키워드 추천 그대로는 부적합(약 23건이 ERP 피드백 · 개선 요청) → 사용자 결정으로 규칙 변경:
--   ① ERP 건의 성격(아래 두 건을 뺀 전부) = ERP 문의 + 해당 업무 태그(최대 2개)
--        업무 태그는 제목의 키워드로 정하고, 제목에 업무 단어가 없으면 제목 + 내용의 키워드로 정한다(순서대로 2개까지). 없으면 ERP 문의만.
--   ② 회의 컴퓨터 일러스트 설치 요청 = 인사 · 총무
--   ③ 퇴직금 정산 관련 = 회계 · 자금 + 인사 · 총무 (어느 쪽인지 애매해 둘 다)
-- 대상: 열린 요청(미확인 · 수락 · 진행 중 · 처리 보고) 중 태그가 하나도 없는 것. 닫힌 요청은 미분류로 둔다.
-- 연결(work_request_tag_links)만 추가한다 — 요청 자체는 수정하지 않는다. 이미 태그가 있는 요청은 건드리지 않으며, 다시 실행해도 결과가 같다.
-- 기대(드라이런 시점 기준): 태그 붙는 요청 26 · 연결 49 (ERP 문의 24 · 주문 · 배송 10 · 고객 · 매입처 10 · 회계 · 자금 2 · 인사 · 총무 2 · 수금 · 계산서 1)
--   실행 전에 요청이 새로 생기거나 닫혔으면 숫자가 조금 다를 수 있다. 맞지 않는 건은 요청 상세의 "태그 수정"에서 고친다.
-- =====================================================

WITH target AS (
  SELECT r.id, r.title, lower(r.title) AS t, lower(r.title || ' ' || coalesce(r.content, '')) AS hay
  FROM work_requests r
  WHERE r.status IN ('requested', 'accepted', 'in_progress', 'done_reported')
    AND NOT EXISTS (SELECT 1 FROM work_request_tag_links l WHERE l.request_id = r.id)
),
special AS (   -- ERP 건의가 아닌 두 건 (제목으로 지정)
  SELECT g.id, tg.id AS tag_id
  FROM target g
  JOIN work_request_tags tg
    ON (g.title LIKE '%일러스트 설치%' AND tg.code = 'hr')
    OR (g.title LIKE '퇴직금 정산%'   AND tg.code IN ('acct', 'hr'))
),
erp AS (       -- 나머지 전부 = ERP 건의 → ERP 문의
  SELECT g.id, tg.id AS tag_id
  FROM target g JOIN work_request_tags tg ON tg.code = 'erp'
  WHERE g.id NOT IN (SELECT id FROM special)
),
biz_title AS ( -- 업무 태그 후보: 제목의 키워드 (ERP 문의 · 기타 제외)
  SELECT g.id, tg.id AS tag_id, tg.sort
  FROM target g
  JOIN work_request_tags tg ON tg.active AND tg.code IS DISTINCT FROM 'erp' AND tg.code IS DISTINCT FROM 'etc'
   AND EXISTS (SELECT 1 FROM unnest(tg.keywords) k WHERE btrim(k) <> '' AND position(lower(btrim(k)) IN g.t) > 0)
  WHERE g.id NOT IN (SELECT id FROM special)
),
biz_body AS (  -- 제목에 업무 단어가 없는 요청만: 제목 + 내용의 키워드
  SELECT g.id, tg.id AS tag_id, tg.sort
  FROM target g
  JOIN work_request_tags tg ON tg.active AND tg.code IS DISTINCT FROM 'erp' AND tg.code IS DISTINCT FROM 'etc'
   AND EXISTS (SELECT 1 FROM unnest(tg.keywords) k WHERE btrim(k) <> '' AND position(lower(btrim(k)) IN g.hay) > 0)
  WHERE g.id NOT IN (SELECT id FROM special) AND g.id NOT IN (SELECT id FROM biz_title)
),
biz AS (       -- 업무 태그는 요청당 2개까지 (ERP 문의와 합쳐 최대 3개)
  SELECT id, tag_id FROM (
    SELECT u.id, u.tag_id, row_number() OVER (PARTITION BY u.id ORDER BY u.sort) AS rn
    FROM (SELECT * FROM biz_title UNION ALL SELECT * FROM biz_body) u
  ) x WHERE rn <= 2
)
INSERT INTO work_request_tag_links (request_id, tag_id)
SELECT id, tag_id FROM special
UNION SELECT id, tag_id FROM erp
UNION SELECT id, tag_id FROM biz
ON CONFLICT DO NOTHING;

-- 검증 ① 태그별 연결 수 (전체 요청 기준 — 실행 후 새 요청이 없었다면 위 기대값과 같다)
SELECT t.label AS 태그, count(l.request_id) AS 연결_건수
FROM work_request_tags t LEFT JOIN work_request_tag_links l ON l.tag_id = t.id
GROUP BY t.label, t.sort ORDER BY t.sort;

-- 검증 ② 열린 요청 전부와 붙은 태그 (마지막 결과 — 이 표를 확인해 주세요). 태그_없는_열린_요청 기대 0
SELECT to_char(r.created_at AT TIME ZONE 'Asia/Seoul', 'MM-DD') AS 날짜, r.status AS 상태, r.title AS 제목,
  coalesce((SELECT string_agg(t.label, ', ' ORDER BY t.sort)
            FROM work_request_tag_links l JOIN work_request_tags t ON t.id = l.tag_id WHERE l.request_id = r.id), '(미분류)') AS 태그,
  count(*) OVER () AS 열린_요청_전체,
  count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM work_request_tag_links l WHERE l.request_id = r.id)) OVER () AS 태그_없는_열린_요청,
  (SELECT count(*) FROM work_request_tag_links) AS 연결_전체,
  (SELECT count(*) FROM work_requests x WHERE NOT EXISTS (SELECT 1 FROM work_request_tag_links l WHERE l.request_id = x.id)) AS 미분류_전체_닫힌요청
FROM work_requests r
WHERE r.status IN ('requested', 'accepted', 'in_progress', 'done_reported')
ORDER BY r.created_at DESC;
