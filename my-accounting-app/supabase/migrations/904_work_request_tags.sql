-- 904: 업무 요청 태그 (업무 계열) — 2026-11-10 사용자 결정 (docs/work-request-track.md "업무 계열 태그")
--  · 태그 마스터(work_request_tags) + 요청 ↔ 태그 연결(work_request_tag_links). 1건에 여러 개(최대 3개는 API에서 검사).
--  · 기본 8개 시드. 관리자(마스터 계정)가 화면에서 추가 · 이름 변경 · 숨김. 삭제는 없다(숨김만 — 과거 요청 · 통계 보존).
--  · code 는 기본 8개에만 있다 — 이름을 바꿔도 시스템이 알아보는 식별자(erp = 도움말 질문하기 · 권한 요청 자동 지정).
--  · 이력 종류에 tags_changed 추가.
--  · 기존 요청 중 제목이 [질문] · [권한] 으로 시작하는 건(도움말이 만든 요청)은 ERP 문의 태그를 붙인다. 그 밖의 기존 요청은 미분류로 둔다.
--  실행: Supabase SQL 편집기에서 전체 실행. 여러 번 실행해도 안전하다.

-- 1) 태그 마스터
CREATE TABLE IF NOT EXISTS work_request_tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT UNIQUE,                             -- 기본 태그 식별자 (관리자가 추가한 태그는 NULL)
  label       TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT 'slate',           -- 정해진 색 이름 (lib/work-requests WR_TAG_COLORS)
  keywords    TEXT[] NOT NULL DEFAULT '{}',            -- 작성 중 추천용 키워드
  sort        INT NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,           -- false = 숨김 (새 요청에서 못 고름, 과거 요청 · 통계에는 남음)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_request_tags_label ON work_request_tags(label);
COMMENT ON TABLE work_request_tags IS '업무 요청 태그(업무 계열) 마스터. 삭제하지 않고 active=false 로 숨긴다.';

-- 2) 요청 ↔ 태그
CREATE TABLE IF NOT EXISTS work_request_tag_links (
  request_id  UUID NOT NULL REFERENCES work_requests(id) ON DELETE CASCADE,
  tag_id      UUID NOT NULL REFERENCES work_request_tags(id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_wrtl_tag ON work_request_tag_links(tag_id);

-- 3) RLS — 서비스 키 경유 API만 (다른 업무 요청 테이블과 동일)
ALTER TABLE work_request_tags       ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_request_tag_links  ENABLE ROW LEVEL SECURITY;

-- 4) updated_at 자동 갱신 (900 의 work_requests_touch 재사용)
DROP TRIGGER IF EXISTS trg_work_request_tags_touch ON work_request_tags;
CREATE TRIGGER trg_work_request_tags_touch BEFORE UPDATE ON work_request_tags
  FOR EACH ROW EXECUTE FUNCTION work_requests_touch();

-- 5) 기본 태그 8개 (이미 있으면 건드리지 않는다 — 관리자가 바꾼 이름 · 키워드 보존)
INSERT INTO work_request_tags (code, label, color, keywords, sort) VALUES
  ('order',   '주문 · 배송',   'sky',     ARRAY['주문','발주','배송','출고','택배','납품','송장'], 10),
  ('collect', '수금 · 계산서', 'amber',   ARRAY['계산서','수금','입금','미수','청구','독촉'], 20),
  ('partner', '고객 · 매입처', 'emerald', ARRAY['거래처','고객','매출처','매입처','공급처','담당자','상담'], 30),
  ('sample',  '샘플 · 재고',   'teal',    ARRAY['샘플','재고','실사','요아럽'], 40),
  ('acct',    '회계 · 자금',   'indigo',  ARRAY['통장','지급','결제','카드','세무사','분개','부가세'], 50),
  ('hr',      '인사 · 총무',   'violet',  ARRAY['근태','휴가','급여','계약서','아르바이트','비품','출근'], 60),
  ('erp',     'ERP 문의',      'slate',   ARRAY['ERP','권한','오류','로그인'], 70),
  ('etc',     '기타',          'gray',    ARRAY[]::TEXT[], 80)
ON CONFLICT (code) DO NOTHING;

-- 6) 이력 종류 확장 — 태그 변경
ALTER TABLE work_request_events DROP CONSTRAINT IF EXISTS work_request_events_event_check;
ALTER TABLE work_request_events ADD CONSTRAINT work_request_events_event_check
  CHECK (event IN ('created', 'accepted', 'rejected', 'memo', 'reported', 'completed', 'canceled', 'edited', 'assignee_added', 'tags_changed'));

-- 7) 기존 요청: 도움말이 만든 [질문] · [권한] 요청에 ERP 문의 태그 (연결 추가만 — 요청 자체는 수정하지 않는다)
INSERT INTO work_request_tag_links (request_id, tag_id)
SELECT r.id, t.id
FROM work_requests r
JOIN work_request_tags t ON t.code = 'erp'
WHERE r.title LIKE '[질문]%' OR r.title LIKE '[권한]%'
ON CONFLICT DO NOTHING;

-- 검증 (실행 후 결과 확인)
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_name IN ('work_request_tags', 'work_request_tag_links'))  AS 테이블_기대2,
  (SELECT count(*) FROM work_request_tags WHERE code IS NOT NULL)                                                       AS 기본태그_기대8,
  (SELECT count(*) FROM pg_constraint WHERE conname = 'work_request_events_event_check'
     AND pg_get_constraintdef(oid) LIKE '%tags_changed%')                                                               AS 이력_확장_기대1,
  (SELECT count(*) FROM work_requests WHERE title LIKE '[질문]%' OR title LIKE '[권한]%')                                AS 질문권한_요청수,
  (SELECT count(*) FROM work_request_tag_links l JOIN work_request_tags t ON t.id = l.tag_id WHERE t.code = 'erp')      AS ERP문의_연결수_위와_동일,
  (SELECT count(*) FROM work_requests)                                                                                  AS 전체_요청수,
  (SELECT count(*) FROM work_requests r WHERE NOT EXISTS (SELECT 1 FROM work_request_tag_links l WHERE l.request_id = r.id)) AS 미분류_요청수;
