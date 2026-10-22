-- =====================================================
-- 414_fix_refs_on_merged_vendors.sql  (회계 트랙 — 1회성 데이터 정리)
-- 병합된(merged) 거래처에 남아 있는 참조를 대표 거래처로 옮긴다 (2026-10-22)
--
-- 413 검증에서 병합행_잔류참조 통장 1 · 계산서 5 가 나왔다. 413의 merge_vendor는 병합 시점의
-- 참조를 전부 옮기므로, 남은 것은 (a) 413 이전에 화면에서 병합된 행에 남은 참조이거나
-- (b) 병합 **이후** 업로드가 병합된 거래처에 다시 붙인 참조다 — 계산서 업로드가 거래처
-- 목록을 상태 구분 없이 읽어 merged 행의 사업자번호에도 매칭했다(코드 수정: active만 + merged_into 추적).
-- 어느 쪽이든 정답은 같다: merged_into_id(대표)로 옮긴다. 대표가 또 병합됐으면 끝까지 따라간다.
-- =====================================================

-- ── STEP 1. 드라이런 (읽기 전용) ─────────────────────────
-- 1-a. 잔류 참조가 있는 병합 행 — 어디서 왔나
WITH RECURSIVE chain AS (
  SELECT id, merged_into_id, id AS root_from, 1 AS depth
  FROM vendors WHERE status = 'merged' AND merged_into_id IS NOT NULL
  UNION ALL
  SELECT v.id, v.merged_into_id, c.root_from, c.depth + 1
  FROM chain c JOIN vendors v ON v.id = c.merged_into_id
  WHERE v.status = 'merged' AND v.merged_into_id IS NOT NULL AND c.depth < 10
),
final AS (
  -- 각 병합 행의 최종 대표 (대표가 active인 지점)
  SELECT DISTINCT ON (root_from) root_from AS from_id, merged_into_id AS into_id
  FROM chain ORDER BY root_from, depth DESC
)
SELECT v.name                                          AS 병합행,
       v.id                                            AS 병합행_id,
       (SELECT name FROM vendors WHERE id = f.into_id) AS 대표,
       (SELECT status FROM vendors WHERE id = f.into_id) AS 대표상태,
       (SELECT COUNT(*) FROM transactions t WHERE t.vendor_id = v.id)  AS 통장,
       (SELECT COUNT(*) FROM tax_invoices t WHERE t.vendor_id = v.id)  AS 계산서,
       (SELECT COUNT(*) FROM journal_lines t WHERE t.vendor_id = v.id) AS 분개,
       (SELECT MAX(created_at) FROM tax_invoices t WHERE t.vendor_id = v.id) AS 계산서_마지막생성,
       (SELECT MAX(merged_at) FROM vendor_merge_logs l WHERE l.from_id = v.id) AS 병합시각,
       (SELECT MAX(actor) FROM vendor_merge_logs l WHERE l.from_id = v.id)     AS 병합자
FROM vendors v
JOIN final f ON f.from_id = v.id
WHERE EXISTS (SELECT 1 FROM transactions t WHERE t.vendor_id = v.id)
   OR EXISTS (SELECT 1 FROM tax_invoices t WHERE t.vendor_id = v.id)
   OR EXISTS (SELECT 1 FROM journal_lines t WHERE t.vendor_id = v.id)
ORDER BY 계산서 DESC, 통장 DESC;

-- 1-b. 대표를 못 찾는 병합 행 (merged인데 merged_into_id 없음) — 있으면 사람이 봐야 한다
SELECT COUNT(*) AS 대표없는_병합행
FROM vendors WHERE status = 'merged' AND merged_into_id IS NULL;

-- ── STEP 2. 재지정 (1-b가 0일 때) ────────────────────────
DO $$
DECLARE
  r RECORD;
  v_into UUID;
  v_hops INT;
  v_extra JSONB;
  n_tx INT; n_ti INT; n_jl INT; n_cs INT; n_cr INT; n_al INT; n_vl INT; n_ca INT;
  total INT := 0;
BEGIN
  FOR r IN SELECT id FROM vendors WHERE status = 'merged' AND merged_into_id IS NOT NULL LOOP
    -- 최종 대표까지 따라간다
    v_into := r.id; v_hops := 0;
    LOOP
      SELECT merged_into_id INTO v_into FROM vendors WHERE id = v_into;
      v_hops := v_hops + 1;
      EXIT WHEN v_into IS NULL
            OR (SELECT status FROM vendors WHERE id = v_into) <> 'merged'
            OR v_hops > 10;
    END LOOP;
    IF v_into IS NULL THEN CONTINUE; END IF;

    UPDATE transactions          SET vendor_id = v_into WHERE vendor_id = r.id; GET DIAGNOSTICS n_tx = ROW_COUNT;
    UPDATE journal_lines         SET vendor_id = v_into WHERE vendor_id = r.id; GET DIAGNOSTICS n_jl = ROW_COUNT;
    UPDATE tax_invoices          SET vendor_id = v_into WHERE vendor_id = r.id; GET DIAGNOSTICS n_ti = ROW_COUNT;
    UPDATE card_sales            SET vendor_id = v_into WHERE vendor_id = r.id; GET DIAGNOSTICS n_cs = ROW_COUNT;
    UPDATE cash_receipts         SET vendor_id = v_into WHERE vendor_id = r.id; GET DIAGNOSTICS n_cr = ROW_COUNT;
    UPDATE card_accounts         SET vendor_id = v_into WHERE vendor_id = r.id; GET DIAGNOSTICS n_ca = ROW_COUNT;
    UPDATE erp_vendor_aliases    SET vendor_id = v_into WHERE vendor_id = r.id; GET DIAGNOSTICS n_al = ROW_COUNT;
    UPDATE vendor_ledger_entries SET vendor_id = v_into WHERE vendor_id = r.id; GET DIAGNOSTICS n_vl = ROW_COUNT;
    v_extra := merge_vendor_extra_refs(r.id, v_into);   -- 413 보강 함수 (담당자·직원·일지·기초잔액·주문·발주)

    IF n_tx + n_jl + n_ti + n_cs + n_cr + n_ca + n_al + n_vl > 0 THEN
      total := total + 1;
      INSERT INTO vendor_merge_logs(actor, kind, from_id, from_name, into_id, into_name, moved_refs)
      SELECT 'migration-414', 'vendor', r.id, f.name, v_into, i.name,
             jsonb_build_object('transactions', n_tx, 'journal_lines', n_jl, 'tax_invoices', n_ti,
                                'card_sales', n_cs, 'cash_receipts', n_cr, 'card_accounts', n_ca,
                                'erp_vendor_aliases', n_al, 'vendor_ledger_entries', n_vl) || v_extra
      FROM vendors f, vendors i WHERE f.id = r.id AND i.id = v_into;
    END IF;
  END LOOP;
  RAISE NOTICE '잔류 참조 재지정: 병합 행 % 개', total;
END $$;

-- ── STEP 3. 검증 (실행 후) ──────────────────────────────
-- 기대: 전부 0
SELECT
  (SELECT COUNT(*) FROM transactions t JOIN vendors v ON v.id = t.vendor_id WHERE v.status = 'merged')  AS 통장,
  (SELECT COUNT(*) FROM tax_invoices t JOIN vendors v ON v.id = t.vendor_id WHERE v.status = 'merged')  AS 계산서,
  (SELECT COUNT(*) FROM journal_lines t JOIN vendors v ON v.id = t.vendor_id WHERE v.status = 'merged') AS 분개,
  (SELECT COUNT(*) FROM erp_vendor_aliases t JOIN vendors v ON v.id = t.vendor_id WHERE v.status = 'merged') AS 별칭,
  (SELECT COUNT(*) FROM contact_assignments t JOIN vendors v ON v.id = t.vendor_id WHERE v.status = 'merged') AS 담당자배정;
