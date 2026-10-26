-- =====================================================
-- 418_relink_unlinked_tax_invoices.sql  (회계 트랙 — 1회성 데이터 정리)
-- 거래처 미연결 계산서 재연결 (2026-10-26)
--
-- 배경: 417로 자사 거래처를 지우면서 거기 붙어 있던 계산서의 vendor_id가 NULL이 됐다
--   (417 STEP 3: 미연결 매입 159 · 매출 1). 계산서 화면에는 거래처 재연결 기능이 없다
--   (auto-match는 입출금 매칭) → 업로더와 같은 규칙으로 SQL에서 다시 붙인다.
-- 규칙(업로더 app/api/tax-invoices/import와 동일): 활성 거래처 중 사업자번호가 같은 것 우선,
--   없으면 상호가 같은 것(공백 제거·대소문자 무시). 후보가 둘 이상이면 붙이지 않는다(사람 판단).
--   상대방이 우리 회사(701-88-00023)인 행은 붙이지 않는다.
-- 거래처를 새로 만들지는 않는다 — 어느 거래처에도 없는 상대방은 '남음'으로 보고하고 사람이 등록한다.
-- =====================================================

-- ── STEP 1. 드라이런 ──────────────────────────────────
WITH u AS (
  SELECT t.id, t.direction, t.total_amount, t.counterparty_name, t.counterparty_biz_number,
         regexp_replace(lower(COALESCE(t.counterparty_name, '')), '\s', '', 'g') AS nm
  FROM tax_invoices t
  WHERE t.vendor_id IS NULL
    AND COALESCE(t.counterparty_biz_number, '') <> '701-88-00023'
),
by_biz AS (
  SELECT u.id, COUNT(DISTINCT v.id) n, MIN(v.id::text) vid
  FROM u JOIN vendors v ON v.status = 'active' AND v.biz_number = u.counterparty_biz_number
  WHERE u.counterparty_biz_number IS NOT NULL AND u.counterparty_biz_number <> ''
  GROUP BY u.id
),
by_name AS (
  SELECT u.id, COUNT(DISTINCT v.id) n, MIN(v.id::text) vid
  FROM u JOIN vendors v ON v.status = 'active'
       AND regexp_replace(lower(v.name), '\s', '', 'g') = u.nm
  WHERE u.nm <> '' AND u.id NOT IN (SELECT id FROM by_biz WHERE n = 1)
  GROUP BY u.id
)
SELECT
  (SELECT COUNT(*) FROM u)                                  AS 미연결,
  (SELECT COUNT(*) FROM by_biz WHERE n = 1)                 AS 사업자번호로_연결,
  (SELECT COUNT(*) FROM by_name WHERE n = 1)                AS 상호로_연결,
  (SELECT COUNT(*) FROM by_biz WHERE n > 1)
    + (SELECT COUNT(*) FROM by_name WHERE n > 1)            AS 후보여럿_보류,
  (SELECT COUNT(*) FROM u WHERE u.id NOT IN (SELECT id FROM by_biz WHERE n = 1)
                            AND u.id NOT IN (SELECT id FROM by_name WHERE n = 1)) AS 남음,
  (SELECT COALESCE(SUM(total_amount), 0) FROM u WHERE direction = 'purchase'
     AND (u.id IN (SELECT id FROM by_biz WHERE n = 1) OR u.id IN (SELECT id FROM by_name WHERE n = 1))) AS 연결될_매입계산서_합계;

-- 1-b. 남는 상대방(어느 거래처에도 없음) — 사람이 등록할 목록
WITH u AS (
  SELECT t.id, t.direction, t.total_amount, t.counterparty_name, t.counterparty_biz_number,
         regexp_replace(lower(COALESCE(t.counterparty_name, '')), '\s', '', 'g') AS nm
  FROM tax_invoices t
  WHERE t.vendor_id IS NULL AND COALESCE(t.counterparty_biz_number, '') <> '701-88-00023'
)
SELECT u.counterparty_name AS 상호, u.counterparty_biz_number AS 사업자번호, u.direction AS 방향,
       COUNT(*) AS 건수, SUM(u.total_amount) AS 합계
FROM u
WHERE NOT EXISTS (SELECT 1 FROM vendors v WHERE v.status = 'active' AND v.biz_number = u.counterparty_biz_number
                   AND u.counterparty_biz_number IS NOT NULL AND u.counterparty_biz_number <> '')
  AND NOT EXISTS (SELECT 1 FROM vendors v WHERE v.status = 'active'
                   AND regexp_replace(lower(v.name), '\s', '', 'g') = u.nm AND u.nm <> '')
GROUP BY 1, 2, 3 ORDER BY 5 DESC;

-- ── STEP 2. 재연결 ────────────────────────────────────
DO $$
DECLARE v_biz int; v_name int;
BEGIN
  -- 사업자번호 유일 일치
  WITH cand AS (
    SELECT t.id, MIN(v.id::text)::uuid AS vid, COUNT(DISTINCT v.id) n
    FROM tax_invoices t JOIN vendors v ON v.status = 'active' AND v.biz_number = t.counterparty_biz_number
    WHERE t.vendor_id IS NULL AND t.counterparty_biz_number IS NOT NULL AND t.counterparty_biz_number <> ''
      AND t.counterparty_biz_number <> '701-88-00023'
    GROUP BY t.id
  ), upd AS (
    UPDATE tax_invoices t SET vendor_id = c.vid FROM cand c WHERE c.n = 1 AND t.id = c.id RETURNING t.id
  ) SELECT COUNT(*) INTO v_biz FROM upd;

  -- 상호 유일 일치 (사업자번호로 못 붙은 것만)
  WITH cand AS (
    SELECT t.id, MIN(v.id::text)::uuid AS vid, COUNT(DISTINCT v.id) n
    FROM tax_invoices t JOIN vendors v ON v.status = 'active'
      AND regexp_replace(lower(v.name), '\s', '', 'g') = regexp_replace(lower(COALESCE(t.counterparty_name, '')), '\s', '', 'g')
    WHERE t.vendor_id IS NULL AND COALESCE(t.counterparty_name, '') <> ''
      AND COALESCE(t.counterparty_biz_number, '') <> '701-88-00023'
    GROUP BY t.id
  ), upd AS (
    UPDATE tax_invoices t SET vendor_id = c.vid FROM cand c WHERE c.n = 1 AND t.id = c.id RETURNING t.id
  ) SELECT COUNT(*) INTO v_name FROM upd;

  RAISE NOTICE '계산서 재연결 — 사업자번호 % 건 · 상호 % 건', v_biz, v_name;
END $$;

-- ── STEP 3. 검증 ──────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM tax_invoices WHERE vendor_id IS NULL AND direction = 'purchase') AS 미연결_매입계산서,
  (SELECT COUNT(*) FROM tax_invoices WHERE vendor_id IS NULL AND direction = 'sales')    AS 미연결_매출계산서,
  (SELECT COUNT(*) FROM tax_invoices t JOIN vendors v ON v.id = t.vendor_id WHERE v.status <> 'active') AS 비활성거래처_연결,
  (SELECT COALESCE(SUM(GREATEST(0, outstanding)), 0) FROM hub_purchase_summary(NULL, NULL))  AS 허브_미지급_합계;
