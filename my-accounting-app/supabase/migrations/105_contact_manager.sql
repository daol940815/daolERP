-- =====================================================
-- 105_contact_manager.sql
-- 거래처 담당자 관리 화면 — 영업일지 + 주문 담당자명 연결
--
-- 1) contact_activities: 영업 이력(영업일지). 인물(contacts)에 붙어
--    담당자가 거래처를 옮겨도 이력이 따라간다.
--    * CRM 트랙(069)의 crm_activities는 crm_contacts를 참조하는 별도 설계라
--      직접 변경하지 않고 전용 테이블을 신설한다(A안: 인물 마스터=contacts).
--      crm_activities는 현재 0건 — CRM 트랙 재개 시 이 테이블로 통합 검토.
-- 2) contact_name_links: 주문의 담당자 표기(자유 텍스트)와 인물의 명시적 연결.
--    contact_id NULL = 비인명 표기 무시(공란 처리). 원본 주문은 수정하지 않는다.
-- =====================================================

CREATE TABLE IF NOT EXISTS contact_activities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  vendor_id     UUID REFERENCES vendors(id) ON DELETE SET NULL,   -- 당시 거래처(선택)
  employee_id   UUID REFERENCES employees(id) ON DELETE SET NULL, -- 활동한 직원
  activity_date DATE NOT NULL DEFAULT CURRENT_DATE,
  activity_type TEXT NOT NULL DEFAULT '기타'
    CHECK (activity_type IN ('방문','전화','미팅','식사','제안','기타')),
  content       TEXT NOT NULL,
  next_action   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contact_activities_contact
  ON contact_activities(contact_id, activity_date DESC);
CREATE INDEX IF NOT EXISTS idx_contact_activities_vendor
  ON contact_activities(vendor_id) WHERE vendor_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS contact_name_links (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id  UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  raw_name   TEXT NOT NULL,                              -- 주문 표기 원문 그대로
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE, -- NULL = 무시(비인명 등)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, raw_name)
);
CREATE INDEX IF NOT EXISTS idx_contact_name_links_contact
  ON contact_name_links(contact_id) WHERE contact_id IS NOT NULL;

ALTER TABLE contact_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_name_links ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE contact_activities IS '영업일지 — 인물 기준 활동 이력. 이동해도 인물을 따라감.';
COMMENT ON TABLE contact_name_links IS '주문 담당자 표기 → 인물 연결. contact_id NULL=무시. 원본 미수정.';
