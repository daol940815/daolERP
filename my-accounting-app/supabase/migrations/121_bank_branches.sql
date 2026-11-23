-- =====================================================
-- 121_bank_branches.sql
-- 은행 점포 목록(은행연합회 점포 현황) 원본 표 + 매출처 연결 — 사용자 승인 2026-11-23 (시안 docs/mockups/은행점포_목록_시안.html, B안)
--
-- 배경: 거래 없는 은행 점포까지 영업에 쓰려면 점포 목록이 필요하다. 5,522 점포를 매출처로 다 넣으면 매출처 목록 · 숫자가 거래 없는 곳으로 섞이므로
--   점포 목록은 별도 원본 표로 두고, 실제로 쓸 때(주문 · 상담 · 등록 창 · 매출처 관리 "은행 점포" 보기) 매출처를 만든다.
-- 원본 보존: 기준월(base_month)별로 엑셀 그대로 넣고 고치지 않는다. 새 기준월이 오면 새 행을 넣고 이전 기준월은 is_current = false.
--   매출처 연결(vendor_id)만 연결 정보로 갱신한다.
-- 매출처 병합: 흡수되는 매출처를 가리키던 점포는 남는 쪽으로 따라간다(트리거). 병합 기록(119)에 점포 연결도 함께 남겨 병합 취소 때 되돌린다.
-- 결정(2026-11-23): 꼬리 없는 점포명은 '지점'을 붙여 매출처 이름으로(11-19 결정), (출) → 출장소, (점) → 지점. 지방 · 특수은행 포함.
--   미등록 점포를 고르면 주문 입력자 누구나 매출처로 등록. 영업용 추가 칸(담당 · 단계)은 두지 않는다(가안).
-- =====================================================

CREATE TABLE IF NOT EXISTS bank_branches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_month    TEXT NOT NULL,                 -- 기준월 'YYYY-MM' (은행연합회 자료 기준)
  bank_name     TEXT NOT NULL,                 -- 은행연합회 표기 그대로 (예: 'iM뱅크(구 대구은행)')
  group_name    TEXT NOT NULL,                 -- 이 시스템의 업체명(vendor_groups.name 표준) (예: 'IBK기업은행')
  branch_name   TEXT NOT NULL,                 -- 은행연합회 점포명 그대로 (예: '마포', '풍납동(출)')
  display_name  TEXT NOT NULL,                 -- 매출처 이름에 쓸 지점명 (예: '마포지점', '풍납동출장소')
  sido          TEXT,
  sigungu       TEXT,
  dong          TEXT,
  address       TEXT,
  phone         TEXT,
  is_current    BOOLEAN NOT NULL DEFAULT true, -- 가장 최근 기준월의 점포
  vendor_id     UUID REFERENCES vendors(id) ON DELETE SET NULL,   -- 연결된 매출처 (없으면 미거래 점포)
  linked_by     TEXT,                          -- 연결한 사람 · 방법 (예: '이름 일치(적재)', 직원 이름)
  linked_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (base_month, bank_name, branch_name, sido)   -- 같은 은행 · 같은 점포명이 다른 시도에 있다(NH농협은행 고성군지부 — 경남 · 강원)
);
CREATE INDEX IF NOT EXISTS idx_bank_branches_vendor  ON bank_branches(vendor_id) WHERE vendor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bank_branches_current ON bank_branches(group_name, sido, sigungu) WHERE is_current;
ALTER TABLE bank_branches ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE bank_branches IS '은행 점포 원본(은행연합회 점포 현황, 기준월별) + 매출처 연결 (121). 원본 칸은 고치지 않고 vendor_id 연결만 갱신.';

-- 은행 매출처인데 점포가 아닌 곳(본점 부서 · 팀 · 모임 등) — "점포 목록에 없음" 안내에서 다시 묻지 않게
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS not_bank_branch BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN vendors.not_bank_branch IS '은행 업체 매출처 중 점포가 아님(본점 부서 · 팀 · 모임 등) — 점포 목록 대조에서 제외 (121).';

-- ── 매출처 병합 승계: 흡수 쪽을 가리키던 점포 → 남는 쪽 ──
CREATE OR REPLACE FUNCTION bank_branches_follow_merge() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'merged' AND OLD.status IS DISTINCT FROM 'merged' AND NEW.merged_into_id IS NOT NULL THEN
    UPDATE bank_branches SET vendor_id = NEW.merged_into_id WHERE vendor_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_bank_branches_follow_merge ON vendors;
CREATE TRIGGER trg_bank_branches_follow_merge
  AFTER UPDATE OF status ON vendors
  FOR EACH ROW EXECUTE FUNCTION bank_branches_follow_merge();

-- ── 병합 기록(119)에 점포 연결을 함께 남긴다 — 병합 취소 때 119의 공통 처리로 원래 매출처로 되돌아간다 ──
-- (119 미적용이면 건너뜀. 목록은 119의 것에 bank_branches 만 더한 것)
DO $do$
BEGIN
  IF to_regprocedure('vendor_merge_ref_tables()') IS NULL THEN
    RAISE NOTICE '119 미적용 — 병합 기록 연동은 건너뜀';
    RETURN;
  END IF;
  CREATE OR REPLACE FUNCTION vendor_merge_ref_tables() RETURNS TEXT[]
  LANGUAGE sql IMMUTABLE AS $f$
    SELECT ARRAY[
      'transactions', 'journal_lines', 'tax_invoices', 'card_sales', 'cash_receipts', 'card_accounts',
      'erp_vendor_aliases', 'vendor_ledger_entries',
      'contact_assignments', 'vendor_staff', 'contact_activities',
      'erp_purchase_orders', 'purchase_cycle_reviews', 'erp_orders',
      'contact_name_links', 'doc_sales_snapshot', 'erp_consultations', 'contact_review_events',
      'bank_branches'
    ]
  $f$;
END
$do$;

NOTIFY pgrst, 'reload schema';

-- 검증
SELECT
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'bank_branches') AS 점포표_기대1,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'vendors' AND column_name = 'not_bank_branch') AS 칸_기대1,
  (SELECT COUNT(*) FROM pg_trigger WHERE tgname = 'trg_bank_branches_follow_merge') AS 트리거_기대1,
  (SELECT 'bank_branches' = ANY (vendor_merge_ref_tables())) AS 병합기록_연동_기대true;
