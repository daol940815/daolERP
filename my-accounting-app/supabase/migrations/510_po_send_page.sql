-- =====================================================
-- 510_po_send_page.sql
-- 발주서 발송 페이지 분리 (2026-08-20 사용자 확정 — 시안 v3)
--
--  1) 메일 프리셋: 제목·본문 템플릿 (치환 변수 {발주번호} 등), 전 직원 공용,
--     기본 프리셋 1개가 발송 화면에 자동 적용
--  2) 발주서 첨부: 사용자가 직접 올린 파일 기록 (Storage 경로)
--     - kind 'replace' = 발주서 수정본 (자동 생성본 대신 첨부)
--     - kind 'extra'   = 추가 자료 (자동 생성본과 함께 첨부)
--  3) 발송 로그: 실제 발송된 제목·본문·첨부 파일명 보존 —
--     프리셋을 나중에 고치거나 지워도 과거 발송 내용은 남는다
--  4) Storage 버킷 'po-attachments' (비공개 — 서비스 키 경유 API만 접근)
--
-- 송장번호·배송현황은 이 단계에 없음 — 4페이즈에서 주문서 내역에 구현 (사용자 확정)
-- =====================================================

-- ── 1) 메일 프리셋 ────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_po_mail_presets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  updated_by  UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_po_presets_updated_at ON erp_po_mail_presets;
CREATE TRIGGER trg_po_presets_updated_at
  BEFORE UPDATE ON erp_po_mail_presets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 기본 프리셋은 1개만 (부분 유니크)
CREATE UNIQUE INDEX IF NOT EXISTS idx_po_presets_default
  ON erp_po_mail_presets(is_default) WHERE is_default;

-- 시드: 기본 발주 안내 (기존 하드코딩 본문을 프리셋으로 이관)
INSERT INTO erp_po_mail_presets (name, subject, body, is_default)
VALUES (
  '기본 발주 안내',
  '[다올커머스] 발주서 송부 - {발주번호} {매입처명}',
  E'안녕하세요, 다올커머스입니다.\n\n{매입처명} 담당자님, 발주서를 첨부하여 송부드립니다.\n- 발주번호: {발주번호}\n- 합계금액: {합계금액}원\n\n확인 부탁드립니다. 감사합니다.',
  true
)
ON CONFLICT (name) DO NOTHING;

-- ── 2) 발주서 첨부 파일 ───────────────────────────────
CREATE TABLE IF NOT EXISTS erp_po_attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id        UUID NOT NULL REFERENCES erp_purchase_orders(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'replace' CHECK (kind IN ('replace', 'extra')),
  file_name    TEXT NOT NULL,
  storage_path TEXT NOT NULL,                  -- po-attachments 버킷 내 경로
  size_bytes   BIGINT NOT NULL DEFAULT 0,
  uploaded_by  UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_po_attachments ON erp_po_attachments(po_id);

-- ── 3) 발송 로그 (실제 발송 내용 보존) ────────────────
CREATE TABLE IF NOT EXISTS erp_po_send_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id            UUID NOT NULL REFERENCES erp_purchase_orders(id) ON DELETE CASCADE,
  method           TEXT NOT NULL CHECK (method IN ('email', 'manual')),
  email_to         TEXT,
  subject          TEXT,
  body             TEXT,
  attachment_names TEXT[],                     -- 실제 첨부된 파일명 목록
  ok               BOOLEAN NOT NULL DEFAULT true,
  error            TEXT,
  sent_by          UUID REFERENCES employees(id) ON DELETE SET NULL,
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_po_send_logs ON erp_po_send_logs(po_id, sent_at DESC);

-- ── 4) Storage 버킷 (비공개 — 서비스 키 경유 API만 접근) ──
INSERT INTO storage.buckets (id, name, public)
VALUES ('po-attachments', 'po-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- ── RLS ───────────────────────────────────────────────
ALTER TABLE erp_po_mail_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_po_attachments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_po_send_logs    ENABLE ROW LEVEL SECURITY;

-- ── 검증 ──────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM erp_po_mail_presets) AS 프리셋수_기대1,
  (SELECT name FROM erp_po_mail_presets WHERE is_default) AS 기본프리셋,
  (SELECT count(*) FROM storage.buckets WHERE id = 'po-attachments') AS 버킷_기대1;
