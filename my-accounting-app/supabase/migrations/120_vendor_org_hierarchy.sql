-- =====================================================
-- 120_vendor_org_hierarchy.sql
-- 매출처 하위 조직 · 위치 — 사용자 승인 2026-11-20 (시안 docs/mockups/매출처_하위조직_시안.html)
--
-- 배경: 은행을 지점 단위로만 관리해 하위 조직(본점 › 채널전략부 › 팀, 원큐 › 자동차금융팀)을 다룰 수 없었다.
--   팀도 지금처럼 매출처 하나(주문 · 상담 · 담당자가 붙는 단위)로 두고, 매출처마다 상위 조직 하나를 지정해 트리를 만든다.
--   parent_vendor_id   = 상위 조직(조직도). 비우면 업체 바로 아래.
--   location_vendor_id = 위치(소재 지점) — 소속과 자리가 다를 때만(예: 원큐 영남영업그룹팀 → 서면역금융센터).
--   청구처(114, billing_vendor_id — 계산서 발행 법인)와는 별개 개념이다.
-- 원본(주문 · 계산서 · 통장)은 손대지 않는다 — 연결 정보만 추가. 집계는 저장하지 않고 화면에서 트리를 따라 더한다.
-- 병합: 흡수되는 쪽의 하위 조직 · 위치 지정은 남는 쪽으로 따라간다(114 청구처와 같은 방식).
--   병합 취소(119): 병합 기록에 하위 조직 목록을 함께 남기고, 취소하면 원래대로 되돌린다(트리거 — 119 함수는 그대로).
-- =====================================================

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS parent_vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS location_vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_vendors_parent ON vendors(parent_vendor_id) WHERE parent_vendor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vendors_location ON vendors(location_vendor_id) WHERE location_vendor_id IS NOT NULL;
COMMENT ON COLUMN vendors.parent_vendor_id IS '상위 조직(120) — 같은 업체의 매출처. NULL = 업체 바로 아래. 청구처(billing_vendor_id)와 별개.';
COMMENT ON COLUMN vendors.location_vendor_id IS '위치(소재 지점, 120) — 상위 조직과 다른 곳에 있을 때만.';

-- ── 1) 자기 참조 · 순환 금지 ──────────────────────────
CREATE OR REPLACE FUNCTION vendors_org_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  cur UUID; n INT := 0;
BEGIN
  IF NEW.location_vendor_id IS NOT NULL AND NEW.location_vendor_id = NEW.id THEN
    RAISE EXCEPTION '자기 자신을 위치로 지정할 수 없습니다';
  END IF;
  IF NEW.parent_vendor_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.parent_vendor_id = NEW.id THEN RAISE EXCEPTION '자기 자신을 상위 조직으로 지정할 수 없습니다'; END IF;
  cur := NEW.parent_vendor_id;
  WHILE cur IS NOT NULL LOOP
    IF cur = NEW.id THEN RAISE EXCEPTION '하위 조직을 상위 조직으로 지정할 수 없습니다(순환)'; END IF;
    n := n + 1;
    IF n > 20 THEN RAISE EXCEPTION '상위 조직 단계가 너무 깊습니다'; END IF;
    SELECT parent_vendor_id INTO cur FROM vendors WHERE id = cur;
  END LOOP;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_vendors_org_guard ON vendors;
CREATE TRIGGER trg_vendors_org_guard
  BEFORE INSERT OR UPDATE OF parent_vendor_id, location_vendor_id ON vendors
  FOR EACH ROW EXECUTE FUNCTION vendors_org_guard();

-- ── 2) 병합 승계 ──────────────────────────────────────
CREATE OR REPLACE FUNCTION vendors_org_follow_merge() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_into UUID := NEW.merged_into_id;
BEGIN
  IF NEW.status = 'merged' AND OLD.status IS DISTINCT FROM 'merged' AND v_into IS NOT NULL THEN
    -- 남는 쪽이 흡수되는 쪽의 하위였다면, 남는 쪽을 흡수되는 쪽 자리(상위)로 올린다
    UPDATE vendors SET parent_vendor_id = NEW.parent_vendor_id WHERE id = v_into AND parent_vendor_id = NEW.id;
    UPDATE vendors SET location_vendor_id = NULL WHERE id = v_into AND location_vendor_id = NEW.id;
    -- 흡수되는 쪽을 상위 · 위치로 가리키던 조직 → 남는 쪽
    UPDATE vendors SET parent_vendor_id = v_into WHERE parent_vendor_id = NEW.id AND id <> v_into;
    UPDATE vendors SET location_vendor_id = v_into WHERE location_vendor_id = NEW.id AND id <> v_into;
    -- 남는 쪽에 상위 · 위치가 없으면 흡수되는 쪽 값을 이어받는다(남는 쪽 하위가 아니어야 — 순환 방지)
    IF NEW.parent_vendor_id IS NOT NULL AND NEW.parent_vendor_id <> v_into AND NOT EXISTS (
         WITH RECURSIVE sub AS (
           SELECT id FROM vendors WHERE parent_vendor_id = v_into
           UNION SELECT c.id FROM vendors c JOIN sub ON c.parent_vendor_id = sub.id)
         SELECT 1 FROM sub WHERE id = NEW.parent_vendor_id) THEN
      UPDATE vendors SET parent_vendor_id = NEW.parent_vendor_id WHERE id = v_into AND parent_vendor_id IS NULL;
    END IF;
    IF NEW.location_vendor_id IS NOT NULL AND NEW.location_vendor_id <> v_into THEN
      UPDATE vendors SET location_vendor_id = NEW.location_vendor_id WHERE id = v_into AND location_vendor_id IS NULL;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_vendors_org_follow_merge ON vendors;
CREATE TRIGGER trg_vendors_org_follow_merge
  AFTER UPDATE OF status ON vendors
  FOR EACH ROW EXECUTE FUNCTION vendors_org_follow_merge();

-- ── 3) 병합 기록(119)에 하위 조직 목록을 함께 남기고, 취소하면 되돌린다 ──
-- 119 의 vendor_merge_snapshots 가 없으면(미적용) 이 부분은 건너뛴다.
DO $do$
BEGIN
  IF to_regclass('public.vendor_merge_snapshots') IS NULL THEN
    RAISE NOTICE '119 미적용 — 병합 기록 연동은 건너뜀';
    RETURN;
  END IF;

  CREATE OR REPLACE FUNCTION vms_org_capture() RETURNS TRIGGER
  LANGUAGE plpgsql AS $f$
  BEGIN
    NEW.snapshot := NEW.snapshot || jsonb_build_object(
      'org_children', COALESCE((SELECT jsonb_agg(v.id) FROM vendors v WHERE v.parent_vendor_id = NEW.from_id AND v.id <> NEW.into_id), '[]'::jsonb),
      'org_location_children', COALESCE((SELECT jsonb_agg(v.id) FROM vendors v WHERE v.location_vendor_id = NEW.from_id AND v.id <> NEW.into_id), '[]'::jsonb));
    RETURN NEW;
  END;
  $f$;
  DROP TRIGGER IF EXISTS trg_vms_org_capture ON vendor_merge_snapshots;
  CREATE TRIGGER trg_vms_org_capture BEFORE INSERT ON vendor_merge_snapshots
    FOR EACH ROW EXECUTE FUNCTION vms_org_capture();

  CREATE OR REPLACE FUNCTION vms_org_restore() RETURNS TRIGGER
  LANGUAGE plpgsql AS $f$
  DECLARE
    snap JSONB := NEW.snapshot;
    f_par UUID := NULLIF(NEW.snapshot->'from'->>'parent_vendor_id', '')::uuid;
    i_par UUID := NULLIF(NEW.snapshot->'into'->>'parent_vendor_id', '')::uuid;
    f_loc UUID := NULLIF(NEW.snapshot->'from'->>'location_vendor_id', '')::uuid;
    i_loc UUID := NULLIF(NEW.snapshot->'into'->>'location_vendor_id', '')::uuid;
  BEGIN
    IF OLD.undone_at IS NULL AND NEW.undone_at IS NOT NULL THEN
      -- 남는 쪽의 상위 · 위치: 병합 때 바뀐 경우에만 병합 전 값으로
      UPDATE vendors SET parent_vendor_id = i_par
       WHERE id = NEW.into_id AND parent_vendor_id IS DISTINCT FROM i_par
         AND (parent_vendor_id IS NOT DISTINCT FROM f_par);
      UPDATE vendors SET location_vendor_id = i_loc
       WHERE id = NEW.into_id AND location_vendor_id IS DISTINCT FROM i_loc
         AND (location_vendor_id IS NOT DISTINCT FROM f_loc);
      -- 흡수 쪽을 가리키던 하위 조직 · 위치 지정을 되살아난 흡수 쪽으로
      UPDATE vendors SET parent_vendor_id = NEW.from_id
       WHERE parent_vendor_id = NEW.into_id
         AND id::text IN (SELECT jsonb_array_elements_text(COALESCE(snap->'org_children', '[]'::jsonb)));
      UPDATE vendors SET location_vendor_id = NEW.from_id
       WHERE location_vendor_id = NEW.into_id
         AND id::text IN (SELECT jsonb_array_elements_text(COALESCE(snap->'org_location_children', '[]'::jsonb)));
    END IF;
    RETURN NULL;
  END;
  $f$;
  DROP TRIGGER IF EXISTS trg_vms_org_restore ON vendor_merge_snapshots;
  CREATE TRIGGER trg_vms_org_restore AFTER UPDATE OF undone_at ON vendor_merge_snapshots
    FOR EACH ROW EXECUTE FUNCTION vms_org_restore();
END
$do$;

-- ── 4) 상위 조직 · 위치 변경 이력 (덮어쓰기 · 삭제 없음) ──
CREATE TABLE IF NOT EXISTS vendor_org_changes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id       UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  field           TEXT NOT NULL CHECK (field IN ('parent', 'location')),
  old_vendor_id   UUID,
  old_name        TEXT,
  new_vendor_id   UUID,
  new_name        TEXT,
  changed_by      UUID REFERENCES employees(id) ON DELETE SET NULL,
  changed_by_name TEXT,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voc_vendor ON vendor_org_changes(vendor_id, changed_at DESC);
ALTER TABLE vendor_org_changes ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE vendor_org_changes IS '매출처 상위 조직 · 위치 변경 이력 (120).';

NOTIFY pgrst, 'reload schema';

-- 검증
SELECT
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'vendors' AND column_name IN ('parent_vendor_id', 'location_vendor_id')) AS 칸_기대2,
  (SELECT COUNT(*) FROM pg_trigger WHERE tgname IN ('trg_vendors_org_guard', 'trg_vendors_org_follow_merge', 'trg_vms_org_capture', 'trg_vms_org_restore')) AS 트리거_기대4,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'vendor_org_changes') AS 이력테이블_기대1;
