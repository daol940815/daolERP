-- =====================================================
-- 110_contact_code_pipeline.sql
-- 고객코드 + 인물 자동 판별 파이프라인 (사용자 승인 2026-10-16)
--
-- 1) contacts.code — 랜덤 6자리 고객코드 (C-483920 형식)
--    트리거로 생성 시 자동 부여: 화면 등록·자동 생성·이행 스크립트 등
--    어떤 경로로 만들어져도 빠짐없이 붙는다. 기존 인물은 백필.
--    랜덤인 이유: 등록 순서·고객 수 비노출, 전화 구두 소통용 (사용자 결정).
-- 2) contact_review_events — 자동 판별 확인 대기 큐.
--    상담일지·주문 저장만으로 인물이 자동 생성/귀속되고, 사람 판단이
--    필요한 건(자동 생성·이동 감지·동명 충돌)만 사후 확인 목록에 쌓인다.
--    추천·기록은 시스템, 확정은 사용자 원칙 유지.
-- =====================================================

-- ── 1) 고객코드 ───────────────────────────────────────
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_code ON contacts(code) WHERE code IS NOT NULL;

CREATE OR REPLACE FUNCTION gen_contact_code() RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  v_code TEXT;
BEGIN
  -- 랜덤 6자리 (100000~999999). 충돌 시 재시도 — 1,400명 수준에서는 즉시 끝난다.
  LOOP
    v_code := 'C-' || (100000 + floor(random() * 900000))::INT::TEXT;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM contacts WHERE code = v_code);
  END LOOP;
  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION set_contact_code() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code IS NULL THEN NEW.code := gen_contact_code(); END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contacts_code ON contacts;
CREATE TRIGGER trg_contacts_code
  BEFORE INSERT ON contacts
  FOR EACH ROW EXECUTE FUNCTION set_contact_code();

-- 기존 인물 백필 (코드 없는 행만)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM contacts WHERE code IS NULL LOOP
    UPDATE contacts SET code = gen_contact_code() WHERE id = r.id;
  END LOOP;
END;
$$;

COMMENT ON COLUMN contacts.code IS '고객코드 — 랜덤 6자리(C-483920). 생성 시 트리거 자동 부여, 수정하지 않는다.';

-- ── 2) 자동 판별 확인 대기 큐 ─────────────────────────
CREATE TABLE IF NOT EXISTS contact_review_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  vendor_id   UUID REFERENCES vendors(id) ON DELETE SET NULL,
  -- auto_created: 어디에도 없어 신규 생성 / moved: 전화 일치 인물의 새 소속 배정(이동 감지)
  -- name_conflict: 같은 이름이 다른 거래처에 있으나 전화 불일치·없음 → 별개 인물로 생성
  event_type  TEXT NOT NULL CHECK (event_type IN ('auto_created', 'moved', 'name_conflict')),
  -- consultation | order_upload | order_form 등 발생 경로
  source      TEXT NOT NULL,
  -- raw_name, phone, 후보 인물(candidates), 이전 배정(prev_assignments) 등 판단 근거
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_review_events_pending
  ON contact_review_events(created_at DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_review_events_contact ON contact_review_events(contact_id);

ALTER TABLE contact_review_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "contact_review_events_all" ON contact_review_events;
CREATE POLICY "contact_review_events_all" ON contact_review_events FOR ALL USING (true);

COMMENT ON TABLE contact_review_events IS
  '인물 자동 판별 확인 대기 — 상담일지·주문 저장 시 자동 생성/이동/동명충돌을 기록하고 영업지원팀이 사후 확인한다.';
