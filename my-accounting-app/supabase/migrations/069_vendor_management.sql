-- =====================================================
-- 069_vendor_management.sql
-- 매출처 허브 — 담당 관리 구조
--
-- 자사 담당직원: employees(마스터) + vendor_staff(거래처 배정, 다대다·주담당)
-- 거래처 담당자: contacts(인물 마스터) + contact_assignments(거래처 배정 이력)
--   * 담당자는 거래처 소속이 아니라 "인물"로 관리 — 지점 이동·진급 시
--     배정을 종료하고 새 배정을 만들면 인물 기준 이력·거래 합산이 유지된다.
--   * 휴대폰은 선택 입력(동일 인물 판별의 보조 수단). 자동 병합 없음 —
--     후보 추천만 하고 확정은 사용자.
-- 기존 vendors.contact_name/contact_phone은 인물+대표 배정으로 이관한다.
-- =====================================================

-- 1) 자사 직원 마스터
CREATE TABLE IF NOT EXISTS employees (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  team       TEXT,                        -- 팀/부서 (예: 영업1팀)
  is_active  BOOLEAN NOT NULL DEFAULT true,
  memo       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2) 거래처-담당직원 배정 (다대다, 주담당 지정)
CREATE TABLE IF NOT EXISTS vendor_staff (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id   UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  is_primary  BOOLEAN NOT NULL DEFAULT false,   -- 목록·집계의 대표 표시 대상
  started_at  DATE,
  ended_at    DATE,                              -- NULL = 현재 담당
  memo        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendor_staff_vendor   ON vendor_staff(vendor_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vendor_staff_employee ON vendor_staff(employee_id) WHERE ended_at IS NULL;
-- 거래처당 현재 주담당은 1명
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_staff_primary
  ON vendor_staff(vendor_id) WHERE is_primary AND ended_at IS NULL;

-- 3) 거래처 담당자 인물 마스터 (상대 회사 사람)
CREATE TABLE IF NOT EXISTS contacts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  phone      TEXT,                        -- 선택 — 있으면 동일 인물 판별의 강한 근거
  email      TEXT,
  note       TEXT,
  merged_into_id UUID REFERENCES contacts(id),   -- 인물 병합 시 남는 쪽을 가리킴
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone) WHERE phone IS NOT NULL;

-- 4) 인물-거래처 배정 (직함은 배정에 기록 — 이동·진급 이력이 자연히 남음)
CREATE TABLE IF NOT EXISTS contact_assignments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id        UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  vendor_id         UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  title             TEXT,                          -- 당시 직함 (대리/차장/지점장 등)
  role_memo         TEXT,                          -- 역할 (발주 담당, 정산 창구 등)
  is_representative BOOLEAN NOT NULL DEFAULT false, -- 거래처의 대표 담당자
  started_at        DATE,
  ended_at          DATE,                           -- NULL = 현재
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contact_asgn_vendor  ON contact_assignments(vendor_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contact_asgn_contact ON contact_assignments(contact_id);
-- 거래처당 현재 대표 담당자는 1명
CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_asgn_rep
  ON contact_assignments(vendor_id) WHERE is_representative AND ended_at IS NULL;

ALTER TABLE employees           ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_staff        ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_assignments ENABLE ROW LEVEL SECURITY;

-- 5) 기존 vendors.contact_name/contact_phone → 인물 + 대표 배정 이관
--    (이름이 있는 거래처만 · 재실행해도 중복 생성되지 않도록 배정 존재 여부 검사)
INSERT INTO contacts (name, phone)
SELECT DISTINCT trim(v.contact_name), NULLIF(trim(v.contact_phone), '')
FROM vendors v
WHERE v.contact_name IS NOT NULL AND trim(v.contact_name) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM contact_assignments ca
    JOIN contacts c ON c.id = ca.contact_id
    WHERE ca.vendor_id = v.id AND c.name = trim(v.contact_name)
  );

INSERT INTO contact_assignments (contact_id, vendor_id, is_representative)
SELECT c.id, v.id, true
FROM vendors v
JOIN contacts c
  ON c.name = trim(v.contact_name)
 AND (c.phone IS NOT DISTINCT FROM NULLIF(trim(v.contact_phone), ''))
WHERE v.contact_name IS NOT NULL AND trim(v.contact_name) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM contact_assignments ca WHERE ca.vendor_id = v.id AND ca.contact_id = c.id
  );

COMMENT ON TABLE employees           IS '자사 직원 마스터 — 거래처 담당 배정·담당별 실적 집계의 기준.';
COMMENT ON TABLE vendor_staff        IS '거래처-자사 담당직원 배정(다대다). is_primary=목록 대표 표시. ended_at NULL=현재.';
COMMENT ON TABLE contacts            IS '거래처 담당자 인물 마스터. 지점을 옮겨도 같은 인물로 추적. phone은 선택.';
COMMENT ON TABLE contact_assignments IS '인물-거래처 배정 이력. 직함은 배정에 기록되어 이동·진급 이력이 남는다.';
