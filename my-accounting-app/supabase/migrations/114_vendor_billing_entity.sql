-- =====================================================
-- 114_vendor_billing_entity.sql
-- 청구처(계산서 발행처) — 사용자 승인 2026-11-06 (시안 docs/mockups/청구처_시안.html)
--
-- 배경: '주식회사 하나은행'(본점 법인)에 속한 여러 부서(영업지원그룹 · 신탁부 …)가 실제
-- 매출처(고객)로 주문하고, 계산서는 본점 법인 이름으로 발행된다. 주문은 부서에, 계산서는
-- 본점에 붙어 주문 ↔ 계산서 연결 추천이 서로를 찾지 못했다(같은 거래처 안에서만 탐색).
--
-- 설계: 부서는 매출처로 그대로 두고(병합 안 함 — 부서별 고객 · 다올 담당 · 매출 유지),
-- 계산서를 받는 법인을 billing_vendor_id 로 가리킨다. NULL = 자기 자신이 청구처(기본).
--   - 한 단계만: 청구처로 지정된 거래처는 다른 청구처를 가리키지 않는다(API에서 막음).
--   - billing_self_confirmed: 추천 목록에서 "아니다(자체 발행)"로 확정된 매출처 — 다시 추천하지 않음.
--   - 업체(vendor_groups)와 별개: 업체 아래 지점 상당수는 자기 사업자번호로 따로 발행한다.
-- 병합: 거래처가 병합(status = 'merged')되면 그 거래처를 청구처로 가리키던 매출처를 병합 대상으로
--       옮기는 트리거(merge_vendor 등 어떤 병합 경로든 적용).
-- =====================================================

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS billing_vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS billing_self_confirmed BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_vendors_billing_not_self') THEN
    ALTER TABLE vendors ADD CONSTRAINT chk_vendors_billing_not_self
      CHECK (billing_vendor_id IS NULL OR billing_vendor_id <> id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_vendors_billing ON vendors(billing_vendor_id) WHERE billing_vendor_id IS NOT NULL;

COMMENT ON COLUMN vendors.billing_vendor_id IS
  '청구처(계산서 발행처) — 이 매출처 주문의 계산서가 발행되는 법인. NULL = 자기 자신. 예: 하나은행 영업지원그룹 → 주식회사 하나은행.';
COMMENT ON COLUMN vendors.billing_self_confirmed IS
  '청구처 추천에서 "자체 발행"으로 확정됨 — 다시 추천하지 않는다.';

-- 병합 시 청구처 참조 승계
CREATE OR REPLACE FUNCTION vendors_billing_follow_merge() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'merged' AND OLD.status IS DISTINCT FROM 'merged' AND NEW.merged_into_id IS NOT NULL THEN
    -- 병합 대상 자신이 흡수되는 거래처를 청구처로 가리키고 있었다면 해제(자기 참조 방지)
    UPDATE vendors SET billing_vendor_id = NULL
     WHERE id = NEW.merged_into_id AND billing_vendor_id = NEW.id;
    -- 흡수되는 거래처를 청구처로 가리키던 매출처 → 병합 대상으로
    UPDATE vendors SET billing_vendor_id = NEW.merged_into_id
     WHERE billing_vendor_id = NEW.id AND id <> NEW.merged_into_id;
    -- 흡수되는 거래처의 청구처 설정을 병합 대상이 비어 있으면 이어받음
    IF NEW.billing_vendor_id IS NOT NULL AND NEW.billing_vendor_id <> NEW.merged_into_id THEN
      UPDATE vendors SET billing_vendor_id = NEW.billing_vendor_id
       WHERE id = NEW.merged_into_id AND billing_vendor_id IS NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vendors_billing_follow_merge ON vendors;
CREATE TRIGGER trg_vendors_billing_follow_merge
  AFTER UPDATE OF status ON vendors
  FOR EACH ROW EXECUTE FUNCTION vendors_billing_follow_merge();

-- 검증 (실행 후): 기대 = 청구처컬럼_기대1 1 · 트리거_기대1 1 · 지정된_매출처 0(지정은 화면에서)
SELECT
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'vendors' AND column_name = 'billing_vendor_id') AS 청구처컬럼_기대1,
  (SELECT COUNT(*) FROM pg_trigger WHERE tgname = 'trg_vendors_billing_follow_merge') AS 트리거_기대1,
  (SELECT COUNT(*) FROM vendors WHERE billing_vendor_id IS NOT NULL) AS 지정된_매출처;
