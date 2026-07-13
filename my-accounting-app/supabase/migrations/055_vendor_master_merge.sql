-- =====================================================
-- 055_vendor_master_merge.sql
-- 거래처 마스터 Phase 1: 상태 체계 + 병합(이력 필수) 토대.
-- 정책: docs/vendor-master-policy.md (v1.1)
--   · 자동 병합 금지 — RPC는 사용자 승인 후에만 호출된다
--   · 흡수 행은 삭제하지 않고 merged 상태로 보존 (복구 대비)
--   · 병합 이력(누가/언제/무엇을/참조 몇 건) 필수 기록
--   · 흡수된 이름은 대표의 별칭이 되어 이후 자동 인식(학습)
-- =====================================================

-- ── 1) 거래처 상태 체계 ──────────────────────────────
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','inactive','merged','archived')),
  ADD COLUMN IF NOT EXISTS merged_into_id UUID REFERENCES vendors(id) ON DELETE SET NULL;

UPDATE vendors SET status = CASE WHEN is_active THEN 'active' ELSE 'inactive' END
 WHERE status = 'active' AND is_active = false;

-- ── 2) ERP 별칭 병합 포인터 (변형 이름 학습) ─────────
ALTER TABLE erp_vendor_aliases
  ADD COLUMN IF NOT EXISTS merged_into_alias_id UUID REFERENCES erp_vendor_aliases(id) ON DELETE SET NULL;

-- ── 3) 병합 이력 ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendor_merge_logs (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  merged_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor      TEXT,                          -- 수행자 (로그인 이메일 등)
  kind       TEXT        NOT NULL CHECK (kind IN ('vendor','erp_alias')),
  from_id    UUID        NOT NULL,          -- 흡수된 쪽
  from_name  TEXT        NOT NULL,
  into_id    UUID        NOT NULL,          -- 대표
  into_name  TEXT        NOT NULL,
  moved_refs JSONB       NOT NULL DEFAULT '{}'::jsonb   -- 테이블별 이전 건수 (복구 근거)
);

-- ── 4) ERP 별칭 병합 RPC ─────────────────────────────
-- 주문·품목·선결제의 별칭 참조를 대표로 이전하고, 흡수 별칭은 포인터로 보존.
CREATE OR REPLACE FUNCTION merge_erp_alias(p_from UUID, p_into UUID, p_actor TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_from erp_vendor_aliases%ROWTYPE;
  v_into erp_vendor_aliases%ROWTYPE;
  n_orders INT; n_items INT; n_prepay INT;
  refs JSONB;
BEGIN
  IF p_from = p_into THEN RAISE EXCEPTION '같은 별칭입니다'; END IF;
  SELECT * INTO v_from FROM erp_vendor_aliases WHERE id = p_from;
  SELECT * INTO v_into FROM erp_vendor_aliases WHERE id = p_into;
  IF v_from.id IS NULL OR v_into.id IS NULL THEN RAISE EXCEPTION '별칭을 찾을 수 없습니다'; END IF;
  IF v_from.alias_type <> v_into.alias_type THEN RAISE EXCEPTION '별칭 유형이 다릅니다(매출처/매입처)'; END IF;
  IF v_into.merged_into_alias_id IS NOT NULL THEN RAISE EXCEPTION '대표가 이미 병합된 별칭입니다'; END IF;

  UPDATE erp_orders      SET customer_alias_id = p_into WHERE customer_alias_id = p_from;
  GET DIAGNOSTICS n_orders = ROW_COUNT;
  UPDATE erp_order_items SET purchase_alias_id = p_into WHERE purchase_alias_id = p_from;
  GET DIAGNOSTICS n_items = ROW_COUNT;
  UPDATE erp_prepayments SET alias_id = p_into WHERE alias_id = p_from;
  GET DIAGNOSTICS n_prepay = ROW_COUNT;

  -- 흡수 별칭 보존 + 포인터 (이후 임포트에서 같은 이름이 오면 대표로 자동 연결)
  UPDATE erp_vendor_aliases SET merged_into_alias_id = p_into, vendor_id = v_into.vendor_id
   WHERE id = p_from;

  refs := jsonb_build_object('erp_orders', n_orders, 'erp_order_items', n_items, 'erp_prepayments', n_prepay);
  INSERT INTO vendor_merge_logs(actor, kind, from_id, from_name, into_id, into_name, moved_refs)
  VALUES (p_actor, 'erp_alias', p_from, v_from.erp_name, p_into, v_into.erp_name, refs);
  RETURN refs;
END;
$$;

-- ── 5) 거래처(vendors) 병합 RPC ──────────────────────
CREATE OR REPLACE FUNCTION merge_vendor(p_from UUID, p_into UUID, p_actor TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_from vendors%ROWTYPE;
  v_into vendors%ROWTYPE;
  n_tx INT; n_jl INT; n_ti INT; n_cs INT; n_cr INT; n_ca INT; n_al INT; n_vl INT;
  v_ob_from BIGINT; refs JSONB;
BEGIN
  IF p_from = p_into THEN RAISE EXCEPTION '같은 거래처입니다'; END IF;
  SELECT * INTO v_from FROM vendors WHERE id = p_from;
  SELECT * INTO v_into FROM vendors WHERE id = p_into;
  IF v_from.id IS NULL OR v_into.id IS NULL THEN RAISE EXCEPTION '거래처를 찾을 수 없습니다'; END IF;
  IF v_into.status <> 'active' THEN RAISE EXCEPTION '대표 거래처가 active 상태가 아닙니다'; END IF;
  IF v_from.status = 'merged' THEN RAISE EXCEPTION '이미 병합된 거래처입니다'; END IF;

  UPDATE transactions        SET vendor_id = p_into WHERE vendor_id = p_from;  GET DIAGNOSTICS n_tx = ROW_COUNT;
  UPDATE journal_lines       SET vendor_id = p_into WHERE vendor_id = p_from;  GET DIAGNOSTICS n_jl = ROW_COUNT;
  UPDATE tax_invoices        SET vendor_id = p_into WHERE vendor_id = p_from;  GET DIAGNOSTICS n_ti = ROW_COUNT;
  UPDATE card_sales          SET vendor_id = p_into WHERE vendor_id = p_from;  GET DIAGNOSTICS n_cs = ROW_COUNT;
  UPDATE cash_receipts       SET vendor_id = p_into WHERE vendor_id = p_from;  GET DIAGNOSTICS n_cr = ROW_COUNT;
  UPDATE card_accounts       SET vendor_id = p_into WHERE vendor_id = p_from;  GET DIAGNOSTICS n_ca = ROW_COUNT;
  UPDATE erp_vendor_aliases  SET vendor_id = p_into WHERE vendor_id = p_from;  GET DIAGNOSTICS n_al = ROW_COUNT;
  UPDATE vendor_ledger_entries SET vendor_id = p_into WHERE vendor_id = p_from; GET DIAGNOSTICS n_vl = ROW_COUNT;

  -- 기초잔액(vendor_id PK): from 잔액을 into에 합산 후 from 행 제거
  SELECT amount INTO v_ob_from FROM vendor_opening_balances WHERE vendor_id = p_from;
  IF v_ob_from IS NOT NULL THEN
    INSERT INTO vendor_opening_balances(vendor_id, amount)
    VALUES (p_into, v_ob_from)
    ON CONFLICT (vendor_id) DO UPDATE SET amount = vendor_opening_balances.amount + EXCLUDED.amount;
    DELETE FROM vendor_opening_balances WHERE vendor_id = p_from;
  END IF;

  -- 흡수: 이름/별칭/카드번호를 대표의 별칭으로 (중복 제거, 학습)
  UPDATE vendors SET
    match_aliases = (
      SELECT COALESCE(array_agg(DISTINCT a), '{}')
      FROM unnest(COALESCE(v_into.match_aliases,'{}') || COALESCE(v_from.match_aliases,'{}') || ARRAY[v_from.name]) AS a
      WHERE a IS NOT NULL AND a <> '' AND a <> v_into.name
    ),
    card_numbers = (
      SELECT COALESCE(array_agg(DISTINCT c), '{}')
      FROM unnest(COALESCE(v_into.card_numbers,'{}') || COALESCE(v_from.card_numbers,'{}')) AS c
      WHERE c IS NOT NULL AND c <> ''
    ),
    biz_number = COALESCE(v_into.biz_number, v_from.biz_number),
    is_card_company = v_into.is_card_company OR v_from.is_card_company
  WHERE id = p_into;

  UPDATE vendors SET status = 'merged', merged_into_id = p_into, is_active = false WHERE id = p_from;

  refs := jsonb_build_object(
    'transactions', n_tx, 'journal_lines', n_jl, 'tax_invoices', n_ti,
    'card_sales', n_cs, 'cash_receipts', n_cr, 'card_accounts', n_ca,
    'erp_vendor_aliases', n_al, 'vendor_ledger_entries', n_vl,
    'opening_balance_moved', COALESCE(v_ob_from, 0));
  INSERT INTO vendor_merge_logs(actor, kind, from_id, from_name, into_id, into_name, moved_refs)
  VALUES (p_actor, 'vendor', p_from, v_from.name, p_into, v_into.name, refs);
  RETURN refs;
END;
$$;
