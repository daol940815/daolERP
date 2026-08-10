-- =====================================================
-- 505_vendor_groups.sql
-- 업체(그룹) 마스터 — 주문처를 업체/지점(부서)으로 분리 (사용자 확정 2026-08-10)
--
-- 배경: 직접입력 주문이 vendors 단일 선택이라 bank_name에 거래처명 전체가
-- 들어가 업체(은행) 단위 통계를 낼 수 없었다. 업체 마스터를 신설하고
-- vendors(지점 단위 거래처)를 업체에 연결한다.
--  - 주문 입력: 업체 선택 → 소속 지점 선택 (2칸, 기존 ERP 흐름 복원)
--  - 저장: direct 주문 bank_name=업체명 / branch_name=지점명 병기 →
--    업로드 주문과 같은 모양이 되어 목록·통계에서 자연 통합
--  - 그룹 없는 거래처(단일 업체)는 자기 자신이 업체
--  - 하류(허브·회계)는 vendors 기준이라 무수정
--
-- 실행 순서 (SQL 편집기):
--  1) [드라이런] 아래 "드라이런" 블록만 먼저 실행해 연결 통계를 확인
--  2) 전체 실행 (스키마 + 백필)
--  3) 마지막 "검증" 블록 결과를 확인 (연결/미연결 건수)
-- =====================================================

-- ── 드라이런 (실행 전 확인용 — 이 블록만 따로 실행) ──
-- SELECT count(DISTINCT trim(bank_name)) AS 업체후보,
--        count(DISTINCT a.vendor_id)     AS 연결될_거래처
-- FROM erp_orders o
-- JOIN erp_vendor_aliases a ON a.id = o.customer_alias_id
-- WHERE a.vendor_id IS NOT NULL
--   AND o.bank_name IS NOT NULL AND trim(o.bank_name) <> '';

-- ── 1) 업체 마스터 ────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendor_groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,           -- 업체명 (하나은행, 교보생명 등)
  is_active  BOOLEAN NOT NULL DEFAULT true,
  memo       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_vendor_groups_updated_at ON vendor_groups;
CREATE TRIGGER trg_vendor_groups_updated_at
  BEFORE UPDATE ON vendor_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE vendor_groups ENABLE ROW LEVEL SECURITY;

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES vendor_groups(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_vendors_group ON vendors(group_id) WHERE group_id IS NOT NULL;

COMMENT ON TABLE  vendor_groups    IS '업체(그룹) 마스터 — 지점(vendors)의 상위. 업체별 통계·주문 입력 2단 선택의 기준.';
COMMENT ON COLUMN vendors.group_id IS '소속 업체. NULL=단일 업체(자기 자신이 업체).';

-- ── 2) 백필: 업로드 주문의 은행명 → 업체 생성 ─────────
-- 주문 이력에 등장한 업체명만 생성 (2건 이상 — 1건짜리 오타성 이름 제외)
INSERT INTO vendor_groups (name)
SELECT trim(o.bank_name)
FROM erp_orders o
WHERE o.bank_name IS NOT NULL AND trim(o.bank_name) <> ''
GROUP BY trim(o.bank_name)
HAVING count(*) >= 2
ON CONFLICT (name) DO NOTHING;

-- ── 3) 백필: 거래처 → 업체 연결 (주문 이력 최빈 은행명 기준) ──
WITH vendor_bank AS (
  SELECT a.vendor_id,
         trim(o.bank_name) AS bank,
         count(*) AS cnt,
         row_number() OVER (PARTITION BY a.vendor_id ORDER BY count(*) DESC) AS rn
  FROM erp_orders o
  JOIN erp_vendor_aliases a ON a.id = o.customer_alias_id
  WHERE a.vendor_id IS NOT NULL
    AND o.bank_name IS NOT NULL AND trim(o.bank_name) <> ''
  GROUP BY a.vendor_id, trim(o.bank_name)
)
UPDATE vendors v
SET group_id = g.id
FROM vendor_bank vb
JOIN vendor_groups g ON g.name = vb.bank
WHERE vb.rn = 1
  AND vb.vendor_id = v.id
  AND v.group_id IS NULL;          -- 기존 수동 연결은 덮어쓰지 않음

-- ── 검증 (실행 후 확인) ───────────────────────────────
SELECT
  (SELECT count(*) FROM vendor_groups)                                        AS 업체_수,
  (SELECT count(*) FROM vendors WHERE group_id IS NOT NULL)                   AS 연결된_거래처,
  (SELECT count(*) FROM vendors v
    WHERE v.group_id IS NULL AND v.is_active
      AND EXISTS (SELECT 1 FROM erp_vendor_aliases a
                  JOIN erp_orders o ON o.customer_alias_id = a.id
                  WHERE a.vendor_id = v.id))                                  AS 미연결_주문있음,
  (SELECT count(*) FROM vendors WHERE group_id IS NULL AND is_active)         AS 미연결_전체;
