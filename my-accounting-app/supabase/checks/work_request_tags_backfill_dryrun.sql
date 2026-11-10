-- =====================================================
-- work_request_tags_backfill_dryrun.sql — 기존 업무 요청 태그 일괄 지정 드라이런 (904 후속, 2026-11-10)
--
-- 배경: 904 실행 시점의 요청 54건이 전부 미분류. 열린 요청만 키워드 추천으로 태그를 붙이기로 함(닫힌 요청은 미분류 유지).
-- 추천 규칙: 화면의 추천과 같다 — 사용 중인 태그의 추천 키워드가 제목 + 내용에 들어 있으면 그 태그. 순서(sort)대로 최대 3개.
--           기타는 키워드가 없어 추천되지 않는다. 추천이 없는 요청은 그대로 미분류로 남긴다(사람이 상세에서 직접 지정).
-- 대상: 열린 요청(미확인 · 수락 · 진행 중 · 처리 보고) 중 태그가 하나도 없는 것.
-- 이 파일은 조회만 한다 — 데이터를 바꾸지 않는다. 결과를 보고 승인하면 실행 SQL 을 따로 만든다.
-- =====================================================

-- ① 규모: 전체 · 열린 요청 · 추천이 붙는 건수
WITH target AS (
  SELECT r.id, lower(r.title || ' ' || coalesce(r.content, '')) AS hay
  FROM work_requests r
  WHERE r.status IN ('requested', 'accepted', 'in_progress', 'done_reported')
    AND NOT EXISTS (SELECT 1 FROM work_request_tag_links l WHERE l.request_id = r.id)
), rec AS (
  SELECT g.id, t.id AS tag_id, t.label, t.sort
  FROM target g
  JOIN work_request_tags t ON t.active
   AND EXISTS (SELECT 1 FROM unnest(t.keywords) k WHERE btrim(k) <> '' AND position(lower(btrim(k)) IN g.hay) > 0)
)
SELECT
  (SELECT count(*) FROM work_requests)                                   AS 전체_요청,
  (SELECT count(*) FROM work_requests r WHERE NOT EXISTS (SELECT 1 FROM work_request_tag_links l WHERE l.request_id = r.id)) AS 미분류_전체,
  (SELECT count(*) FROM target)                                          AS 대상_열린_미분류,
  (SELECT count(DISTINCT id) FROM rec)                                   AS 추천_있음,
  (SELECT count(*) FROM target) - (SELECT count(DISTINCT id) FROM rec)   AS 추천_없음_미분류_유지,
  (SELECT count(*) FROM (SELECT id FROM rec GROUP BY id HAVING count(*) > 3) x) AS 추천_4개이상_앞3개만;

-- ② 태그별 추천 건수 (요청 1건이 여러 태그에 잡힐 수 있다)
WITH target AS (
  SELECT r.id, lower(r.title || ' ' || coalesce(r.content, '')) AS hay
  FROM work_requests r
  WHERE r.status IN ('requested', 'accepted', 'in_progress', 'done_reported')
    AND NOT EXISTS (SELECT 1 FROM work_request_tag_links l WHERE l.request_id = r.id)
)
SELECT t.label AS 태그, count(g.id) AS 추천_건수
FROM work_request_tags t
LEFT JOIN target g ON EXISTS (SELECT 1 FROM unnest(t.keywords) k WHERE btrim(k) <> '' AND position(lower(btrim(k)) IN g.hay) > 0)
WHERE t.active
GROUP BY t.label, t.sort
ORDER BY t.sort;

-- ③ 표본: 대상 요청 전부와 추천 태그 (건수가 적어 전부 본다). 맞지 않는 줄이 있으면 알려 주세요.
WITH target AS (
  SELECT r.id, r.title, r.status, r.created_at, lower(r.title || ' ' || coalesce(r.content, '')) AS hay
  FROM work_requests r
  WHERE r.status IN ('requested', 'accepted', 'in_progress', 'done_reported')
    AND NOT EXISTS (SELECT 1 FROM work_request_tag_links l WHERE l.request_id = r.id)
)
SELECT to_char(g.created_at AT TIME ZONE 'Asia/Seoul', 'MM-DD') AS 날짜, g.status AS 상태, g.title AS 제목,
  coalesce((
    SELECT string_agg(x.label, ', ' ORDER BY x.sort)
    FROM (
      SELECT t.label, t.sort FROM work_request_tags t
      WHERE t.active AND EXISTS (SELECT 1 FROM unnest(t.keywords) k WHERE btrim(k) <> '' AND position(lower(btrim(k)) IN g.hay) > 0)
      ORDER BY t.sort LIMIT 3
    ) x), '(추천 없음 — 미분류 유지)') AS 추천_태그
FROM target g
ORDER BY g.created_at DESC;
