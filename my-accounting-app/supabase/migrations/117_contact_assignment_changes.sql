-- =====================================================
-- 117_contact_assignment_changes.sql
-- 거래처 담당자 직함 · 역할 변경 이력 — 사용자 승인 2026-11-13 ("1,2,3 모두 진행해줘")
--
-- 배경: 직함 수정(승진 등)은 배정의 현재 직함만 덮어써서, 언제 대리에서 과장이 됐는지 남지 않았다.
-- 주문에 적힌 담당자 표기("홍길동 대리님")는 원본이라 그대로 두고, 같은 사람인지는 고객코드로 본다.
-- 이 테이블은 배정 칸이 바뀔 때마다 한 줄씩 남긴다(덮어쓰기 없음, 삭제 없음).
--   field: 'title'(직함) | 'role_memo'(역할 메모)
--   기록: /api/vendor-hub/contacts update_assignment (화면: 매출처 상세 담당자 줄 수정 · 담당자 상세 직함 수정)
-- 표시: 담당자 상세 소속 이력 "대리 → 과장 · 11-13 · 수정자", 주문 상세 담당자 정보 카드 "11-13 변경".
-- =====================================================

CREATE TABLE IF NOT EXISTS contact_assignment_changes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id  UUID NOT NULL REFERENCES contact_assignments(id) ON DELETE CASCADE,
  contact_id     UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  vendor_id      UUID REFERENCES vendors(id) ON DELETE SET NULL,
  field          TEXT NOT NULL CHECK (field IN ('title', 'role_memo')),
  old_value      TEXT,
  new_value      TEXT,
  changed_by     UUID REFERENCES employees(id) ON DELETE SET NULL,
  changed_by_name TEXT,
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cac_contact ON contact_assignment_changes(contact_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_cac_assignment ON contact_assignment_changes(assignment_id, changed_at DESC);

COMMENT ON TABLE contact_assignment_changes IS
  '거래처 담당자 배정의 직함 · 역할 메모 변경 이력 (117). 덮어쓰기 · 삭제 없음.';

-- 인물 병합 시 이력도 남는 인물로 (contact_assignments 는 앱이 옮기지만 이력은 여기서 같이 따라가게)
CREATE OR REPLACE FUNCTION cac_follow_contact_merge() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.merged_into_id IS NOT NULL AND OLD.merged_into_id IS DISTINCT FROM NEW.merged_into_id THEN
    UPDATE contact_assignment_changes SET contact_id = NEW.merged_into_id WHERE contact_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_cac_follow_contact_merge ON contacts;
CREATE TRIGGER trg_cac_follow_contact_merge
  AFTER UPDATE OF merged_into_id ON contacts
  FOR EACH ROW EXECUTE FUNCTION cac_follow_contact_merge();

-- 검증
SELECT
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'contact_assignment_changes') AS 이력테이블_기대1,
  (SELECT COUNT(*) FROM pg_trigger WHERE tgname = 'trg_cac_follow_contact_merge') AS 트리거_기대1;
