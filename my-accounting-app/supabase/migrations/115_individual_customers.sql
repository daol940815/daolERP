-- =====================================================
-- 115_individual_customers.sql
-- 개인 고객 자동 분리 — 사용자 승인 2026-11-06 (시안 docs/mockups/개인고객_분리_시안.html, "A안")
--
-- 배경: 업체 '개인' 주문은 업체 = 개인, 지점 = 공란, 담당자 = 주문자로 입력한다. 매출처가 지점 단위라
-- 모든 개인 주문이 매출처 '개인' 하나로 합쳐졌다(미수 · 수금 대상을 고객별로 볼 수 없음).
--
-- 설계: 업체에 "개인 고객 업체" 표시(is_individual)를 두고, 그 업체의 고객(인물)마다 전용 매출처를
-- 시스템이 만든다. 전용 매출처는 individual_contact_id 로 인물을 가리킨다(이름이 아니라 인물 기준 —
-- 동명이인 · 표기 차이에 흔들리지 않음). 직원 입력은 그대로(지점 공란), 저장 때 연결.
--   - 매출처 이름 "개인 {이름}"(직함 · 존칭 제외). 동명이인만 "(전화 뒷 4자리)".
--   - 모임(심통회 등)처럼 individual_contact_id 가 없는 지점은 기존 지점과 같다.
--   - 업체 이름과 같은 매출처('개인')는 입력 창구 — 저장 때 고객 매출처로 바뀐다.
-- 병합: 고객 매출처가 다른 매출처에 병합되면 인물 연결을 병합 대상으로 넘긴다(대상에 없을 때).
-- =====================================================

ALTER TABLE vendor_groups ADD COLUMN IF NOT EXISTS is_individual BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN vendor_groups.is_individual IS
  '개인 고객 업체 — 이 업체의 주문 · 상담은 지점명과 상관없이 고객(인물)마다 전용 매출처로 나뉜다 (115).';

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS individual_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;
COMMENT ON COLUMN vendors.individual_contact_id IS
  '개인 고객 전용 매출처의 고객(인물). NULL = 일반 지점 (115).';

-- 한 인물 = 활성 고객 매출처 하나
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendors_individual_contact
  ON vendors(individual_contact_id) WHERE individual_contact_id IS NOT NULL AND status <> 'merged';

UPDATE vendor_groups SET is_individual = true WHERE name = '개인';

-- 병합 승계: 고객 매출처가 병합되면 인물 연결을 대상으로 넘긴다
CREATE OR REPLACE FUNCTION vendors_individual_follow_merge() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_contact UUID := NEW.individual_contact_id;
BEGIN
  IF NEW.status = 'merged' AND OLD.status IS DISTINCT FROM 'merged'
     AND v_contact IS NOT NULL AND NEW.merged_into_id IS NOT NULL THEN
    UPDATE vendors SET individual_contact_id = NULL WHERE id = NEW.id;
    UPDATE vendors SET individual_contact_id = v_contact
     WHERE id = NEW.merged_into_id AND individual_contact_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM vendors x WHERE x.individual_contact_id = v_contact AND x.status <> 'merged');
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_vendors_individual_follow_merge ON vendors;
CREATE TRIGGER trg_vendors_individual_follow_merge
  AFTER UPDATE OF status ON vendors
  FOR EACH ROW EXECUTE FUNCTION vendors_individual_follow_merge();

-- 검증
SELECT
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'vendors' AND column_name = 'individual_contact_id') AS 고객연결컬럼_기대1,
  (SELECT COUNT(*) FROM vendor_groups WHERE is_individual) AS 개인업체_기대1,
  (SELECT COUNT(*) FROM pg_trigger WHERE tgname = 'trg_vendors_individual_follow_merge') AS 트리거_기대1;
