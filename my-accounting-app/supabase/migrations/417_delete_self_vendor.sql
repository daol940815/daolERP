-- =====================================================
-- 417_delete_self_vendor.sql  (회계 트랙 — 1회성 데이터 정리)
-- 자사 거래처('주식회사 다올커머스' 701-88-00023 · '다올커머스') 삭제 (2026-10-23 사용자 지시)
--
-- 배경: 2026-06-29·07-20 계산서 업로드 방향 뒤집힘의 부산물로 우리 회사가 거래처로 생성됐고
--   (뒤집힌 계산서 38건은 411에서 삭제), 매입처 목록에 미지급 잔액 476,501,197로 남아 있다.
-- 원칙: 우리 회사는 거래처가 아니다. 자사 거래처에 붙은 참조는 전부 잘못 붙은 것이므로
--   원본은 남기고 연결만 푼다(vendor_id → NULL). 삭제로 함께 지워지는(CASCADE) 표는
--   사람이 만든 기록이 아닌지 드라이런에서 확인하고, 있으면 중단한다.
--
-- vendors(id) 외래키 동작
--   SET NULL: tax_invoices · transactions · journal_lines · cash_receipts · card_sales · card_accounts ·
--             erp_vendor_aliases · erp_orders · erp_purchase_orders · erp_consultations ·
--             contact_activities · contact_review_events · vendors.merged_into_id
--   CASCADE : purchase_opening_balances(기초 미지급) · vendor_opening_balances(원장 이월) ·
--             vendor_ledger_entries(원장) · purchase_cycle_reviews · vendor_staff · contact_assignments
-- =====================================================

-- ── STEP 1. 드라이런 (읽기 전용) ─────────────────────────
-- 1-a. 대상 거래처
SELECT id, name, biz_number, type, status, purchase_kind, created_at
FROM vendors
WHERE biz_number = '701-88-00023'
   OR regexp_replace(name, '[\s（）()주식회사]', '', 'g') = '다올커머스'
ORDER BY created_at;

-- 1-b. 참조 건수 — SET NULL 표(연결만 풀림) / CASCADE 표(행이 지워짐 — 0이 아니면 중단)
WITH s AS (
  SELECT id FROM vendors
  WHERE biz_number = '701-88-00023'
     OR regexp_replace(name, '[\s（）()주식회사]', '', 'g') = '다올커머스'
)
SELECT
  -- 연결만 풀리는 표
  (SELECT COUNT(*) FROM tax_invoices t WHERE t.vendor_id IN (SELECT id FROM s))                       AS 계산서,
  (SELECT COALESCE(SUM(total_amount), 0) FROM tax_invoices t WHERE t.vendor_id IN (SELECT id FROM s)
     AND t.direction = 'purchase')                                                                    AS 매입계산서_합계,
  (SELECT COUNT(*) FROM transactions t WHERE t.vendor_id IN (SELECT id FROM s))                       AS 통장,
  (SELECT COUNT(*) FROM journal_lines j WHERE j.vendor_id IN (SELECT id FROM s))                      AS 분개라인,
  (SELECT COUNT(*) FROM cash_receipts c WHERE c.vendor_id IN (SELECT id FROM s))                      AS 현금영수증,
  (SELECT COUNT(*) FROM card_sales c WHERE c.vendor_id IN (SELECT id FROM s))                         AS 카드매출,
  (SELECT COUNT(*) FROM card_accounts c WHERE c.vendor_id IN (SELECT id FROM s))                      AS 카드사,
  (SELECT COUNT(*) FROM erp_vendor_aliases a WHERE a.vendor_id IN (SELECT id FROM s))                 AS 별칭,
  (SELECT COUNT(*) FROM erp_orders o WHERE o.vendor_id IN (SELECT id FROM s))                         AS direct주문,
  (SELECT COUNT(*) FROM vendors v WHERE v.merged_into_id IN (SELECT id FROM s))                       AS 병합참조,
  -- 함께 지워지는 표 (0이어야 진행)
  (SELECT COUNT(*) FROM purchase_opening_balances b WHERE b.vendor_id IN (SELECT id FROM s))          AS 기초미지급_행,
  (SELECT COALESCE(SUM(amount), 0) FROM purchase_opening_balances b WHERE b.vendor_id IN (SELECT id FROM s)) AS 기초미지급_금액,
  (SELECT COUNT(*) FROM vendor_opening_balances b WHERE b.vendor_id IN (SELECT id FROM s))            AS 원장이월_행,
  (SELECT COUNT(*) FROM vendor_ledger_entries e WHERE e.vendor_id IN (SELECT id FROM s))              AS 원장항목,
  (SELECT COUNT(*) FROM purchase_cycle_reviews r WHERE r.vendor_id IN (SELECT id FROM s))             AS 매입검토,
  (SELECT COUNT(*) FROM vendor_staff vs WHERE vs.vendor_id IN (SELECT id FROM s))                     AS 담당직원,
  (SELECT COUNT(*) FROM contact_assignments ca WHERE ca.vendor_id IN (SELECT id FROM s))              AS 담당자배정;

-- 1-c. 매입처 허브가 보는 값 (삭제 전 기록용)
SELECT v.name, h.invoice_count, h.invoice_total, h.paid_amount, h.outstanding, h.opening_remain
FROM hub_purchase_summary(NULL, NULL) h JOIN vendors v ON v.id = h.vendor_id
WHERE v.biz_number = '701-88-00023'
   OR regexp_replace(v.name, '[\s（）()주식회사]', '', 'g') = '다올커머스';

-- ── STEP 2. 삭제 ───────────────────────────────────────
-- 기초 미지급(purchase_opening_balances)·원장 이월은 자사에 있을 수 없는 값이므로 함께 지운다.
-- 1차 실행(2026-10-26)은 "사람이 만든 기록 227건"으로 중단 → 분해(checks/self_vendor_blockers_check.sql):
--   · 정산 원장 payment 226건 846,996,499 — 전부 통장 연결, 2025-01-07~2026-06-29, 07-09 00:50~07-10 02:33 일괄 등록.
--     적요 '주식회사다올커머스'인 자사 계좌 간 이체 출금이 이름 매칭으로 자사 거래처에 붙고, 그 출금이
--     "지급"으로 등록된 것 → 잘못된 연결의 파생물이므로 함께 지운다(통장 원본은 남는다).
--   · 담당자 배정 1건 — 김보현 주임(자사 직원)이 고객사 인물로 자사에 배정. 배정은 함께 지우고,
--     인물 행은 다른 배정·영업일지가 없으면 지운다(자사 직원은 contacts 대상이 아님).
--   · 매입 검토·담당 직원 0.
-- 가드(수정): 정산 원장에 opening/adjustment(손으로 넣은 값)·통장 미연결 payment가 있거나,
--   매입 검토·담당 직원이 있으면 중단. 담당자 배정은 인물 이름이 직원 이름과 같을 때만 통과.
DO $$
DECLARE
  v_ids   uuid[];
  v_n     int;
  v_bad   int;
  v_inv   int; v_tx int; v_jl int; v_alias int; v_pob int; v_pob_amt bigint;
  v_led   int; v_led_amt bigint;
  v_ca    int; v_ca_names text;
  v_contact_del int := 0;
  v_hub_inv bigint; v_hub_out bigint;
BEGIN
  SELECT array_agg(id) INTO v_ids FROM vendors
   WHERE biz_number = '701-88-00023'
      OR regexp_replace(name, '[\s（）()주식회사]', '', 'g') = '다올커머스';
  v_n := COALESCE(array_length(v_ids, 1), 0);
  IF v_n = 0 THEN RAISE NOTICE '자사 거래처 없음 — 할 일 없음'; RETURN; END IF;
  IF v_n > 3 THEN RAISE EXCEPTION '대상이 %건 — 이름 조건이 넓다. 점검 후 다시', v_n; END IF;

  -- 가드 1: 매입 검토·담당 직원 (사람 기록) — 있으면 중단
  SELECT (SELECT COUNT(*) FROM purchase_cycle_reviews WHERE vendor_id = ANY(v_ids))
       + (SELECT COUNT(*) FROM vendor_staff           WHERE vendor_id = ANY(v_ids))
    INTO v_bad;
  IF v_bad > 0 THEN RAISE EXCEPTION '매입 검토·담당 직원 % 건이 자사 거래처에 붙어 있음 — 중단', v_bad; END IF;

  -- 가드 2: 정산 원장 — 손으로 넣은 기초/조정, 통장 미연결 입금이 있으면 중단
  SELECT COUNT(*) INTO v_bad FROM vendor_ledger_entries
   WHERE vendor_id = ANY(v_ids) AND (entry_type <> 'payment' OR transaction_id IS NULL);
  IF v_bad > 0 THEN RAISE EXCEPTION '정산 원장에 손으로 넣은 기초/조정 또는 통장 미연결 입금 % 건 — 중단', v_bad; END IF;
  SELECT COUNT(*), COALESCE(SUM(amount), 0) INTO v_led, v_led_amt
    FROM vendor_ledger_entries WHERE vendor_id = ANY(v_ids);

  -- 가드 3: 담당자 배정 — 인물이 자사 직원 이름이 아니면 중단(진짜 고객사 인물일 수 있다)
  SELECT COUNT(*), string_agg(c.name, ', ') INTO v_ca, v_ca_names
    FROM contact_assignments ca JOIN contacts c ON c.id = ca.contact_id
   WHERE ca.vendor_id = ANY(v_ids);
  IF EXISTS (
    SELECT 1 FROM contact_assignments ca JOIN contacts c ON c.id = ca.contact_id
     WHERE ca.vendor_id = ANY(v_ids)
       AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.name = c.name)
  ) THEN
    RAISE EXCEPTION '자사 거래처의 담당자 배정에 직원이 아닌 인물이 있음(%) — 중단', v_ca_names;
  END IF;

  -- 삭제 전 허브 값 기록 (476,501,197의 출처 확인용)
  SELECT COALESCE(SUM(h.invoice_total), 0), COALESCE(SUM(h.outstanding), 0) INTO v_hub_inv, v_hub_out
    FROM hub_purchase_summary(NULL, NULL) h WHERE h.vendor_id = ANY(v_ids);

  SELECT COUNT(*) INTO v_inv   FROM tax_invoices       WHERE vendor_id = ANY(v_ids);
  SELECT COUNT(*) INTO v_tx    FROM transactions       WHERE vendor_id = ANY(v_ids);
  SELECT COUNT(*) INTO v_jl    FROM journal_lines      WHERE vendor_id = ANY(v_ids);
  SELECT COUNT(*) INTO v_alias FROM erp_vendor_aliases WHERE vendor_id = ANY(v_ids);
  SELECT COUNT(*), COALESCE(SUM(amount), 0) INTO v_pob, v_pob_amt
    FROM purchase_opening_balances WHERE vendor_id = ANY(v_ids);

  -- 자사 직원이 고객사 인물로 들어간 행: 배정은 CASCADE로 지워지고, 다른 배정·영업일지가 없으면 인물도 지운다
  WITH victims AS (
    SELECT DISTINCT c.id FROM contact_assignments ca JOIN contacts c ON c.id = ca.contact_id
     WHERE ca.vendor_id = ANY(v_ids)
       AND NOT EXISTS (SELECT 1 FROM contact_assignments o WHERE o.contact_id = c.id AND NOT (o.vendor_id = ANY(v_ids)))
       AND NOT EXISTS (SELECT 1 FROM contact_activities a WHERE a.contact_id = c.id)
  ), del AS (
    DELETE FROM contacts WHERE id IN (SELECT id FROM victims) RETURNING id
  ) SELECT COUNT(*) INTO v_contact_del FROM del;

  -- 연결 풀기는 외래키 SET NULL이 하지만, 건수를 남기기 위해 명시적으로 푼다
  UPDATE tax_invoices       SET vendor_id = NULL WHERE vendor_id = ANY(v_ids);
  UPDATE transactions       SET vendor_id = NULL WHERE vendor_id = ANY(v_ids);
  UPDATE journal_lines      SET vendor_id = NULL WHERE vendor_id = ANY(v_ids);
  UPDATE erp_vendor_aliases SET vendor_id = NULL WHERE vendor_id = ANY(v_ids);
  UPDATE vendors            SET merged_into_id = NULL WHERE merged_into_id = ANY(v_ids);

  DELETE FROM vendors WHERE id = ANY(v_ids);

  RAISE NOTICE '자사 거래처 % 건 삭제 — 삭제 전 허브: 계산서총액 % · 미지급잔액 % / 연결 해제: 계산서 % · 통장 % · 분개라인 % · 별칭 % / 함께 삭제: 기초미지급 % 행 % 원 · 정산원장 입금 % 건 % 원 · 담당자배정 % 건(%) · 인물 % 건',
    v_n, v_hub_inv, v_hub_out, v_inv, v_tx, v_jl, v_alias, v_pob, v_pob_amt, v_led, v_led_amt, v_ca, COALESCE(v_ca_names, '-'), v_contact_del;
END $$;

-- ── STEP 3. 검증 (실행 후) ──────────────────────────────
-- 기대: 자사거래처 0 · 허브_자사행 0. 미연결_매입계산서가 늘었으면 계산서 내역에서 '거래처 자동 매칭'으로 다시 붙인다.
SELECT
  (SELECT COUNT(*) FROM vendors WHERE biz_number = '701-88-00023'
      OR regexp_replace(name, '[\s（）()주식회사]', '', 'g') = '다올커머스')                     AS 자사거래처,
  (SELECT COUNT(*) FROM hub_purchase_summary(NULL, NULL) h JOIN vendors v ON v.id = h.vendor_id
    WHERE v.biz_number = '701-88-00023')                                                          AS 허브_자사행,
  (SELECT COUNT(*) FROM tax_invoices WHERE vendor_id IS NULL AND direction = 'purchase')           AS 미연결_매입계산서,
  (SELECT COUNT(*) FROM tax_invoices WHERE vendor_id IS NULL AND direction = 'sales')              AS 미연결_매출계산서,
  (SELECT COALESCE(SUM(GREATEST(0, outstanding)), 0) FROM hub_purchase_summary(NULL, NULL))        AS 허브_미지급_합계;
