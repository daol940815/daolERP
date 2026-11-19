-- =====================================================
-- 119_vendor_merge_undo.sql
-- 매출처 병합 취소 — 사용자 승인 2026-11-18 ("진행해줘")
--
-- 배경: 합치기(055 merge_vendor + 413 merge_vendor_extra_refs + 앱의 고객 쪽 이전)는 건수만 남기고
--   "어느 건이 원래 어느 쪽 것이었는지"를 남기지 않아, 잘못 합치면 되돌릴 근거가 없었다.
-- 방식: 합치기 직전에 흡수되는 쪽의 건별 목록(표별 id)과 합산 · 정리 전 값을 한 줄로 저장해 두고(스냅샷),
--   취소할 때 그 목록에 있는 건만 원래 매출처로 돌려보낸다.
--   - 합친 뒤 남는 쪽에 새로 들어온 건은 남는 쪽에 그대로 둔다.
--   - 합친 뒤 다른 곳으로 옮겨졌거나 지워진 건은 건드리지 않는다(건수로 알려 준다).
--   - 원본 행의 내용은 고치지 않는다 — 매출처 연결(vendor_id)과 병합 때 바뀐 표시만 되돌린다.
-- 대상 아님: 이 마이그레이션 이전의 병합(건별 기록 없음), 합치면서 같이 한 담당자(인물) 병합.
-- 화면: 매출처 상세 › 병합 이력 › 병합 취소. 호출: lib/vendor-merge.ts
-- =====================================================

-- ── 1) 병합 직전 기록 ─────────────────────────────────
CREATE TABLE IF NOT EXISTS vendor_merge_snapshots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id      UUID NOT NULL,                 -- 흡수된 쪽
  from_name    TEXT NOT NULL,
  into_id      UUID NOT NULL,                 -- 남은 쪽
  into_name    TEXT NOT NULL,
  actor        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,                   -- 병합이 끝까지 성공한 시각 (NULL = 도중 실패)
  log_id       UUID,                          -- vendor_merge_logs.id
  snapshot     JSONB NOT NULL,                -- rows{표: [id]} · from/into 행 · 배정 · 지점 담당 · 기초잔액 · 청구처 소속
  undone_at    TIMESTAMPTZ,
  undone_by    TEXT,
  undo_result  JSONB
);
CREATE INDEX IF NOT EXISTS idx_vms_into ON vendor_merge_snapshots(into_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vms_from ON vendor_merge_snapshots(from_id, created_at DESC);
ALTER TABLE vendor_merge_snapshots ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE vendor_merge_snapshots IS
  '매출처 병합 직전 기록 (119) — 병합 취소의 근거. 건별 id 목록과 합산 · 정리 전 값.';

-- 병합이 매출처 연결(vendor_id)을 옮기는 표 (055 · 413 · lib/vendor-merge.ts 와 같아야 한다)
CREATE OR REPLACE FUNCTION vendor_merge_ref_tables() RETURNS TEXT[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'transactions', 'journal_lines', 'tax_invoices', 'card_sales', 'cash_receipts', 'card_accounts',
    'erp_vendor_aliases', 'vendor_ledger_entries',
    'contact_assignments', 'vendor_staff', 'contact_activities',
    'erp_purchase_orders', 'purchase_cycle_reviews', 'erp_orders',
    'contact_name_links', 'doc_sales_snapshot', 'erp_consultations', 'contact_review_events'
  ]
$$;

CREATE OR REPLACE FUNCTION vms_text_array(j JSONB) RETURNS TEXT[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(j) = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(j)) ELSE '{}'::text[] END
$$;

-- ── 2) 합치기 직전에 부른다 ───────────────────────────
CREATE OR REPLACE FUNCTION vendor_merge_snapshot(p_from UUID, p_into UUID, p_actor TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  v_from vendors%ROWTYPE;
  v_into vendors%ROWTYPE;
  t TEXT; ids JSONB; v_rows JSONB := '{}'::jsonb; v_id UUID;
BEGIN
  IF p_from = p_into THEN RAISE EXCEPTION '같은 거래처입니다'; END IF;
  SELECT * INTO v_from FROM vendors WHERE id = p_from;
  SELECT * INTO v_into FROM vendors WHERE id = p_into;
  IF v_from.id IS NULL OR v_into.id IS NULL THEN RAISE EXCEPTION '거래처를 찾을 수 없습니다'; END IF;
  IF v_from.status = 'merged' THEN RAISE EXCEPTION '이미 병합된 거래처입니다'; END IF;

  FOREACH t IN ARRAY vendor_merge_ref_tables() LOOP
    IF (SELECT COUNT(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = t AND column_name IN ('id', 'vendor_id')) = 2 THEN
      EXECUTE format('SELECT COALESCE(jsonb_agg(id), ''[]''::jsonb) FROM %I WHERE vendor_id = $1', t) INTO ids USING p_from;
      IF jsonb_array_length(ids) > 0 THEN v_rows := v_rows || jsonb_build_object(t, ids); END IF;
    END IF;
  END LOOP;

  INSERT INTO vendor_merge_snapshots (from_id, from_name, into_id, into_name, actor, snapshot)
  VALUES (p_from, v_from.name, p_into, v_into.name, p_actor, jsonb_build_object(
    'version', 1,
    'from', to_jsonb(v_from),
    'into', to_jsonb(v_into),
    'rows', v_rows,
    'assignments', COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM contact_assignments a WHERE a.vendor_id = p_from), '[]'::jsonb),
    'staff', COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM vendor_staff a WHERE a.vendor_id = p_from), '[]'::jsonb),
    -- 같은 직원이 양쪽에 다 있어 병합 때 흡수 쪽 줄이 지워지는 지점 담당
    'staff_dup_ids', COALESCE((SELECT jsonb_agg(a.id) FROM vendor_staff a WHERE a.vendor_id = p_from
        AND EXISTS (SELECT 1 FROM vendor_staff b WHERE b.vendor_id = p_into AND b.employee_id = a.employee_id)), '[]'::jsonb),
    'billing_children', COALESCE((SELECT jsonb_agg(v.id) FROM vendors v WHERE v.billing_vendor_id = p_from), '[]'::jsonb),
    'opening_from', (SELECT to_jsonb(o) FROM vendor_opening_balances o WHERE o.vendor_id = p_from),
    'opening_into', (SELECT to_jsonb(o) FROM vendor_opening_balances o WHERE o.vendor_id = p_into),
    'purchase_opening_from', (SELECT to_jsonb(o) FROM purchase_opening_balances o WHERE o.vendor_id = p_from),
    'purchase_opening_into', (SELECT to_jsonb(o) FROM purchase_opening_balances o WHERE o.vendor_id = p_into)
  ))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ── 3) 취소를 막는 이유 (미리보기 · 실행 공용) ────────
CREATE OR REPLACE FUNCTION unmerge_vendor_blockers(p_snapshot UUID) RETURNS TEXT[]
LANGUAGE plpgsql STABLE AS $$
DECLARE
  s vendor_merge_snapshots%ROWTYPE;
  v_from vendors%ROWTYPE;
  v_into vendors%ROWTYPE;
  b TEXT[] := '{}'::text[];
BEGIN
  SELECT * INTO s FROM vendor_merge_snapshots WHERE id = p_snapshot;
  IF s.id IS NULL THEN RETURN ARRAY['병합 기록을 찾을 수 없습니다.']; END IF;
  IF s.undone_at IS NOT NULL THEN b := array_append(b, '이미 취소된 병합입니다.'); END IF;
  SELECT * INTO v_from FROM vendors WHERE id = s.from_id;
  SELECT * INTO v_into FROM vendors WHERE id = s.into_id;
  IF v_from.id IS NULL THEN
    b := array_append(b, '흡수된 매출처 기록이 삭제되어 되살릴 수 없습니다.');
  ELSIF v_from.status = 'merged' AND v_from.merged_into_id IS DISTINCT FROM s.into_id THEN
    b := array_append(b, '흡수된 매출처가 지금은 다른 매출처에 병합되어 있습니다.');
  ELSIF v_from.status <> 'merged' AND s.completed_at IS NOT NULL THEN
    b := array_append(b, '흡수된 매출처가 이미 병합 상태가 아닙니다(다른 경로로 되살려짐).');
  END IF;
  IF v_into.id IS NULL THEN
    b := array_append(b, '남은 매출처 기록이 삭제되었습니다.');
  ELSIF v_into.status = 'merged' THEN
    b := array_append(b, '남은 매출처가 그 뒤 다른 매출처에 병합되었습니다 — 그 병합을 먼저 취소하세요.');
  END IF;
  RETURN b;
END;
$$;

-- ── 4) 취소 미리보기 (읽기 전용) ──────────────────────
CREATE OR REPLACE FUNCTION unmerge_vendor_preview(p_snapshot UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE AS $$
DECLARE
  s vendor_merge_snapshots%ROWTYPE;
  snap JSONB; t TEXT; typ TEXT; n INT;
  v_tables JSONB := '{}'::jsonb;
  v_added TEXT[];
BEGIN
  SELECT * INTO s FROM vendor_merge_snapshots WHERE id = p_snapshot;
  IF s.id IS NULL THEN RETURN jsonb_build_object('blockers', jsonb_build_array('병합 기록을 찾을 수 없습니다.')); END IF;
  snap := s.snapshot;
  FOREACH t IN ARRAY vendor_merge_ref_tables() LOOP
    CONTINUE WHEN NOT (snap->'rows') ? t;
    SELECT udt_name INTO typ FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = t AND column_name = 'id';
    CONTINUE WHEN typ IS NULL OR typ NOT IN ('uuid', 'int4', 'int8', 'text');
    EXECUTE format('SELECT COUNT(*)::int FROM %I WHERE vendor_id = $1 AND id = ANY (ARRAY(SELECT jsonb_array_elements_text($2))::%s[])', t, typ)
      INTO n USING s.into_id, snap->'rows'->t;
    v_tables := v_tables || jsonb_build_object(t, jsonb_build_object('total', jsonb_array_length(snap->'rows'->t), 'back', n));
  END LOOP;
  v_added := ARRAY(SELECT a FROM unnest(vms_text_array(snap->'from'->'match_aliases') || ARRAY[snap->'from'->>'name']) a
                    WHERE a IS NOT NULL AND a <> '' AND a <> ALL (vms_text_array(snap->'into'->'match_aliases')));
  RETURN jsonb_build_object(
    'snapshot_id', s.id, 'from_id', s.from_id, 'from_name', s.from_name, 'into_id', s.into_id, 'into_name', s.into_name,
    'actor', s.actor, 'created_at', s.created_at, 'undone_at', s.undone_at,
    'blockers', to_jsonb(unmerge_vendor_blockers(p_snapshot)),
    'tables', v_tables,
    'staff_restore', (SELECT COUNT(*) FROM jsonb_array_elements_text(snap->'staff_dup_ids') d
                       WHERE NOT EXISTS (SELECT 1 FROM vendor_staff x WHERE x.id = d::uuid)),
    'aliases_remove', to_jsonb(ARRAY(SELECT a FROM unnest(v_added) a
                       WHERE a = ANY (COALESCE((SELECT match_aliases FROM vendors WHERE id = s.into_id), '{}'::text[])))),
    'opening_from', snap->'opening_from'->'amount',
    'purchase_opening_from', snap->'purchase_opening_from'->'amount',
    'billing_children', jsonb_array_length(snap->'billing_children')
  );
END;
$$;

-- ── 5) 병합 취소 ──────────────────────────────────────
CREATE OR REPLACE FUNCTION unmerge_vendor(p_snapshot UUID, p_actor TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  s vendor_merge_snapshots%ROWTYPE;
  snap JSONB; f JSONB; i JSONB;
  v_blk TEXT[]; t TEXT; typ TEXT; n INT;
  v_tables JSONB := '{}'::jsonb; res JSONB;
  c_from UUID; v_amt NUMERIC; v_added TEXT[]; v_cards TEXT[];
  n_staff INT := 0; n_alias INT := 0; n_mis INT := 0;
BEGIN
  SELECT * INTO s FROM vendor_merge_snapshots WHERE id = p_snapshot FOR UPDATE;
  v_blk := unmerge_vendor_blockers(p_snapshot);
  IF COALESCE(array_length(v_blk, 1), 0) > 0 THEN RAISE EXCEPTION '%', array_to_string(v_blk, ' '); END IF;
  snap := s.snapshot; f := snap->'from'; i := snap->'into';

  -- (1) 개인 고객(115) 연결: 남은 쪽이 이어받았으면 내려놓는다 (유니크 uq_vendors_individual_contact)
  c_from := NULLIF(f->>'individual_contact_id', '')::uuid;
  IF c_from IS NOT NULL AND NULLIF(i->>'individual_contact_id', '') IS NULL THEN
    UPDATE vendors SET individual_contact_id = NULL WHERE id = s.into_id AND individual_contact_id = c_from;
  END IF;

  -- (2) 흡수된 매출처 되살리기 (병합 직전 상태로)
  UPDATE vendors
     SET status = COALESCE(NULLIF(f->>'status', ''), 'active'),
         merged_into_id = NULL,
         is_active = COALESCE((f->>'is_active')::boolean, true)
   WHERE id = s.from_id AND status = 'merged';
  IF c_from IS NOT NULL THEN
    UPDATE vendors SET individual_contact_id = c_from
     WHERE id = s.from_id AND individual_contact_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM vendors x WHERE x.individual_contact_id = c_from AND x.status <> 'merged');
  END IF;

  -- (3) 옮겨졌던 건만 원래 매출처로 — 지금도 남은 쪽을 가리키는 건에 한해서
  FOREACH t IN ARRAY vendor_merge_ref_tables() LOOP
    CONTINUE WHEN NOT (snap->'rows') ? t;
    SELECT udt_name INTO typ FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = t AND column_name = 'id';
    CONTINUE WHEN typ IS NULL OR typ NOT IN ('uuid', 'int4', 'int8', 'text');
    EXECUTE format('UPDATE %I SET vendor_id = $1 WHERE vendor_id = $2 AND id = ANY (ARRAY(SELECT jsonb_array_elements_text($3))::%s[])', t, typ)
      USING s.from_id, s.into_id, snap->'rows'->t;
    GET DIAGNOSTICS n = ROW_COUNT;
    v_tables := v_tables || jsonb_build_object(t, jsonb_build_object('total', jsonb_array_length(snap->'rows'->t), 'back', n));
  END LOOP;

  -- (4) 지점 담당(다올): 같은 직원이 양쪽에 있어 지워졌던 줄을 되살리고, 주담당 표시를 병합 전으로
  INSERT INTO vendor_staff
  SELECT r.* FROM jsonb_populate_recordset(NULL::vendor_staff,
      (SELECT COALESCE(jsonb_agg(e || '{"is_primary": false}'::jsonb), '[]'::jsonb)
         FROM jsonb_array_elements(snap->'staff') e
        WHERE e->>'id' IN (SELECT jsonb_array_elements_text(snap->'staff_dup_ids')))) r
   WHERE NOT EXISTS (SELECT 1 FROM vendor_staff x WHERE x.id = r.id)
     AND EXISTS (SELECT 1 FROM employees e WHERE e.id = r.employee_id);
  GET DIAGNOSTICS n_staff = ROW_COUNT;
  UPDATE vendor_staff SET is_primary = false WHERE vendor_id = s.from_id AND is_primary AND ended_at IS NULL;
  UPDATE vendor_staff SET is_primary = true
   WHERE vendor_id = s.from_id AND ended_at IS NULL
     AND id = (SELECT (e->>'id')::uuid FROM jsonb_array_elements(snap->'staff') e
                WHERE (e->>'is_primary')::boolean AND e->>'ended_at' IS NULL LIMIT 1);

  -- (5) 대표 담당자 표시: 남은 쪽에 대표가 있어 내렸던 것을 다시 올린다
  UPDATE contact_assignments SET is_representative = true
   WHERE vendor_id = s.from_id AND ended_at IS NULL AND NOT is_representative
     AND id = (SELECT (e->>'id')::uuid FROM jsonb_array_elements(snap->'assignments') e
                WHERE (e->>'is_representative')::boolean AND e->>'ended_at' IS NULL LIMIT 1)
     AND NOT EXISTS (SELECT 1 FROM contact_assignments x
                      WHERE x.vendor_id = s.from_id AND x.is_representative AND x.ended_at IS NULL);

  -- (6) 기초잔액: 합산했던 금액을 빼고 흡수 쪽 행을 되살린다
  IF jsonb_typeof(snap->'opening_from') = 'object'
     AND NOT EXISTS (SELECT 1 FROM vendor_opening_balances WHERE vendor_id = s.from_id) THEN
    v_amt := (snap->'opening_from'->>'amount')::numeric;
    IF jsonb_typeof(snap->'opening_into') <> 'object' OR snap->'opening_into' IS NULL THEN
      DELETE FROM vendor_opening_balances WHERE vendor_id = s.into_id AND amount = v_amt;
    END IF;
    UPDATE vendor_opening_balances SET amount = amount - v_amt WHERE vendor_id = s.into_id;
    INSERT INTO vendor_opening_balances
    SELECT * FROM jsonb_populate_record(NULL::vendor_opening_balances, snap->'opening_from');
  END IF;
  IF jsonb_typeof(snap->'purchase_opening_from') = 'object'
     AND NOT EXISTS (SELECT 1 FROM purchase_opening_balances WHERE vendor_id = s.from_id) THEN
    v_amt := (snap->'purchase_opening_from'->>'amount')::numeric;
    IF jsonb_typeof(snap->'purchase_opening_into') <> 'object' OR snap->'purchase_opening_into' IS NULL THEN
      DELETE FROM purchase_opening_balances WHERE vendor_id = s.into_id AND amount = v_amt;
    END IF;
    UPDATE purchase_opening_balances SET amount = amount - v_amt WHERE vendor_id = s.into_id;
    INSERT INTO purchase_opening_balances
    SELECT * FROM jsonb_populate_record(NULL::purchase_opening_balances, snap->'purchase_opening_from');
  END IF;

  -- (7) 남은 매출처에 병합으로 붙었던 것 떼기: 별칭(흡수 쪽 이름 · 별칭) · 카드번호 · 사업자번호 · 카드사 표시
  --     병합 전부터 있던 것과 그 뒤 따로 추가한 것은 남긴다.
  v_added := ARRAY(SELECT a FROM unnest(vms_text_array(f->'match_aliases') || ARRAY[f->>'name']) a
                    WHERE a IS NOT NULL AND a <> '' AND a <> ALL (vms_text_array(i->'match_aliases')));
  UPDATE vendors SET match_aliases = ARRAY(SELECT a FROM unnest(match_aliases) a WHERE a <> ALL (v_added))
   WHERE id = s.into_id AND match_aliases && v_added;
  GET DIAGNOSTICS n_alias = ROW_COUNT;
  v_cards := ARRAY(SELECT c FROM unnest(vms_text_array(f->'card_numbers')) c
                    WHERE c IS NOT NULL AND c <> '' AND c <> ALL (vms_text_array(i->'card_numbers')));
  UPDATE vendors SET card_numbers = ARRAY(SELECT c FROM unnest(card_numbers) c WHERE c <> ALL (v_cards))
   WHERE id = s.into_id AND card_numbers && v_cards;
  UPDATE vendors SET biz_number = NULL
   WHERE id = s.into_id AND NULLIF(i->>'biz_number', '') IS NULL
     AND NULLIF(f->>'biz_number', '') IS NOT NULL AND biz_number = f->>'biz_number';
  UPDATE vendors SET is_card_company = false
   WHERE id = s.into_id AND is_card_company
     AND NOT COALESCE((i->>'is_card_company')::boolean, false) AND COALESCE((f->>'is_card_company')::boolean, false);

  -- (8) 청구처(114): 흡수 쪽을 청구처로 가리키던 매출처를 다시 흡수 쪽으로, 남은 쪽이 이어받은 설정은 병합 전으로
  UPDATE vendors SET billing_vendor_id = s.from_id
   WHERE billing_vendor_id = s.into_id AND id <> s.from_id
     AND id::text IN (SELECT jsonb_array_elements_text(snap->'billing_children'));
  IF i->>'billing_vendor_id' = s.from_id::text THEN
    UPDATE vendors SET billing_vendor_id = s.from_id WHERE id = s.into_id AND billing_vendor_id IS NULL;
  ELSIF NULLIF(i->>'billing_vendor_id', '') IS NULL AND NULLIF(f->>'billing_vendor_id', '') IS NOT NULL THEN
    UPDATE vendors SET billing_vendor_id = NULL
     WHERE id = s.into_id AND billing_vendor_id::text = f->>'billing_vendor_id';
  END IF;

  -- (9) 참고: 합친 뒤에 흡수 쪽 별칭으로 들어온 주문 (남은 쪽에 두되, 별칭은 돌아갔으므로 확인 대상)
  SELECT COUNT(*) INTO n_mis FROM erp_orders o
    JOIN erp_vendor_aliases a ON a.id = o.customer_alias_id
   WHERE o.vendor_id = s.into_id AND a.vendor_id = s.from_id;

  res := jsonb_build_object(
    'tables', v_tables, 'staff_restored', n_staff,
    'aliases_removed', to_jsonb(v_added), 'orders_alias_mismatch', n_mis);
  UPDATE vendor_merge_snapshots SET undone_at = now(), undone_by = p_actor, undo_result = res WHERE id = p_snapshot;
  RETURN res;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- 검증
SELECT
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'vendor_merge_snapshots') AS 기록테이블_기대1,
  (SELECT COUNT(*) FROM pg_proc WHERE proname IN ('vendor_merge_snapshot', 'unmerge_vendor', 'unmerge_vendor_preview', 'unmerge_vendor_blockers', 'vendor_merge_ref_tables', 'vms_text_array')) AS 함수_기대6,
  (SELECT COUNT(*) FROM vendor_merge_snapshots) AS 기록건수_기대0;
