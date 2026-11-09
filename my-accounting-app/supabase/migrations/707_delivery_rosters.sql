-- =====================================================
-- 707_delivery_rosters.sql
-- 개별 배송 명단 — 상담일지 → 주문서 → 발주서 연결 (사용자 확정 2026-11-06·09)
--
-- 개별 배송(수령인 다수)은 표준 양식 엑셀로 올려 수령인 행 데이터로 저장한다.
--  - 명단 머리(erp_delivery_rosters): 어느 상담/주문에 붙었는지 · 원본 파일 · 업로드자
--  - 수령인 행(erp_delivery_roster_rows): 수령인·연락처·우편번호·주소·상세·연결 품목·수량·메모
--    + order_id (주문 전환 시 연결 — 분할 전환은 그 주문 품목의 행만) + tracking_no (4페이즈 송장)
--  - 다운로드 기록(erp_delivery_roster_downloads): 수령인 개인정보 — 누가 언제 받았는지
--  - Storage 버킷 'delivery-rosters' (비공개, 원본 파일 보존)
-- 규칙: 우편번호는 항목만 두고 확인·경고 없음, 주소 앞에 붙이지 않음 (사용자 확정 2026-11-09).
-- 매입처 자체 발주서 양식(대경사과 송장등록 등)은 자동 채움 대상 아님.
-- 실행 전 데이터 변경 없음 (테이블·버킷 생성만)
-- =====================================================

-- ── 1) 명단 머리 ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_delivery_rosters (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id  UUID REFERENCES erp_consultations(id) ON DELETE CASCADE,
  order_id         UUID REFERENCES erp_orders(id) ON DELETE CASCADE,   -- 상담 없이 주문에서 직접 올린 명단
  file_name        TEXT,                                                -- 원본 파일명 (수기 작성이면 NULL)
  storage_path     TEXT,                                                -- delivery-rosters 버킷 내 경로
  uploaded_by      UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (consultation_id IS NOT NULL OR order_id IS NOT NULL)
);
-- 상담 1건 = 명단 1개, 상담 없는 주문 1건 = 명단 1개 (재업로드는 교체)
CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_rosters_consult ON erp_delivery_rosters(consultation_id) WHERE consultation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_rosters_order   ON erp_delivery_rosters(order_id)        WHERE order_id IS NOT NULL AND consultation_id IS NULL;

DROP TRIGGER IF EXISTS trg_delivery_rosters_updated_at ON erp_delivery_rosters;
CREATE TRIGGER trg_delivery_rosters_updated_at
  BEFORE UPDATE ON erp_delivery_rosters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 2) 수령인 행 ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_delivery_roster_rows (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_id       UUID NOT NULL REFERENCES erp_delivery_rosters(id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,                 -- 양식 NO (표시 순서)
  recipient_name  TEXT,                             -- 수령인 (존칭 포함 표기 그대로)
  phone           TEXT,
  zip             TEXT,                             -- 선택 — 확인·경고 없음, 주소와 결합하지 않음
  addr1           TEXT,
  addr2           TEXT,
  item_name_raw   TEXT,                             -- 양식에 적힌 상품명 (그대로 보존)
  product_id      UUID REFERENCES erp_products(id) ON DELETE SET NULL,   -- 연결된 품목 (마스터)
  item_code       TEXT,                             -- 연결된 품목 품번
  item_name       TEXT,                             -- 연결된 상담/주문 품목 상품명 (발주서 매칭 키)
  quantity        INTEGER NOT NULL DEFAULT 1,
  memo            TEXT,                             -- 배송메모
  order_id        UUID REFERENCES erp_orders(id) ON DELETE SET NULL,     -- 주문 전환 시 연결 (분할 전환 대응)
  tracking_no     TEXT,                             -- 4페이즈 송장번호 (지금은 비움)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_roster_rows_roster ON erp_delivery_roster_rows(roster_id, seq);
CREATE INDEX IF NOT EXISTS idx_roster_rows_order  ON erp_delivery_roster_rows(order_id) WHERE order_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_roster_rows_updated_at ON erp_delivery_roster_rows;
CREATE TRIGGER trg_roster_rows_updated_at
  BEFORE UPDATE ON erp_delivery_roster_rows
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 3) 다운로드 기록 (개인정보 열람 이력) ─────────────
CREATE TABLE IF NOT EXISTS erp_delivery_roster_downloads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_id   UUID NOT NULL REFERENCES erp_delivery_rosters(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('excel', 'original')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_roster_downloads ON erp_delivery_roster_downloads(roster_id, created_at DESC);

-- ── 4) Storage 버킷 (비공개 — 서비스 키 경유 API만 접근) ──
INSERT INTO storage.buckets (id, name, public)
VALUES ('delivery-rosters', 'delivery-rosters', false)
ON CONFLICT (id) DO NOTHING;

-- ── RLS ───────────────────────────────────────────────
ALTER TABLE erp_delivery_rosters           ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_delivery_roster_rows       ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_delivery_roster_downloads  ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE erp_delivery_rosters IS '개별 배송 명단 머리 — 상담/주문에 붙은 표준 양식 업로드 (707). 수령인 행은 erp_delivery_roster_rows';
COMMENT ON TABLE erp_delivery_roster_rows IS '수령인 행 — 상담 → 주문(order_id) → 발주서(item_name 매칭) → 송장(tracking_no)까지 같은 행을 따라감';

-- ── 검증 (실행 후) ───────────────────────────────────────
-- 기대: 테이블_기대3 = 3 / 버킷_기대1 = 1
SELECT
  (SELECT COUNT(*) FROM information_schema.tables
    WHERE table_name IN ('erp_delivery_rosters', 'erp_delivery_roster_rows', 'erp_delivery_roster_downloads')) AS 테이블_기대3,
  (SELECT COUNT(*) FROM storage.buckets WHERE id = 'delivery-rosters') AS 버킷_기대1;
