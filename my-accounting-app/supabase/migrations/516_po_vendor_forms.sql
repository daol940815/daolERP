-- =====================================================
-- 516_po_vendor_forms.sql  (주문시스템 트랙)
-- 2026-11-09 사용자 확정 — 업체 발주서 양식 등록 (계획 https://claude.ai/artifact/TR7A4WSjHo4qWybgCQ9tYC)
--
-- 업체마다 다른 자체 발주서 엑셀을 ERP에 올려 두고, 발주서 다운로드 · 메일 첨부 때 그 양식에 값을 채워 만든다.
--  - 양식은 매입처별 버전으로 쌓는다 (작성 중 → 사용 중 → 보관). 매입처당 '사용 중'은 1개
--  - 칸 연결(어느 칸에 무슨 값)은 mapping JSON — 화면에서 자동 인식 후 직원이 고친다
--  - 원본 파일은 Storage 버킷 'po-forms'(비공개) — 깃허브에 두지 않는다
--  - 발주서가 어느 양식 버전으로 나갔는지 erp_purchase_orders.form_id에 남긴다 (2차에서 기록 시작)
--  - 등록 · 수정 = 매입처 관리 수정 권한자 (앱 검사)
-- 기존 데이터 변경 없음 (표 1개 · 열 1개 · 버킷 1개 추가만)
-- =====================================================

-- ── 1) 매입처별 양식 버전 ───────────────────────────────
CREATE TABLE IF NOT EXISTS erp_po_forms (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id     UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  version       INT  NOT NULL,
  file_name     TEXT NOT NULL,                       -- 올린 원본 파일명
  storage_path  TEXT NOT NULL,                       -- po-forms 버킷 내 경로
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  mapping       JSONB NOT NULL DEFAULT '{}'::jsonb,  -- 칸 연결 설정 (시트 · 머리글 행 · 시작 행 · 열/칸 → 값)
  recognized    JSONB,                               -- 자동 인식 결과 (추천 근거 표시용, 원본 유지)
  memo          TEXT,
  uploaded_by   UUID REFERENCES employees(id) ON DELETE SET NULL,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_by  UUID REFERENCES employees(id) ON DELETE SET NULL,
  activated_at  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, version)
);
-- 매입처당 사용 중 양식은 1개
CREATE UNIQUE INDEX IF NOT EXISTS uq_po_forms_active ON erp_po_forms (vendor_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_po_forms_vendor ON erp_po_forms (vendor_id, version DESC);

DROP TRIGGER IF EXISTS trg_po_forms_updated_at ON erp_po_forms;
CREATE TRIGGER trg_po_forms_updated_at
  BEFORE UPDATE ON erp_po_forms
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE erp_po_forms IS
  '매입처 자체 발주서 양식 버전 (516, 2026-11-09). 원본 파일 po-forms 버킷 + 칸 연결 mapping. 매입처당 active 1개.';

-- ── 2) 발주서에 사용한 양식 버전 ─────────────────────────
ALTER TABLE erp_purchase_orders
  ADD COLUMN IF NOT EXISTS form_id UUID REFERENCES erp_po_forms(id) ON DELETE SET NULL;

-- ── 3) Storage 버킷 (비공개 — 서비스 키 경유 API만 접근) ──
INSERT INTO storage.buckets (id, name, public)
VALUES ('po-forms', 'po-forms', false)
ON CONFLICT (id) DO NOTHING;

-- ── RLS — 서비스 키 경유 API만 (다른 트랙 테이블과 동일) ──
ALTER TABLE erp_po_forms ENABLE ROW LEVEL SECURITY;

-- ── 검증 (실행 후) ───────────────────────────────────────
-- 기대: 양식표_기대1 = 1 / 발주서_form_id_기대1 = 1 / 버킷_기대1 = 1 / 양식_건수_기대0 = 0 / 발주서_건수 = 실행 전과 동일
SELECT
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'erp_po_forms') AS 양식표_기대1,
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name = 'erp_purchase_orders' AND column_name = 'form_id') AS 발주서_form_id_기대1,
  (SELECT COUNT(*) FROM storage.buckets WHERE id = 'po-forms') AS 버킷_기대1,
  (SELECT COUNT(*) FROM erp_po_forms) AS 양식_건수_기대0,
  (SELECT COUNT(*) FROM erp_purchase_orders) AS 발주서_건수;
