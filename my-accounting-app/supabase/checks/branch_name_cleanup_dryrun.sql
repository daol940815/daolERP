-- =====================================================
-- branch_name_cleanup_dryrun.sql — 지점명 보정 드라이런 (실행 전 규모 확인용)
--
-- 문제: branchLabel이 법인 접두("(주)", "㈜", "주식회사") 때문에 업체명을 못 떼서
--       부서(지점)에 "(주)하나은행오류동지점" 같은 전체 이름이 저장됨.
-- 보정 규칙: 지점명·업체명 양쪽에서 법인 접두를 뗀 뒤, 지점명이 업체명으로
--       시작하면 그 뒷부분("오류동지점")만 남긴다.
-- 대상: erp_consultations(상담일지) + erp_orders 중 source='direct'(직접 입력 주문).
--       업로드 주문은 원본 보존 원칙상 제외.
-- 이 파일은 조회만 한다 — 데이터를 바꾸지 않는다.
-- =====================================================

-- 공통 정규화 로직을 뷰처럼 쓰기 위한 함수 표현 (인라인 반복)
--   norm(x) = regexp_replace(x, '^\s*(\(주\)|㈜|주식회사)\s*', '')

-- ── 1) 상담일지: 보정 대상 건수 ───────────────────────
WITH target AS (
  SELECT c.id, c.consult_date, c.bank_name, c.branch_name,
         v.name AS vendor_name, g.name AS group_name,
         regexp_replace(v.name, '^\s*(\(주\)|㈜|주식회사)\s*', '') AS vn,
         regexp_replace(g.name, '^\s*(\(주\)|㈜|주식회사)\s*', '') AS gn
    FROM erp_consultations c
    JOIN vendors v ON v.id = c.vendor_id
    JOIN vendor_groups g ON g.id = v.group_id
   WHERE c.branch_name IS NOT NULL
)
SELECT count(*)                                              AS "상담 전체(지점 연결)",
       count(*) FILTER (
         WHERE vn LIKE gn || '%'
           AND NULLIF(trim(substr(vn, length(gn) + 1)), '') IS NOT NULL
           AND branch_name IS DISTINCT FROM trim(substr(vn, length(gn) + 1))
       )                                                     AS "보정 대상"
  FROM target;

-- ── 2) 상담일지: 보정 예시 20건 (현재값 → 보정값) ─────
WITH target AS (
  SELECT c.id, c.consult_date, c.bank_name, c.branch_name,
         v.name AS vendor_name, g.name AS group_name,
         regexp_replace(v.name, '^\s*(\(주\)|㈜|주식회사)\s*', '') AS vn,
         regexp_replace(g.name, '^\s*(\(주\)|㈜|주식회사)\s*', '') AS gn
    FROM erp_consultations c
    JOIN vendors v ON v.id = c.vendor_id
    JOIN vendor_groups g ON g.id = v.group_id
   WHERE c.branch_name IS NOT NULL
)
SELECT consult_date  AS 상담일,
       group_name    AS 업체,
       branch_name   AS 현재_부서지점,
       trim(substr(vn, length(gn) + 1)) AS 보정_후
  FROM target
 WHERE vn LIKE gn || '%'
   AND NULLIF(trim(substr(vn, length(gn) + 1)), '') IS NOT NULL
   AND branch_name IS DISTINCT FROM trim(substr(vn, length(gn) + 1))
 ORDER BY consult_date DESC
 LIMIT 20;

-- ── 3) 직접 입력 주문: 보정 대상 건수 ─────────────────
WITH target AS (
  SELECT o.id, o.order_date, o.bank_name, o.branch_name,
         v.name AS vendor_name, g.name AS group_name,
         regexp_replace(v.name, '^\s*(\(주\)|㈜|주식회사)\s*', '') AS vn,
         regexp_replace(g.name, '^\s*(\(주\)|㈜|주식회사)\s*', '') AS gn
    FROM erp_orders o
    JOIN vendors v ON v.id = o.vendor_id
    JOIN vendor_groups g ON g.id = v.group_id
   WHERE o.source = 'direct'
     AND o.branch_name IS NOT NULL
)
SELECT count(*)                                              AS "직접주문 전체(지점 연결)",
       count(*) FILTER (
         WHERE vn LIKE gn || '%'
           AND NULLIF(trim(substr(vn, length(gn) + 1)), '') IS NOT NULL
           AND branch_name IS DISTINCT FROM trim(substr(vn, length(gn) + 1))
       )                                                     AS "보정 대상"
  FROM target;

-- ── 4) 직접 입력 주문: 보정 예시 20건 ─────────────────
WITH target AS (
  SELECT o.id, o.order_date, o.order_no, o.bank_name, o.branch_name,
         v.name AS vendor_name, g.name AS group_name,
         regexp_replace(v.name, '^\s*(\(주\)|㈜|주식회사)\s*', '') AS vn,
         regexp_replace(g.name, '^\s*(\(주\)|㈜|주식회사)\s*', '') AS gn
    FROM erp_orders o
    JOIN vendors v ON v.id = o.vendor_id
    JOIN vendor_groups g ON g.id = v.group_id
   WHERE o.source = 'direct'
     AND o.branch_name IS NOT NULL
)
SELECT order_date   AS 주문일,
       order_no     AS 주문번호,
       group_name   AS 업체,
       branch_name  AS 현재_부서지점,
       trim(substr(vn, length(gn) + 1)) AS 보정_후
  FROM target
 WHERE vn LIKE gn || '%'
   AND NULLIF(trim(substr(vn, length(gn) + 1)), '') IS NOT NULL
   AND branch_name IS DISTINCT FROM trim(substr(vn, length(gn) + 1))
 ORDER BY order_date DESC
 LIMIT 20;

-- ── 5) 참고: 그룹 미연결이라 자동 보정이 불가능한 자유 입력분 ──
-- (vendor_id가 없거나 그룹이 없는 상담 — 이 건들은 규칙 적용 불가, 별도 판단)
SELECT count(*) AS "자유입력 상담(보정규칙 밖)"
  FROM erp_consultations c
  LEFT JOIN vendors v ON v.id = c.vendor_id
 WHERE c.branch_name IS NOT NULL
   AND (c.vendor_id IS NULL OR v.group_id IS NULL);
