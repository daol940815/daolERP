-- =====================================================
-- 413_merge_same_biz_vendors.sql  (회계 트랙)
-- 같은 사업자번호로 중복 생성된 거래처 병합 (2026-10-22)
--
-- 원인: 계산서 업로드(app/api/tax-invoices/import)가 거래처 목록을 단일 조회로 읽어
--   PostgREST max-rows(1000)에서 잘렸다. 1000번째 이후 거래처는 "없는 것"으로 보여
--   같은 사업자번호로 새 거래처를 만들었다. (압구정금융센터 3행: 2026-07-21 00:16:55 /
--   00:17:00 — 파일 두 개를 연달아 올릴 때 각각 생성.) 코드는 fetchAllRows로 수정.
--
-- 범위: **사업자번호가 완전히 같은** 그룹만. 같은 법인이 확실하므로 자동 병합해도 안전하다.
--   같은 이름이지만 사업자번호가 다르거나 없는 그룹은 거래처 중복 정리 화면에서 사람이 본다.
-- 방식: 기존 merge_vendor RPC(055)를 그룹마다 호출 — 참조 재지정 + 흡수 행 merged 상태 보존 +
--   vendor_merge_logs 이력. 자동 병합 금지 정책(docs/vendor-master-policy.md §6)은 "사용자 승인 후
--   실행"이므로 STEP 1 드라이런을 보고 승인한 뒤 STEP 3을 실행한다.
-- 대표 선정: 참조(통장+계산서+분개+별칭+담당자)가 가장 많은 행, 같으면 먼저 만든 행.
-- =====================================================

-- ── STEP 0. merge_vendor 보강 — 055 이후 생긴 vendor_id 테이블까지 재지정 ──
-- (055는 transactions·journal_lines·tax_invoices·card_sales·cash_receipts·card_accounts·
--  erp_vendor_aliases·vendor_ledger_entries·vendor_opening_balances만 옮긴다)
CREATE OR REPLACE FUNCTION merge_vendor_extra_refs(p_from UUID, p_into UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  n INT; refs JSONB := '{}'::jsonb;
BEGIN
  -- 담당자 배정: 같은 인물이 양쪽에 다 있으면 흡수 쪽을 지운다(유니크 충돌 방지)
  DELETE FROM contact_assignments a
   WHERE a.vendor_id = p_from
     AND EXISTS (SELECT 1 FROM contact_assignments b
                  WHERE b.vendor_id = p_into AND b.contact_id = a.contact_id);
  UPDATE contact_assignments SET vendor_id = p_into WHERE vendor_id = p_from;
  GET DIAGNOSTICS n = ROW_COUNT; refs := refs || jsonb_build_object('contact_assignments', n);

  DELETE FROM vendor_staff a
   WHERE a.vendor_id = p_from
     AND EXISTS (SELECT 1 FROM vendor_staff b WHERE b.vendor_id = p_into AND b.employee_id = a.employee_id);
  -- 주담당(is_primary)은 거래처당 1명 — 대표에 이미 있으면 흡수 쪽 주담당 표시를 내린다
  IF EXISTS (SELECT 1 FROM vendor_staff WHERE vendor_id = p_into AND is_primary AND ended_at IS NULL) THEN
    UPDATE vendor_staff SET is_primary = false WHERE vendor_id = p_from AND is_primary;
  END IF;
  UPDATE vendor_staff SET vendor_id = p_into WHERE vendor_id = p_from;
  GET DIAGNOSTICS n = ROW_COUNT; refs := refs || jsonb_build_object('vendor_staff', n);

  UPDATE contact_activities SET vendor_id = p_into WHERE vendor_id = p_from;
  GET DIAGNOSTICS n = ROW_COUNT; refs := refs || jsonb_build_object('contact_activities', n);

  -- 매입 기초잔액: 양쪽 다 있으면 금액 합산
  IF EXISTS (SELECT 1 FROM purchase_opening_balances WHERE vendor_id = p_from) THEN
    INSERT INTO purchase_opening_balances (vendor_id, as_of_date, amount)
    SELECT p_into, as_of_date, amount FROM purchase_opening_balances WHERE vendor_id = p_from
    ON CONFLICT (vendor_id) DO UPDATE
      SET amount = purchase_opening_balances.amount + EXCLUDED.amount;
    DELETE FROM purchase_opening_balances WHERE vendor_id = p_from;
    refs := refs || jsonb_build_object('purchase_opening_balances', 1);
  END IF;

  -- 주문시스템·매입처 트랙 테이블 (있으면 옮기고, 없으면 건너뜀)
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'erp_purchase_orders' AND column_name = 'vendor_id') THEN
    EXECUTE 'UPDATE erp_purchase_orders SET vendor_id = $1 WHERE vendor_id = $2' USING p_into, p_from;
    GET DIAGNOSTICS n = ROW_COUNT; refs := refs || jsonb_build_object('erp_purchase_orders', n);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'purchase_cycle_reviews' AND column_name = 'vendor_id') THEN
    EXECUTE 'UPDATE purchase_cycle_reviews SET vendor_id = $1 WHERE vendor_id = $2' USING p_into, p_from;
    GET DIAGNOSTICS n = ROW_COUNT; refs := refs || jsonb_build_object('purchase_cycle_reviews', n);
  END IF;
  -- direct 주문의 주문처 (500: erp_orders.vendor_id)
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'erp_orders' AND column_name = 'vendor_id') THEN
    EXECUTE 'UPDATE erp_orders SET vendor_id = $1 WHERE vendor_id = $2' USING p_into, p_from;
    GET DIAGNOSTICS n = ROW_COUNT; refs := refs || jsonb_build_object('erp_orders', n);
  END IF;
  RETURN refs;
END;
$$;

-- ── STEP 1. 드라이런 (읽기 전용) — 병합 계획 ─────────────
-- 그룹마다 대표(keep)와 흡수될 행들. 이 표를 보고 승인한다.
WITH v AS (
  SELECT ven.id, ven.name, ven.biz_number, ven.type, ven.created_at,
         (SELECT COUNT(*) FROM transactions t WHERE t.vendor_id = ven.id)
       + (SELECT COUNT(*) FROM tax_invoices t WHERE t.vendor_id = ven.id)
       + (SELECT COUNT(*) FROM journal_lines t WHERE t.vendor_id = ven.id)
       + (SELECT COUNT(*) FROM erp_vendor_aliases t WHERE t.vendor_id = ven.id)
       + (SELECT COUNT(*) FROM contact_assignments t WHERE t.vendor_id = ven.id) AS refs
  FROM vendors ven
  WHERE ven.biz_number IS NOT NULL AND btrim(ven.biz_number) <> ''
    AND ven.status = 'active'
),
grp AS (
  SELECT biz_number, COUNT(*) AS n FROM v GROUP BY biz_number HAVING COUNT(*) > 1
),
ranked AS (
  SELECT v.*, ROW_NUMBER() OVER (PARTITION BY v.biz_number ORDER BY v.refs DESC, v.created_at ASC) AS rn
  FROM v JOIN grp ON grp.biz_number = v.biz_number
)
SELECT biz_number                                    AS 사업자번호,
       MAX(name) FILTER (WHERE rn = 1)              AS 대표_이름,
       MAX(refs) FILTER (WHERE rn = 1)              AS 대표_참조,
       COUNT(*) - 1                                 AS 흡수_행수,
       SUM(refs) FILTER (WHERE rn > 1)              AS 흡수_참조합,
       string_agg(name || '(' || refs || ')', ' | ') FILTER (WHERE rn > 1) AS 흡수_행들,
       jsonb_agg(DISTINCT type)                     AS 유형들
FROM ranked
GROUP BY biz_number
ORDER BY COUNT(*) DESC, biz_number;

-- 요약 한 줄 (기대: 그룹수·흡수행수가 위 표와 일치)
WITH v AS (
  SELECT biz_number FROM vendors
  WHERE biz_number IS NOT NULL AND btrim(biz_number) <> '' AND status = 'active'
)
SELECT COUNT(*) AS 그룹수, SUM(n) - COUNT(*) AS 흡수될_행수
FROM (SELECT biz_number, COUNT(*) n FROM v GROUP BY biz_number HAVING COUNT(*) > 1) g;

-- ── STEP 2. 가드 — 흡수될 행이 '병합 불가' 상태인지 (전부 0이어야) ──
WITH v AS (
  SELECT id, biz_number, status FROM vendors
  WHERE biz_number IS NOT NULL AND btrim(biz_number) <> ''
),
grp AS (SELECT biz_number FROM v WHERE status = 'active' GROUP BY biz_number HAVING COUNT(*) > 1)
SELECT
  COUNT(*) FILTER (WHERE v.status = 'merged')  AS 이미병합됨,
  COUNT(*) FILTER (WHERE v.status = 'archived') AS 보관됨
FROM v JOIN grp ON grp.biz_number = v.biz_number;

-- ── STEP 3. 병합 실행 (STEP 1 승인 후) ───────────────────
DO $$
DECLARE
  r RECORD;
  v_keep UUID;
  v_moved JSONB;
  v_extra JSONB;
  v_groups INT := 0;
  v_merged INT := 0;
BEGIN
  FOR r IN
    WITH v AS (
      SELECT ven.id, ven.biz_number, ven.created_at,
             (SELECT COUNT(*) FROM transactions t WHERE t.vendor_id = ven.id)
           + (SELECT COUNT(*) FROM tax_invoices t WHERE t.vendor_id = ven.id)
           + (SELECT COUNT(*) FROM journal_lines t WHERE t.vendor_id = ven.id)
           + (SELECT COUNT(*) FROM erp_vendor_aliases t WHERE t.vendor_id = ven.id)
           + (SELECT COUNT(*) FROM contact_assignments t WHERE t.vendor_id = ven.id) AS refs
      FROM vendors ven
      WHERE ven.biz_number IS NOT NULL AND btrim(ven.biz_number) <> '' AND ven.status = 'active'
    ),
    grp AS (SELECT biz_number FROM v GROUP BY biz_number HAVING COUNT(*) > 1),
    ranked AS (
      SELECT v.id, v.biz_number,
             ROW_NUMBER() OVER (PARTITION BY v.biz_number ORDER BY v.refs DESC, v.created_at ASC) AS rn
      FROM v JOIN grp ON grp.biz_number = v.biz_number
    )
    SELECT biz_number,
           (array_agg(id ORDER BY rn))[1]                 AS keep_id,
           array_agg(id ORDER BY rn) FILTER (WHERE rn > 1) AS from_ids
    FROM ranked GROUP BY biz_number
  LOOP
    v_groups := v_groups + 1;
    v_keep := r.keep_id;
    FOR i IN 1 .. array_length(r.from_ids, 1) LOOP
      -- 055 RPC: 참조 재지정 + merged 상태 + 이력. 신규 테이블은 보강 함수로.
      v_extra := merge_vendor_extra_refs(r.from_ids[i], v_keep);
      v_moved := merge_vendor(r.from_ids[i], v_keep, 'migration-413');
      v_merged := v_merged + 1;
    END LOOP;
  END LOOP;
  RAISE NOTICE '병합 완료: 그룹 % 개, 흡수 % 행', v_groups, v_merged;
END $$;

-- ── STEP 4. 검증 (실행 후) ──────────────────────────────
-- 기대: 활성_같은사업자번호_그룹 0, 압구정_활성 1, 병합이력 = STEP 1의 흡수_행수
SELECT
  (SELECT COUNT(*) FROM (SELECT biz_number FROM vendors
      WHERE biz_number IS NOT NULL AND btrim(biz_number) <> '' AND status = 'active'
      GROUP BY biz_number HAVING COUNT(*) > 1) g)                                   AS 활성_같은사업자번호_그룹,
  (SELECT COUNT(*) FROM vendors WHERE name ~ '압구정금융센터' AND status = 'active') AS 압구정_활성,
  (SELECT COUNT(*) FROM vendor_merge_logs WHERE actor = 'migration-413')          AS 병합이력,
  (SELECT COUNT(*) FROM vendors v WHERE v.status = 'merged'
     AND EXISTS (SELECT 1 FROM transactions t WHERE t.vendor_id = v.id))          AS 병합행_잔류참조_통장,
  (SELECT COUNT(*) FROM vendors v WHERE v.status = 'merged'
     AND EXISTS (SELECT 1 FROM tax_invoices t WHERE t.vendor_id = v.id))          AS 병합행_잔류참조_계산서;
